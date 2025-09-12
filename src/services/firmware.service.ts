import { Injectable } from '@nestjs/common';

@Injectable()
export class FirmwareService {
  private readonly FIRMWARE_BASE_URL = 'https://gticontrol.sgp1.digitaloceanspaces.com/firmware';

  async getFirmwareUrl(deviceId: string): Promise<{ url: string }> {
    // You can add logic here to return different firmware URLs based on deviceId
    // For now, returning the same firmware URL for all devices
    const firmwareUrl = `${this.FIRMWARE_BASE_URL}/firmware.bin`;

    return {
      url: firmwareUrl,
    };
  }
}