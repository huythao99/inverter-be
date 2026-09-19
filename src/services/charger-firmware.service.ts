import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MqttService } from './mqtt.service';
import { ChargerDeviceService } from './charger-device.service';

export interface ChargerOtaStatusPayload {
  userId: string;
  deviceId: string;
  status?: string;
  progress?: number;
  message?: string;
  timestamp: string;
}

@Injectable()
export class ChargerFirmwareService {
  private readonly FIRMWARE_BASE_URL =
    'https://giabao-inverter.com/firmware/charger';
  private readonly NEWEST_VERSION = '1.0.0';

  constructor(
    private readonly mqttService: MqttService,
    private readonly chargerDeviceService: ChargerDeviceService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getFirmwareUrl(deviceId: string): { url: string } {
    return { url: `${this.FIRMWARE_BASE_URL}/firmware.bin` };
  }

  getNewestFirmwareVersion(): { version: string } {
    return { version: this.NEWEST_VERSION };
  }

  async getDeviceFirmwareVersion(
    userId: string,
    deviceId: string,
  ): Promise<{ firmwareVersion: string | null }> {
    const device = await this.chargerDeviceService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    return { firmwareVersion: device?.firmwareVersion ?? null };
  }

  /**
   * Trigger OTA: publish (retain, qos1) to `charger/{uid}/{deviceId}/firmware/update`.
   * The retained message is cleared automatically once the device reports
   * success/failed on `ota/status` (see handleOtaStatus), preventing OTA loops.
   */
  async triggerFirmwareUpdate(
    userId: string,
    deviceId: string,
    targetVersion?: string,
  ): Promise<{
    message: string;
    topic: string;
    statusTopic: string;
    userId: string;
    deviceId: string;
  }> {
    const device = await this.chargerDeviceService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    if (!device) {
      throw new NotFoundException(
        `Charger ${deviceId} not found for user ${userId}`,
      );
    }

    const topic = `charger/${userId}/${deviceId}/firmware/update`;
    const statusTopic = `charger/${userId}/${deviceId}/ota/status`;
    await this.mqttService.publishWithRetain(
      topic,
      {
        action: 'start_update',
        userId,
        deviceId,
        currentVersion: device.firmwareVersion || '1.0.0',
        targetVersion,
        timestamp: new Date().toISOString(),
      },
      true,
    );

    return {
      message: `Firmware update triggered for charger ${deviceId}`,
      topic,
      statusTopic,
      userId,
      deviceId,
    };
  }

  // Clear the retained trigger once OTA finishes so the device doesn't re-run
  // OTA forever after rebooting.
  @OnEvent('charger.ota.status.received')
  handleOtaStatus(payload: ChargerOtaStatusPayload): void {
    const status = (payload.status || '').toLowerCase();
    if (status === 'success' || status === 'failed') {
      void this.mqttService.clearChargerFirmwareUpdate(
        payload.userId,
        payload.deviceId,
      );
    }
  }
}
