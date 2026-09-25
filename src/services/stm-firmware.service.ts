import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import * as zlib from 'zlib';
import {
  StmChannel,
  StmFirmware,
  StmFirmwareDocument,
  StmProduct,
} from '../models/stm-firmware.schema';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import { MqttService } from './mqtt.service';
import { BetaFirmwareDeviceService } from './beta-firmware-device.service';
import { FIRMWARE_BASE_URL, compareFirmwareVersions } from './firmware.service';

// ---------------------------------------------------------------------------
// Versions are "major.voltage.patch":
//   major   = product generation / chip (3 = grid-tie F303, 2 = grid-tie G431)
//   voltage = battery voltage class (1 = 12V, 2 = 24V, 3 = 36V, 4 = 48V...)
// A device only gets images with the SAME major and voltage as the version
// its STM32 reports (telemetry field 13); among those the highest wins.
// ---------------------------------------------------------------------------

/** Only strings / finite numbers are accepted as text from device reports. */
function asText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export interface StmVersion {
  version: string; // normalized "a.b.c"
  major: number; // a: product generation / chip (3 = F303, 2 = G431)
  voltageCode: number; // b
}

/** Parse "a.b.c" (optional leading "v"). Null if not exactly 3 numbers. */
export function parseStmVersion(raw: unknown): StmVersion | null {
  const text = asText(raw)?.trim().replace(/^v/i, '');
  if (!text) return null;
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(text);
  if (!m) return null;
  const voltageCode = Number(m[2]);
  if (voltageCode < 1) return null;
  return {
    version: `${Number(m[1])}.${voltageCode}.${Number(m[3])}`,
    major: Number(m[1]),
    voltageCode,
  };
}

/** Chip of a version's major number (3 -> "F303", 2 -> "G431"). */
export function chipLabel(major: number | null | undefined): string | null {
  if (major === 3) return 'F303';
  if (major === 2) return 'G431';
  return major ? `gen ${major}` : null;
}

/** 1 -> "12V", 2 -> "24V", 3 -> "36V", 4 -> "48V"... */
export function voltageLabel(code: number | null | undefined): string | null {
  return code ? `${code * 12}V` : null;
}

export function normalizeCrc32(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return '0x' + (raw >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }
  const text = asText(raw);
  if (text === null) return null;
  const s = text.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{1,8}$/.test(s)) return null;
  return '0x' + s.toUpperCase().padStart(8, '0');
}

export interface StmTarget {
  id: string;
  product: StmProduct;
  channel: StmChannel;
  version: string;
  major: number;
  chip: string | null;
  voltageCode: number;
  voltage: string | null;
  url: string;
  size: number;
  crc32: string;
  appBase: string | null;
}

export interface DeviceStmInfo {
  version: string | null;
  major: number | null;
  chip: string | null;
  voltageCode: number | null;
  voltage: string | null;
  crc32: string | null;
  reportedAt: Date | null;
  /** ESP32 firmware supports STM32 FOTA. */
  supported: boolean;
  minEspVersion: string;
  target: StmTarget | null;
  updateAvailable: boolean;
  /** Why no update can be offered (null when target exists). */
  reason: null | 'esp_firmware_too_old' | 'version_unknown' | 'no_firmware';
  lastOta: InverterDevice['stmOta'];
}

const MAX_IMAGE_BYTES = 256 * 1024;
const TRIGGER_COOLDOWN_MS = 120000; // download + ~40 s flash + reboot

/**
 * STM32 firmware (FOTA through the ESP32):
 *  - registry of the static images (CMS),
 *  - what each device runs (reported by the STM32 via the ESP32),
 *  - which image a device should get, and the MQTT trigger.
 *
 * Device contract (ESP32 side, to be implemented):
 *  - report : PATCH /api/stm-firmware/info/:userId/:deviceId
 *             or MQTT inverter/{uid}/{id}/stm/info
 *             { version: "a.b.c", crc32? }
 *  - fetch  : GET /api/stm-firmware?deviceId=&userId=  -> StmTarget
 *  - trigger: MQTT inverter/{uid}/{id}/stm/update (non-retained)
 *             { action: "stm_update", version, crc32, force }
 *  - status : MQTT inverter/{uid}/{id}/stm/ota/status
 *             { status, progress?, message? }
 */
@Injectable()
export class StmFirmwareService {
  private readonly logger = new Logger(StmFirmwareService.name);
  private readonly triggerAt = new Map<string, number>();
  readonly minEspVersion: string;
  /**
   * STM32 images live next to the ESP32 firmware, one folder per version:
   *   {baseUrl}/{product}/{version}/app.bin (+ app.json)
   * e.g. https://giabao-inverter.com/firmware/stm/inverter/3.4.1/app.bin
   * (nginx on the firmware server proxies /firmware/stm/ to DO Spaces).
   */
  readonly baseUrl: string;

  constructor(
    @InjectModel(StmFirmware.name)
    private readonly stmFirmwareModel: Model<StmFirmwareDocument>,
    @InjectModel(InverterDevice.name)
    private readonly inverterDeviceModel: Model<InverterDeviceDocument>,
    private readonly mqttService: MqttService,
    private readonly betaFirmwareDeviceService: BetaFirmwareDeviceService,
    configService: ConfigService,
  ) {
    // First ESP32 firmware that implements STM32 FOTA (set when released).
    this.minEspVersion = configService.get<string>(
      'STM_FOTA_MIN_ESP_VERSION',
      '1.0.15',
    );
    this.baseUrl = configService
      .get<string>('STM_FIRMWARE_BASE_URL', `${FIRMWARE_BASE_URL}/stm`)
      .replace(/\/+$/, '');
  }

  /** Conventional location of an image: {baseUrl}/{product}/{version}/app.bin */
  defaultBinUrl(product: StmProduct, version: string): string {
    return `${this.baseUrl}/${product}/${version}/app.bin`;
  }

  // ======================= Registry (CMS) ==================================

  list(product?: StmProduct) {
    return this.stmFirmwareModel
      .find(product ? { product } : {})
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  /**
   * Register a static image. Downloads app.json + app.bin and verifies size,
   * CRC32 and the vector table, so a broken upload can never be offered.
   */
  async register(dto: {
    product: StmProduct;
    channel: StmChannel;
    version: string;
    binUrl?: string;
    manifestUrl?: string;
    notes?: string;
  }) {
    const parsed = parseStmVersion(dto.version);
    if (!parsed) {
      throw new BadRequestException(
        'Version must be "major.voltage.patch", e.g. 1.2.0 (2nd number: 1 = 12V, 2 = 24V, 3 = 36V, 4 = 48V)',
      );
    }
    // Default: the conventional path under the firmware server (same scheme
    // as the ESP32 firmware); an explicit URL overrides it.
    const binUrl =
      dto.binUrl?.trim() || this.defaultBinUrl(dto.product, parsed.version);
    const bin = await this.fetchBinary(binUrl);
    const crc = normalizeCrc32(zlib.crc32(bin) >>> 0)!;

    // app.json is optional: when present (explicit URL, or next to app.bin)
    // its size/crc32 must match the downloaded file.
    const manifestUrl =
      dto.manifestUrl?.trim() || binUrl.replace(/[^/]+$/, 'app.json');
    const manifest = await this.fetchManifest(
      manifestUrl,
      !!dto.manifestUrl?.trim(),
    );
    if (manifest) {
      if (manifest.size !== undefined && Number(manifest.size) !== bin.length) {
        throw new BadRequestException(
          `Size mismatch: app.json says ${Number(manifest.size)} B, app.bin is ${bin.length} B`,
        );
      }
      const expected = normalizeCrc32(manifest.crc32);
      if (expected && expected !== crc) {
        throw new BadRequestException(
          `CRC32 mismatch: app.json ${expected}, app.bin ${crc}`,
        );
      }
    }

    // Vector table sanity: initial SP in SRAM, reset handler inside the image.
    const appBaseStr =
      manifest && typeof manifest.app_base === 'string'
        ? manifest.app_base
        : null;
    if (bin.length < 8 || bin.readUInt32LE(0) >>> 24 !== 0x20) {
      throw new BadRequestException(
        'app.bin does not look like an STM32 image (bad stack pointer)',
      );
    }
    const base = appBaseStr ? parseInt(appBaseStr, 16) : NaN;
    const reset = bin.readUInt32LE(4) & ~1;
    if (Number.isFinite(base) && (reset < base || reset >= base + bin.length)) {
      throw new BadRequestException(
        'app.bin reset vector is outside the image (wrong app_base?)',
      );
    }

    try {
      const created = await this.stmFirmwareModel.create({
        product: dto.product,
        channel: dto.channel,
        version: parsed.version,
        major: parsed.major,
        voltageCode: parsed.voltageCode,
        url: binUrl,
        size: bin.length,
        crc32: crc,
        appBase: appBaseStr,
        built:
          manifest && typeof manifest.built === 'string'
            ? manifest.built
            : null,
        notes: dto.notes?.trim() ?? '',
        enabled: true,
      });
      this.logger.log(
        `Registered STM32 ${dto.product}/${dto.channel} v${parsed.version} (${chipLabel(parsed.major)} ${voltageLabel(parsed.voltageCode)}) ${crc}`,
      );
      return created.toObject();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          `v${parsed.version} (${dto.channel}) is already registered`,
        );
      }
      throw err;
    }
  }

  async setEnabled(id: string, enabled: boolean) {
    const fw = await this.stmFirmwareModel
      .findByIdAndUpdate(id, { enabled }, { new: true })
      .lean()
      .exec();
    if (!fw) throw new NotFoundException('STM32 firmware not found');
    return fw;
  }

  async remove(id: string) {
    const fw = await this.stmFirmwareModel.findByIdAndDelete(id).lean().exec();
    if (!fw) throw new NotFoundException('STM32 firmware not found');
    return { message: 'Deleted' };
  }

  /** app.json, or null when it is optional (default URL) and missing. */
  private async fetchManifest(
    url: string,
    required: boolean,
  ): Promise<Record<string, unknown> | null> {
    let text: string;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        if (!required && (res.status === 404 || res.status === 403)) {
          return null;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      text = await res.text();
    } catch (err) {
      throw new BadRequestException(
        `Cannot download app.json (${url}): ${(err as Error).message}`,
      );
    }
    try {
      // PowerShell writes a UTF-8 BOM.
      return JSON.parse(text.replace(/^\uFEFF/, '')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException(`app.json is not valid JSON (${url})`);
    }
  }

  private async fetchBinary(url: string): Promise<Buffer> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
        throw new Error(`unexpected size ${buf.length} B`);
      }
      return buf;
    } catch (err) {
      throw new BadRequestException(
        `Cannot download app.bin (${url}): ${(err as Error).message}`,
      );
    }
  }

  // ======================= Targets ==========================================

  private toTarget(fw: StmFirmware): StmTarget {
    return {
      id: String(fw._id),
      product: fw.product,
      channel: fw.channel,
      version: fw.version,
      major: fw.major,
      chip: chipLabel(fw.major),
      voltageCode: fw.voltageCode,
      voltage: voltageLabel(fw.voltageCode),
      url: fw.url,
      size: fw.size,
      crc32: fw.crc32,
      appBase: fw.appBase ?? null,
    };
  }

  /**
   * Image a board should run: the highest enabled stable version with the
   * same major (chip) and voltage class; devices on the beta list may also
   * get a (higher) beta.
   */
  async findTarget(
    product: StmProduct,
    major: number,
    voltageCode: number,
    beta: boolean,
  ): Promise<StmTarget | null> {
    const channels: StmChannel[] = beta ? ['stable', 'beta'] : ['stable'];
    const list = await this.stmFirmwareModel
      .find({
        product,
        major,
        voltageCode,
        enabled: true,
        channel: { $in: channels },
      })
      .lean()
      .exec();
    if (list.length === 0) return null;
    list.sort((a, b) => compareFirmwareVersions(b.version, a.version));
    return this.toTarget(list[0]);
  }

  espSupportsStmFota(espVersion?: string | null): boolean {
    if (!espVersion) return false;
    return compareFirmwareVersions(espVersion, this.minEspVersion) >= 0;
  }

  /** Device already runs the target image (or newer)? */
  isUpToDate(device: InverterDevice, target: StmTarget): boolean {
    if (device.stmFwCrc && normalizeCrc32(device.stmFwCrc) === target.crc32) {
      return true;
    }
    const current = parseStmVersion(device.stmFwVersion);
    return (
      !!current && compareFirmwareVersions(current.version, target.version) >= 0
    );
  }

  async describe(device: InverterDevice): Promise<DeviceStmInfo> {
    const supported = this.espSupportsStmFota(device.firmwareVersion);
    const current = parseStmVersion(device.stmFwVersion);
    let target: StmTarget | null = null;
    let reason: DeviceStmInfo['reason'] = null;
    if (!supported) {
      reason = 'esp_firmware_too_old';
    } else if (!current) {
      reason = 'version_unknown';
    } else {
      target = await this.findTarget(
        'inverter',
        current.major,
        current.voltageCode,
        this.betaFirmwareDeviceService.isBeta(device.deviceId, device.userId),
      );
      if (!target) reason = 'no_firmware';
    }
    return {
      version: current?.version ?? device.stmFwVersion ?? null,
      major: current?.major ?? null,
      chip: chipLabel(current?.major),
      voltageCode: current?.voltageCode ?? null,
      voltage: voltageLabel(current?.voltageCode),
      crc32: device.stmFwCrc ?? null,
      reportedAt: device.stmInfoAt ?? null,
      supported,
      minEspVersion: this.minEspVersion,
      target,
      updateAvailable: !!target && !this.isUpToDate(device, target),
      reason,
      lastOta: device.stmOta ?? null,
    };
  }

  private async findDevice(userId: string, deviceId: string) {
    const device = await this.inverterDeviceModel
      .findOne({ userId, deviceId })
      .lean()
      .exec();
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);
    return device;
  }

  async describeByUserDevice(userId: string, deviceId: string) {
    return this.describe(await this.findDevice(userId, deviceId));
  }

  async describeById(id: string) {
    const device = await this.inverterDeviceModel.findById(id).lean().exec();
    if (!device) throw new NotFoundException(`Device with ID ${id} not found`);
    return {
      userId: device.userId,
      deviceId: device.deviceId,
      ...(await this.describe(device)),
    };
  }

  /** ESP32: image to download for this device (404 when none). */
  async targetForEsp(userId: string, deviceId: string): Promise<StmTarget> {
    const info = await this.describeByUserDevice(userId, deviceId);
    if (!info.target) {
      throw new NotFoundException(
        `No STM32 firmware for this device (${info.reason ?? 'unknown'})`,
      );
    }
    return info.target;
  }

  // ======================= Device reports ===================================

  async reportInfo(
    userId: string,
    deviceId: string,
    info: { version?: unknown; crc32?: unknown },
  ) {
    const parsed = parseStmVersion(info.version);
    if (!parsed) {
      throw new BadRequestException(
        'version is required as "major.voltage.patch", e.g. 1.2.0',
      );
    }
    const crc = normalizeCrc32(info.crc32);

    const device = await this.inverterDeviceModel
      .findOneAndUpdate(
        { userId, deviceId },
        {
          $set: {
            stmFwVersion: parsed.version,
            stmFwCrc: crc,
            stmInfoAt: new Date(),
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);
    return {
      version: parsed.version,
      voltage: voltageLabel(parsed.voltageCode),
      crc32: crc,
    };
  }

  @OnEvent('stm.info.received')
  async onInfoMessage(payload: {
    userId: string;
    deviceId: string;
    data: Record<string, unknown>;
  }) {
    try {
      await this.reportInfo(payload.userId, payload.deviceId, payload.data);
    } catch {
      // Bad/unknown report: ignore (the HTTP path reports errors).
    }
  }

  @OnEvent('stm.ota.status.received')
  async onOtaStatus(payload: {
    userId: string;
    deviceId: string;
    status?: string;
    progress?: number;
    message?: string;
  }) {
    if (!payload.status) return;
    await this.inverterDeviceModel
      .updateOne(
        { userId: payload.userId, deviceId: payload.deviceId },
        {
          $set: {
            'stmOta.status': payload.status,
            'stmOta.progress':
              typeof payload.progress === 'number' ? payload.progress : null,
            'stmOta.message':
              typeof payload.message === 'string'
                ? payload.message.slice(0, 200)
                : null,
            'stmOta.at': new Date(),
          },
        },
      )
      .exec()
      .catch(() => undefined);
  }

  // ======================= Trigger ==========================================

  /**
   * Validate and publish the STM32 update trigger. Used by the CMS (single +
   * bulk), the web and the mobile app.
   */
  async trigger(
    userId: string,
    deviceId: string,
    opts: {
      force?: boolean;
      source: 'cms' | 'web' | 'app' | 'bulk';
      skipCooldown?: boolean;
    },
  ): Promise<{ success: true; targetVersion: string; crc32: string }> {
    const device = await this.findDevice(userId, deviceId);
    const info = await this.describe(device);
    if (!info.target) {
      const msg: Record<string, string> = {
        esp_firmware_too_old: `ESP32 firmware ${device.firmwareVersion ?? '?'} không hỗ trợ cập nhật STM32 (cần >= ${this.minEspVersion})`,
        version_unknown:
          'Chưa biết phiên bản STM32 của thiết bị (STM32 chưa báo phiên bản)',
        no_firmware: `Chưa có firmware STM32 cho ${info.chip ?? '?'} ${info.voltage ?? '?'}`,
      };
      throw new BadRequestException(
        msg[info.reason ?? ''] ?? 'Không có firmware STM32 phù hợp',
      );
    }
    if (!info.updateAvailable && !opts.force) {
      throw new BadRequestException(
        `STM32 đã ở phiên bản mới nhất (${info.version ?? info.crc32 ?? info.target.version})`,
      );
    }
    if (!this.mqttService.isConnected()) {
      throw new HttpException(
        'Máy chủ MQTT đang mất kết nối, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const key = `${userId}/${deviceId}`;
    const now = Date.now();
    if (!opts.skipCooldown) {
      const last = this.triggerAt.get(key) ?? 0;
      if (now - last < TRIGGER_COOLDOWN_MS) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message:
              'Đã gửi lệnh cập nhật STM32, vui lòng chờ thiết bị cập nhật xong',
            retryAfterSeconds: Math.ceil(
              (TRIGGER_COOLDOWN_MS - (now - last)) / 1000,
            ),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    if (this.triggerAt.size > 2000) this.triggerAt.clear();
    this.triggerAt.set(key, now);

    await this.publishTrigger(userId, deviceId, info.target, !!opts.force);
    await this.inverterDeviceModel
      .updateOne(
        { userId, deviceId },
        {
          $set: {
            stmOta: {
              status: 'sent',
              progress: null,
              message: null,
              targetVersion: info.target.version,
              source: opts.source,
              at: new Date(),
            },
          },
        },
      )
      .exec();
    return {
      success: true,
      targetVersion: info.target.version,
      crc32: info.target.crc32,
    };
  }

  /** Small, non-retained trigger (PubSubClient buffer on the ESP32 is 256 B). */
  publishTrigger(
    userId: string,
    deviceId: string,
    target: StmTarget,
    force: boolean,
  ): Promise<void> {
    return this.mqttService.publish(
      `inverter/${userId}/${deviceId}/stm/update`,
      {
        action: 'stm_update',
        version: target.version,
        crc32: target.crc32,
        force,
        ts: Date.now(),
      },
    );
  }
}
