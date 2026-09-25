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

/** Same for the charger ESP32 (fixed firmware-charger.bin). */
export const DEFAULT_CHARGER_FIRMWARE_VERSION = '1.0.0';

export type EspFirmwareChannel = 'stable' | 'beta';

/** Which device the ESP32 build is for. */
export type EspProduct = 'inverter' | 'charger' | 'hybrid';
export const ESP_PRODUCTS: EspProduct[] = ['inverter', 'charger', 'hybrid'];

export interface ActiveEspFirmware {
  version: string;
  url: string;
  source: 'cms' | 'default';
}

const fixed = (version: string, file: string): ActiveEspFirmware => ({
  version,
  url: `${FIRMWARE_BASE_URL}/${file}`,
  source: 'default',
});

const DEFAULT_ACTIVE: Record<
  EspProduct,
  Record<EspFirmwareChannel, ActiveEspFirmware>
> = {
  inverter: {
    stable: fixed(DEFAULT_FIRMWARE_VERSION, 'firmware.bin'),
    beta: fixed(DEFAULT_BETA_FIRMWARE_VERSION, 'firmware-beta.bin'),
  },
  charger: {
    stable: fixed(DEFAULT_CHARGER_FIRMWARE_VERSION, 'firmware-charger.bin'),
    beta: fixed(DEFAULT_CHARGER_FIRMWARE_VERSION, 'firmware-charger.bin'),
  },
  // No hybrid firmware exists yet: "0.0.0" = nothing to offer.
  hybrid: {
    stable: fixed('0.0.0', 'firmware-hybrid.bin'),
    beta: fixed('0.0.0', 'firmware-hybrid.bin'),
  },
};

// Active build per product + channel. Kept in memory (sync reads everywhere)
// and set by EspFirmwareService from the esp_firmwares collection at startup,
// after every change and periodically.
const active: Record<
  EspProduct,
  Record<EspFirmwareChannel, ActiveEspFirmware>
> = {
  inverter: { ...DEFAULT_ACTIVE.inverter },
  charger: { ...DEFAULT_ACTIVE.charger },
  hybrid: { ...DEFAULT_ACTIVE.hybrid },
};

export function activeEspFirmware(
  channel: EspFirmwareChannel,
  product: EspProduct = 'inverter',
): ActiveEspFirmware {
  return { ...active[product][channel] };
}

/** null -> back to the default file of that product + channel. */
export function setActiveEspFirmware(
  product: EspProduct,
  channel: EspFirmwareChannel,
  fw: { version: string; url: string } | null,
): void {
  active[product][channel] = fw
    ? { version: fw.version, url: fw.url, source: 'cms' }
    : { ...DEFAULT_ACTIVE[product][channel] };
}

/** Newest STABLE ESP32 inverter firmware version. */
export function newestFirmwareVersion(): string {
  return active.inverter.stable.version;
}

/** Newest BETA inverter version, served to the devices on the CMS beta list. */
export function newestBetaFirmwareVersion(): string {
  return active.inverter.beta.version;
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
  /**
   * Download URL for the ESP32 (GET /api/firmware). The ESP32 sends only its
   * deviceId, so when no userId is given the beta list is checked against
   * every account that has the device - otherwise a device listed as beta for
   * its user would get the stable file while the app offers the beta version.
   */
  async getFirmwareUrl(
    deviceId: string,
    userId?: string,
  ): Promise<{ url: string }> {
    const channel: EspFirmwareChannel = (await this.isBetaDevice(
      deviceId,
      userId,
    ))
      ? 'beta'
      : 'stable';
    return { url: active.inverter[channel].url };
  }

  private async isBetaDevice(
    deviceId: string,
    userId?: string,
  ): Promise<boolean> {
    if (this.betaFirmwareDeviceService.isBeta(deviceId, userId)) return true;
    if (userId) return false;
    const userIds =
      await this.inverterDeviceService.findUserIdsByDeviceId(deviceId);
    return userIds.some((uid) =>
      this.betaFirmwareDeviceService.isBeta(deviceId, uid),
    );
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
