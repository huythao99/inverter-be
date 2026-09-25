import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MqttService } from './mqtt.service';
import { ChargerDeviceService } from './charger-device.service';
import { BetaFirmwareDeviceService } from './beta-firmware-device.service';
import { activeEspFirmware } from './firmware.service';

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
  constructor(
    private readonly mqttService: MqttService,
    private readonly chargerDeviceService: ChargerDeviceService,
    private readonly betaFirmwareDeviceService: BetaFirmwareDeviceService,
  ) {}

  // Build active for chargers in the CMS (ESP32 Firmware -> Charger), or the
  // fixed firmware-charger.bin until one is set. Devices on the beta list get
  // the beta build.
  getFirmwareUrl(deviceId: string): { url: string } {
    const channel = this.betaFirmwareDeviceService.isBeta(deviceId)
      ? 'beta'
      : 'stable';
    return { url: activeEspFirmware(channel, 'charger').url };
  }

  getNewestFirmwareVersion(deviceId?: string): { version: string } {
    const channel =
      deviceId && this.betaFirmwareDeviceService.isBeta(deviceId)
        ? 'beta'
        : 'stable';
    return { version: activeEspFirmware(channel, 'charger').version };
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
      // Keep it short: the device only needs the send time (it ignores a
      // trigger older than 10 min and an empty clear) and fetches the URL
      // itself from /api/charger-firmware. Older firmware ignores the payload.
      { ts: Date.now(), ...(targetVersion ? { targetVersion } : {}) },
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
