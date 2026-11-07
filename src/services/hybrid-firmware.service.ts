import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  HybridDevice,
  HybridDeviceDocument,
} from '../models/hybrid-device.schema';
import { OnEvent } from '@nestjs/event-emitter';
import { MqttService } from './mqtt.service';
import { BetaFirmwareDeviceService } from './beta-firmware-device.service';
import { activeEspFirmware } from './firmware.service';
import type { ChargerOtaStatusPayload } from './charger-firmware.service';

/** ESP32 OTA of hybrids: build set in the CMS (ESP32 Firmware -> Hybrid). */
@Injectable()
export class HybridFirmwareService {
  constructor(
    private readonly mqtt: MqttService,
    private readonly beta: BetaFirmwareDeviceService,
    @Optional()
    @InjectModel(HybridDevice.name)
    private readonly devices?: Model<HybridDeviceDocument>,
  ) {}

  private channel(deviceId?: string): 'beta' | 'stable' {
    return deviceId && this.beta.isBeta(deviceId) ? 'beta' : 'stable';
  }

  async getFirmwareUrl(deviceId: string): Promise<{ url: string }> {
    // CMS "Chuyển về inverter": this unit gets the inverter build.
    const row = this.devices
      ? ((await this.devices
          .findOne(
            { deviceId, inverterConversion: { $ne: null } },
            { inverterConversion: 1 },
          )
          .lean()
          .exec()) as { inverterConversion?: { url: string } | null } | null)
      : null;
    if (row?.inverterConversion?.url)
      return { url: row.inverterConversion.url };
    return { url: activeEspFirmware(this.channel(deviceId), 'hybrid').url };
  }

  getNewestFirmwareVersion(deviceId?: string): { version: string } {
    return {
      version: activeEspFirmware(this.channel(deviceId), 'hybrid').version,
    };
  }

  /**
   * Retained trigger on hybrid/{uid}/{dev}/firmware/update; the device then
   * fetches the URL from /api/hybrid-firmware. Cleared once it reports
   * success / failed (handleOtaStatus) so a reboot does not OTA again.
   */
  async triggerFirmwareUpdate(
    userId: string,
    deviceId: string,
  ): Promise<{ topic: string; statusTopic: string }> {
    const topic = `hybrid/${userId}/${deviceId}/firmware/update`;
    await this.mqtt.publishWithRetain(topic, { ts: Date.now() }, true);
    return { topic, statusTopic: `hybrid/${userId}/${deviceId}/ota/status` };
  }

  @OnEvent('hybrid.ota.status.received')
  handleOtaStatus(payload: ChargerOtaStatusPayload): void {
    const status = (payload.status || '').toLowerCase();
    if (status === 'success' || status === 'failed') {
      void this.mqtt.clearHybridFirmwareUpdate(
        payload.userId,
        payload.deviceId,
      );
    }
  }
}
