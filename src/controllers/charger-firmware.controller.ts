import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { ChargerFirmwareService } from '../services/charger-firmware.service';

@Controller('api/charger-firmware')
export class ChargerFirmwareController {
  constructor(
    private readonly chargerFirmwareService: ChargerFirmwareService,
  ) {}

  // OTA: firmware calls this after receiving the `firmware/update` trigger.
  @Get()
  getFirmwareUrl(@Query('deviceId') deviceId: string) {
    if (!deviceId) {
      throw new HttpException('deviceId is required', HttpStatus.BAD_REQUEST);
    }
    return this.chargerFirmwareService.getFirmwareUrl(deviceId);
  }

  @Get('newest')
  getNewestFirmwareVersion() {
    return this.chargerFirmwareService.getNewestFirmwareVersion();
  }

  @Get('version')
  getDeviceFirmwareVersion(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId: string,
  ) {
    if (!userId || !deviceId) {
      throw new HttpException(
        'userId and deviceId are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.chargerFirmwareService.getDeviceFirmwareVersion(
      userId,
      deviceId,
    );
  }

  // App/web (or CMS): trigger an OTA update for a charger.
  @Post('update/:userId/:deviceId')
  @HttpCode(HttpStatus.OK)
  triggerFirmwareUpdate(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body('targetVersion') targetVersion?: string,
  ) {
    return this.chargerFirmwareService.triggerFirmwareUpdate(
      userId,
      deviceId,
      targetVersion,
    );
  }
}
