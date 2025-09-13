import { Controller, Get, Query, HttpStatus, HttpException } from '@nestjs/common';
import { FirmwareService } from '../services/firmware.service';

@Controller('api/firmware')
export class FirmwareController {
  constructor(private readonly firmwareService: FirmwareService) {}

  @Get()
  async getFirmwareUrl(@Query('deviceId') deviceId: string) {
    if (!deviceId) {
      throw new HttpException('deviceId is required', HttpStatus.BAD_REQUEST);
    }

    return this.firmwareService.getFirmwareUrl(deviceId);
  }

  @Get('version')
  async getDeviceFirmwareVersion(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId: string,
  ) {
    if (!userId || !deviceId) {
      throw new HttpException('userId and deviceId are required', HttpStatus.BAD_REQUEST);
    }

    return this.firmwareService.getDeviceFirmwareVersion(userId, deviceId);
  }

  @Get('newest')
  async getNewestFirmwareVersion() {
    return this.firmwareService.getNewestFirmwareVersion();
  }
}