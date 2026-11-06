import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  HybridDevice,
  HybridDeviceDocument,
} from '../models/hybrid-device.schema';
import {
  EspFirmware,
  EspFirmwareDocument,
} from '../models/esp-firmware.schema';
import { MqttService } from './mqtt.service';
import { compareFirmwareVersions } from './firmware.service';

/**
 * GTIControl1230 -> HybridControl1230 (same number). null: not an inverter id.
 * The hybrid firmware renames itself the same way on its first boot.
 */
export function gtiToHybridId(deviceId: string): string | null {
  const m = /^GTIControl(\d+)$/.exec(deviceId ?? '');
  return m ? `HybridControl${m[1]}` : null;
}

/**
 * App slot of the inverter's partition table (Arduino default: 2 x 1.25 MB).
 * OTA cannot change the partition table, so the hybrid build must fit it.
 */
export const HYBRID_CONVERT_MAX_BYTES = 0x140000;
/**
 * First hybrid firmware that runs on an inverter board: keeps its secrets in
 * NVS when there is no devsec partition and renames GTIControl -> Hybrid.
 */
export const HYBRID_CONVERT_MIN_VERSION = '1.3.1';

export const HYBRID_PROVISIONED_EVENT = 'hybrid.device.provisioned';

export interface HybridConversion {
  hybridDeviceId: string;
  version: string;
  url: string;
  requestedAt: Date;
  by?: string | null;
}

/**
 * CMS "Chuyển sang hybrid": an inverter's ESP32 gets the hybrid firmware by
 * OTA (GET /api/firmware serves the hybrid build to that device), renames
 * itself GTIControlN -> HybridControlN and starts as a new, unclaimed hybrid.
 * Once its owner adds it with the app (provision), the old inverter entry is
 * removed from their list.
 */
@Injectable()
export class HybridConversionService {
  private readonly logger = new Logger(HybridConversionService.name);

  constructor(
    @InjectModel(InverterDevice.name)
    private readonly inverters: Model<InverterDeviceDocument>,
    @InjectModel(HybridDevice.name)
    private readonly hybrids: Model<HybridDeviceDocument>,
    @InjectModel(EspFirmware.name)
    private readonly firmwares: Model<EspFirmwareDocument>,
    private readonly mqtt: MqttService,
  ) {}

  /** Stable hybrid build usable on an inverter board, or why not. */
  async target(): Promise<{ version: string; url: string; size: number }> {
    const fw = (await this.firmwares
      .findOne({ product: 'hybrid', channels: 'stable' })
      .lean()
      .exec()) as { version: string; url: string; size: number } | null;
    if (!fw) {
      throw new BadRequestException(
        'Chưa có firmware hybrid stable (CMS → ESP32 Firmware → Hybrid)',
      );
    }
    if (compareFirmwareVersions(fw.version, HYBRID_CONVERT_MIN_VERSION) < 0) {
      throw new BadRequestException(
        `Firmware hybrid stable v${fw.version} chưa chạy được trên máy inverter (cần ≥ ${HYBRID_CONVERT_MIN_VERSION})`,
      );
    }
    if (fw.size > HYBRID_CONVERT_MAX_BYTES) {
      throw new BadRequestException(
        `Firmware hybrid v${fw.version} (${fw.size} B) lớn hơn khe firmware của máy inverter (${HYBRID_CONVERT_MAX_BYTES} B)`,
      );
    }
    return { version: fw.version, url: fw.url, size: fw.size };
  }

  /** Start (or re-send) the conversion of one inverter (CMS device _id). */
  async start(id: string, by?: string | null) {
    const device = await this.inverters.findById(id).exec();
    if (!device) throw new NotFoundException(`Device ${id} not found`);
    const hybridDeviceId = gtiToHybridId(device.deviceId);
    if (!hybridDeviceId) {
      throw new BadRequestException(
        `${device.deviceId} không phải mã máy inverter (GTIControl<số>)`,
      );
    }
    // The number must still be free on the hybrid side.
    if (await this.hybrids.exists({ deviceId: hybridDeviceId }).exec()) {
      throw new ConflictException(
        `${hybridDeviceId} đã có trên hệ thống: không chuyển được`,
      );
    }
    const fw = await this.target();
    const conversion: HybridConversion = {
      hybridDeviceId,
      version: fw.version,
      url: fw.url,
      requestedAt: new Date(),
      by: by ?? null,
    };
    // Every account that has this device: the ESP32 asks by deviceId only.
    await this.inverters
      .updateMany(
        { deviceId: device.deviceId },
        { $set: { hybridConversion: conversion } },
      )
      .exec();
    // Same trigger as a normal OTA ({ ts } only, old firmware has a small
    // MQTT buffer); the device then fetches the URL from /api/firmware.
    await this.mqtt.publish(
      `inverter/${device.userId}/${device.deviceId}/firmware/update`,
      { ts: Date.now() },
    );
    this.logger.log(
      `Hybrid conversion of ${device.deviceId} -> ${hybridDeviceId} (v${fw.version}) started`,
    );
    return { deviceId: device.deviceId, ...conversion };
  }

  async cancel(id: string) {
    const device = await this.inverters.findById(id).exec();
    if (!device) throw new NotFoundException(`Device ${id} not found`);
    await this.inverters
      .updateMany(
        { deviceId: device.deviceId },
        { $set: { hybridConversion: null } },
      )
      .exec();
    return { deviceId: device.deviceId, cancelled: true };
  }

  /**
   * The converted device was added again as a hybrid: drop the old inverter
   * entries (all accounts), they would show a dead device.
   */
  @OnEvent(HYBRID_PROVISIONED_EVENT)
  async onHybridProvisioned(p: { userId: string; deviceId: string }) {
    const m = /^HybridControl(\d+)$/.exec(p.deviceId ?? '');
    if (!m) return;
    const res = await this.inverters
      .deleteMany({
        deviceId: `GTIControl${m[1]}`,
        hybridConversion: { $ne: null },
      })
      .exec();
    if (res.deletedCount) {
      this.logger.log(
        `GTIControl${m[1]} converted to ${p.deviceId}: ${res.deletedCount} inverter entry(ies) removed`,
      );
    }
  }
}
