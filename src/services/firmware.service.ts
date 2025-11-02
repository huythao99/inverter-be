import { Injectable } from '@nestjs/common';
import { InverterDeviceService } from './inverter-device.service';

@Injectable()
export class FirmwareService {
  private readonly FIRMWARE_BASE_URL = 'https://giabao-inverter.com/firmware';

  constructor(private readonly inverterDeviceService: InverterDeviceService) {}

  async getFirmwareUrl(deviceId: string): Promise<{ url: string }> {
    // You can add logic here to return different firmware URLs based on deviceId
    // For now, returning the same firmware URL for all devices
    const firmwareUrl = `${this.FIRMWARE_BASE_URL}/firmware.bin`;

    return {
      url: firmwareUrl,
    };
  }

  async getDeviceFirmwareVersion(userId: string, deviceId: string): Promise<{ firmwareVersion: string | null }> {
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(userId, deviceId);

    // Extract numeric part from deviceId (e.g., GTIControl495 -> 495)
    const numericPart = parseInt(deviceId.replace(/\D/g, ''), 10);

    // If device number < 436, return 1.0.1, otherwise return 1.0.0
    if (!isNaN(numericPart) && numericPart < 436) {
      return {
        firmwareVersion: '1.0.1',
      };
    }
    return {
      firmwareVersion: device?.firmwareVersion ?? '1.0.0',
    };
  }

  async getNewestFirmwareVersion(): Promise<{ version: string }> {
    // Return the current newest firmware version
    // You can update this version number when new firmware is available
    const newestVersion = '1.0.1';
    
    return {
      version: newestVersion,
    };
  }
}