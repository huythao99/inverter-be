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
import { activeEspFirmware, compareFirmwareVersions } from './firmware.service';
import { MqttAuthService } from './mqtt-auth.service';

/**
 * A hybrid flashed as one (HybridControl0015) runs as an inverter under
 * GTIControl<90000 + N> (GTIControl90015): numbers below 400 are the old
 * Firebase inverters and N alone could clash with a real inverter. Same value
 * as HYBRID_AS_GTI_OFFSET in esp32-hybrid config.h.
 */
export const HYBRID_AS_GTI_OFFSET = 90000;

/**
 * Inverter id -> hybrid id, as the hybrid firmware renames itself on boot:
 * GTIControl1230 -> HybridControl1230 (same number);
 * GTIControl90015 -> HybridControl0015 (a hybrid that was converted to
 * inverter, back to its own name). null: not an inverter id.
 */
export function gtiToHybridId(deviceId: string): string | null {
  const m = /^GTIControl(\d+)$/.exec(deviceId ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= HYBRID_AS_GTI_OFFSET && n < 2 * HYBRID_AS_GTI_OFFSET) {
    return `HybridControl${String(n - HYBRID_AS_GTI_OFFSET).padStart(4, '0')}`;
  }
  return `HybridControl${m[1]}`;
}

/**
 * Hybrid id -> the inverter id it runs as after "Chuyển về inverter": its
 * original inverter id when it was converted from one, else the 90000 range.
 */
export function hybridToGtiId(
  deviceId: string,
  convertedFrom?: string | null,
): string | null {
  if (convertedFrom && /^GTIControl\d+$/.test(convertedFrom)) {
    return convertedFrom;
  }
  const m = /^HybridControl(\d+)$/.exec(deviceId ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= HYBRID_AS_GTI_OFFSET) return null; // no room in the 90000 range
  return `GTIControl${HYBRID_AS_GTI_OFFSET + n}`;
}

/** Inverter firmware that renames itself + does not roll back unconfigured. */
export const INVERTER_CONVERT_MIN_VERSION = '1.1.4';
/** Hybrid firmware that understands cmd/action CONVERT. */
export const HYBRID_CONVERT_CMD_MIN_VERSION = '1.3.4';

/**
 * App slot of the inverter's partition table (Arduino default: 2 x 1.25 MB).
 * OTA cannot change the partition table, so the hybrid build must fit it.
 */
export const HYBRID_CONVERT_MAX_BYTES = 0x140000;
/**
 * First hybrid firmware that runs on an inverter board: keeps its secrets in
 * NVS when there is no devsec partition and renames GTIControl -> Hybrid.
 */
// 1.3.2: also confirms the OTA image without an MQTT account (1.3.1 rolled
// back to the inverter firmware on any reboot before the owner added it).
export const HYBRID_CONVERT_MIN_VERSION = '1.3.2';

/**
 * An inverter entry named HybridControlN: a converted device that rolled back
 * to the inverter firmware (it keeps the renamed id, NVS is shared) and
 * registered itself as an inverter. Converting it again is the fix.
 */
export function isRolledBackHybridId(deviceId: string): boolean {
  return /^HybridControl\d+$/.test(deviceId ?? '');
}

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
    private readonly mqttAuth: MqttAuthService,
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
    const rolledBack = isRolledBackHybridId(device.deviceId);
    const hybridDeviceId = rolledBack
      ? device.deviceId
      : gtiToHybridId(device.deviceId);
    if (!hybridDeviceId) {
      throw new BadRequestException(
        `${device.deviceId} không phải mã máy inverter (GTIControl<số>)`,
      );
    }
    // The number must still be free on the hybrid side (a rolled-back device
    // may already be registered as that hybrid: it is the same unit).
    if (
      !rolledBack &&
      (await this.hybrids.exists({ deviceId: hybridDeviceId }).exec())
    ) {
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
    // The inverter ids this unit may come from: same number (an inverter
    // board), or the 90000 range (a hybrid that had been made an inverter).
    const sources = [`GTIControl${m[1]}`];
    const n = parseInt(m[1], 10);
    if (n < HYBRID_AS_GTI_OFFSET)
      sources.push(`GTIControl${HYBRID_AS_GTI_OFFSET + n}`);
    const flagged = (await this.inverters
      .findOne(
        { deviceId: { $in: sources }, hybridConversion: { $ne: null } },
        { deviceId: 1 },
      )
      .lean()
      .exec()) as { deviceId: string } | null;
    // Remember where an inverter board came from ("Chuyển về inverter" gives
    // it its old id back). A native hybrid coming back keeps null.
    if (flagged && flagged.deviceId === `GTIControl${m[1]}`) {
      await this.hybrids
        .updateMany(
          { deviceId: p.deviceId },
          { $set: { convertedFrom: flagged.deviceId } },
        )
        .exec();
    }
    const res = await this.inverters
      .deleteMany({
        $or: [
          { deviceId: { $in: sources }, hybridConversion: { $ne: null } },
          // It had rolled back to the inverter firmware under its new name.
          { deviceId: p.deviceId },
        ],
      })
      .exec();
    if (res.deletedCount) {
      this.logger.log(
        `${p.deviceId} added as a hybrid: ${res.deletedCount} inverter entry(ies) removed`,
      );
    }
  }

  // ---- Hybrid -> inverter ("Chuyển về inverter") -------------------------

  /** Stable inverter build usable for the conversion, or why not. */
  inverterTarget(): { version: string; url: string } {
    const fw = activeEspFirmware('stable', 'inverter');
    if (!fw?.url) {
      throw new BadRequestException('Chưa có firmware inverter stable');
    }
    if (compareFirmwareVersions(fw.version, INVERTER_CONVERT_MIN_VERSION) < 0) {
      throw new BadRequestException(
        `Firmware inverter stable v${fw.version} chưa hỗ trợ chuyển đổi (cần ≥ ${INVERTER_CONVERT_MIN_VERSION})`,
      );
    }
    return { version: fw.version, url: fw.url };
  }

  /** Start (or re-send) the conversion of one hybrid (CMS device _id). */
  async startToInverter(id: string, by?: string | null) {
    const device = await this.hybrids.findById(id).exec();
    if (!device) throw new NotFoundException(`Hybrid ${id} not found`);
    const gtiDeviceId = hybridToGtiId(device.deviceId, device.convertedFrom);
    if (!gtiDeviceId) {
      throw new BadRequestException(
        `${device.deviceId}: không tính được mã inverter`,
      );
    }
    if (
      compareFirmwareVersions(
        device.firmwareVersion ?? '0.0.0',
        HYBRID_CONVERT_CMD_MIN_VERSION,
      ) < 0
    ) {
      throw new BadRequestException(
        `Máy đang chạy hybrid v${device.firmwareVersion}: cập nhật lên ≥ ${HYBRID_CONVERT_CMD_MIN_VERSION} trước rồi mới chuyển`,
      );
    }
    // A real inverter already uses that id (not this unit's old entry).
    const taken = (await this.inverters
      .findOne({ deviceId: gtiDeviceId }, { hybridConversion: 1 })
      .lean()
      .exec()) as { hybridConversion?: unknown } | null;
    if (taken && !device.convertedFrom) {
      throw new ConflictException(
        `${gtiDeviceId} đã có trên hệ thống: không chuyển được`,
      );
    }
    const fw = this.inverterTarget();
    const conversion = {
      gtiDeviceId,
      version: fw.version,
      url: fw.url,
      requestedAt: new Date(),
      by: by ?? null,
    };
    await this.hybrids
      .updateMany(
        { deviceId: device.deviceId },
        { $set: { inverterConversion: conversion } },
      )
      .exec();
    // The device keeps the name to take and starts its OTA; it renames
    // itself only once the inverter image is installed.
    await this.mqtt.publishWithRetain(
      `hybrid/${device.userId}/${device.deviceId}/cmd/action`,
      { cmd: 'CONVERT', to: gtiDeviceId, ts: Date.now() },
      false,
    );
    this.logger.log(
      `Inverter conversion of ${device.deviceId} -> ${gtiDeviceId} (v${fw.version}) started`,
    );
    return { deviceId: device.deviceId, ...conversion };
  }

  async cancelToInverter(id: string) {
    const device = await this.hybrids.findById(id).exec();
    if (!device) throw new NotFoundException(`Hybrid ${id} not found`);
    await this.hybrids
      .updateMany(
        { deviceId: device.deviceId },
        { $set: { inverterConversion: null } },
      )
      .exec();
    return { deviceId: device.deviceId, cancelled: true };
  }

  /**
   * The unit came back as an inverter (POST /api/inverter-device/data with
   * the converted id): drop its hybrid entries and their MQTT accounts.
   */
  @OnEvent('inverter.device.registered')
  async onInverterRegistered(p: { userId: string; deviceId: string }) {
    if (!/^GTIControl\d+$/.test(p.deviceId ?? '')) return;
    const rows = (await this.hybrids
      .find(
        { 'inverterConversion.gtiDeviceId': p.deviceId },
        { userId: 1, deviceId: 1 },
      )
      .lean()
      .exec()) as { userId: string; deviceId: string }[];
    if (!rows.length) return;
    for (const r of rows) {
      await this.mqttAuth
        .revokeHybridCredentials(r.deviceId, r.userId)
        .catch(() => {});
    }
    await this.hybrids
      .deleteMany({ 'inverterConversion.gtiDeviceId': p.deviceId })
      .exec();
    this.logger.log(
      `${rows[0].deviceId} is now the inverter ${p.deviceId}: hybrid entry removed`,
    );
  }
}
