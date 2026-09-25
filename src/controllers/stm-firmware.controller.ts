import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { StmFirmwareService } from '../services/stm-firmware.service';

/**
 * ESP32-facing STM32 FOTA endpoints (same trust model as the existing
 * /api/firmware and /api/inverter-device/.../firmware routes).
 */
@Controller('api/stm-firmware')
export class StmFirmwareController {
  constructor(private readonly stmFirmwareService: StmFirmwareService) {}

  // Image the device should flash into its STM32 (404 if none).
  @Get()
  getTarget(
    @Query('deviceId') deviceId?: string,
    @Query('userId') userId?: string,
  ) {
    if (!deviceId || !userId) {
      throw new BadRequestException('deviceId and userId are required');
    }
    return this.stmFirmwareService.targetForEsp(userId, deviceId);
  }

  // What the STM32 runs: { version: "a.b.c", crc32? } (b = voltage class)
  @Patch('info/:userId/:deviceId')
  reportInfo(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body()
    body: { version?: unknown; crc32?: unknown },
  ) {
    return this.stmFirmwareService.reportInfo(userId, deviceId, body ?? {});
  }
}
