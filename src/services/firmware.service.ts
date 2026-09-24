import { Injectable } from '@nestjs/common';
import { InverterDeviceService } from './inverter-device.service';
import { BetaFirmwareDeviceService } from './beta-firmware-device.service';

/** Newest ESP32 inverter firmware. Bump when a new build is uploaded. */
export const NEWEST_FIRMWARE_VERSION = '1.0.13';

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
  private readonly FIRMWARE_BASE_URL = 'https://giabao-inverter.com/firmware';

  constructor(
    private readonly inverterDeviceService: InverterDeviceService,
    private readonly betaFirmwareDeviceService: BetaFirmwareDeviceService,
  ) {}

  // Beta devices are managed from the CMS (matched by deviceId, optionally
  // scoped to a userId) instead of being hard-coded here.
  getFirmwareUrl(deviceId: string, userId?: string): { url: string } {
    const firmwareUrl = `${this.FIRMWARE_BASE_URL}/firmware.bin`;
    const firmwareBetaUrl = `${this.FIRMWARE_BASE_URL}/firmware-beta.bin`;
    if (this.betaFirmwareDeviceService.isBeta(deviceId, userId)) {
      return { url: firmwareBetaUrl };
    }
    return {
      url: firmwareUrl,
    };
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
        firmwareVersion: NEWEST_FIRMWARE_VERSION,
      };
    }
    return {
      firmwareVersion: device?.firmwareVersion ?? NEWEST_FIRMWARE_VERSION,
    };
  }

  getNewestFirmwareVersion(): { version: string } {
    // Return the current newest firmware version
    // You can update this version number when new firmware is available
    const newestVersion = NEWEST_FIRMWARE_VERSION;

    return {
      version: newestVersion,
    };
  }
}
