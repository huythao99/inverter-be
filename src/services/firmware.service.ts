import { Injectable } from '@nestjs/common';
import { InverterDeviceService } from './inverter-device.service';
import { BetaFirmwareDeviceService } from './beta-firmware-device.service';

/** Where all firmware files are served from (ESP32, charger, STM32). */
export const FIRMWARE_BASE_URL = 'https://giabao-inverter.com/firmware';

/**
 * Fallback ESP32 inverter firmware, used only while no build uploaded from the
 * CMS (ESP32 Firmware page) is active for a channel: the fixed files
 * firmware.bin (stable) and firmware-beta.bin (beta).
 */
export const DEFAULT_FIRMWARE_VERSION = '1.0.14';
export const DEFAULT_BETA_FIRMWARE_VERSION = '1.0.14';

export type EspFirmwareChannel = 'stable' | 'beta';

export interface ActiveEspFirmware {
  version: string;
  url: string;
  source: 'cms' | 'default';
}

const DEFAULT_ACTIVE: Record<EspFirmwareChannel, ActiveEspFirmware> = {
  stable: {
    version: DEFAULT_FIRMWARE_VERSION,
    url: `${FIRMWARE_BASE_URL}/firmware.bin`,
    source: 'default',
  },
  beta: {
    version: DEFAULT_BETA_FIRMWARE_VERSION,
    url: `${FIRMWARE_BASE_URL}/firmware-beta.bin`,
    source: 'default',
  },
};

// Active build per channel. Kept in memory (sync reads everywhere) and set by
// EspFirmwareService from the esp_firmwares collection at startup, after
// every change and periodically.
const active: Record<EspFirmwareChannel, ActiveEspFirmware> = {
  stable: { ...DEFAULT_ACTIVE.stable },
  beta: { ...DEFAULT_ACTIVE.beta },
};

export function activeEspFirmware(
  channel: EspFirmwareChannel,
): ActiveEspFirmware {
  return { ...active[channel] };
}

/** null -> back to the default file of that channel. */
export function setActiveEspFirmware(
  channel: EspFirmwareChannel,
  fw: { version: string; url: string } | null,
): void {
  active[channel] = fw
    ? { version: fw.version, url: fw.url, source: 'cms' }
    : { ...DEFAULT_ACTIVE[channel] };
}

/** Newest STABLE ESP32 inverter firmware version. */
export function newestFirmwareVersion(): string {
  return active.stable.version;
}

/** Newest BETA version, served to the devices on the CMS beta list. */
export function newestBetaFirmwareVersion(): string {
  return active.beta.version;
}

/**
 * Devices numbered below this (e.g. GTIControl435) are legacy units that are
 * never offered an OTA update: the app always shows them as up to date and
 * bulk updates skip them.
 */
export const LEGACY_DEVICE_MAX_NUMBER = 436;

/** True for legacy devices (numeric part of the deviceId < 436). */
export function isLegacyDevice(deviceId: string): boolean {
  const n = parseInt(deviceId.replace(/\D/g, ''), 10);
  return !isNaN(n) && n < LEGACY_DEVICE_MAX_NUMBER;
}

/** Compare dotted versions numerically: <0 if a<b, 0 if equal, >0 if a>b. */
export function compareFirmwareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

@Injectable()
export class FirmwareService {
  constructor(
    private readonly inverterDeviceService: InverterDeviceService,
    private readonly betaFirmwareDeviceService: BetaFirmwareDeviceService,
  ) {}

  // Beta devices are managed from the CMS (matched by deviceId, optionally
  // scoped to a userId) instead of being hard-coded here.
  getFirmwareUrl(deviceId: string, userId?: string): { url: string } {
    const channel: EspFirmwareChannel = this.betaFirmwareDeviceService.isBeta(
      deviceId,
      userId,
    )
      ? 'beta'
      : 'stable';
    return { url: active[channel].url };
  }

  async getDeviceFirmwareVersion(
    userId: string,
    deviceId: string,
  ): Promise<{ firmwareVersion: string | null }> {
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );

    // Legacy devices are always reported as up to date (no OTA for them).
    if (isLegacyDevice(deviceId)) {
      return {
        firmwareVersion: newestFirmwareVersion(),
      };
    }
    return {
      firmwareVersion: device?.firmwareVersion ?? newestFirmwareVersion(),
    };
  }

  /** Newest version a given device should run (beta list -> beta build). */
  getTargetVersion(deviceId?: string, userId?: string): string {
    if (deviceId && this.betaFirmwareDeviceService.isBeta(deviceId, userId)) {
      return newestBetaFirmwareVersion();
    }
    return newestFirmwareVersion();
  }

  /**
   * Without deviceId: the stable version (older apps call it that way).
   * With deviceId (+ userId): the beta version for devices on the beta list,
   * so the app offers them the beta update.
   */
  getNewestFirmwareVersion(
    deviceId?: string,
    userId?: string,
  ): { version: string } {
    return { version: this.getTargetVersion(deviceId, userId) };
  }
}
