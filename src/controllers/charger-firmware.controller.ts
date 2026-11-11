import {
  Controller,
  Get,
  Query,
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
}
