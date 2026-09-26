import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Query,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { auditCtx } from '../utils/audit-context';
import { CacheTTL } from '@nestjs/cache-manager';
import { ChargerSettingService } from '../services/charger-setting.service';
import { UpdateChargerSettingValueDto } from '../dto/update-charger-setting-value.dto';
import { UpdateChargerSettingDto } from '../dto/update-charger-setting.dto';
import { SettingCacheInterceptor } from '../interceptors/setting-cache.interceptor';
import {
  decodeChargerValue,
  encodeChargerValue,
} from '../utils/charger-value.util';

@Controller('api/charger-setting')
export class ChargerSettingController {
  constructor(private readonly chargerSettingService: ChargerSettingService) {}

  /**
   * Firmware calls this with `?source=hardware` and expects `{ value }`
   * (the raw 8-digit string). App/web calls without `source` and additionally
   * gets the decoded `vbat`/`ibat` for display.
   */
  @Get('data/:userId/:deviceId')
  @UseInterceptors(SettingCacheInterceptor) // skips cache when ?source=hardware
  @CacheTTL(30000)
  async findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Query('source') source?: string,
  ) {
    const result = await this.chargerSettingService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );

    if (!result) {
      return { message: 'Charger setting not found', userId, deviceId };
    }

    // Hardware only needs the raw value.
    if (source === 'hardware') {
      return { value: result.value };
    }

    // App/web gets the decoded values too.
    const decoded = decodeChargerValue(result.value);
    return { ...result, ...(decoded ?? {}) };
  }

  // App/web: update using raw 8-digit value.
  @Patch('data/:userId/:deviceId/value')
  updateValueByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateChargerSettingValueDto,
    @Req() req: Request,
  ) {
    return this.chargerSettingService.updateValueByUserIdAndDeviceId(
      userId,
      deviceId,
      dto.value,
      auditCtx(req, { actor: userId }),
    );
  }

  // App/web: update using human-friendly VBAT (V) / IBAT (A).
  @Patch('data/:userId/:deviceId')
  async updateByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateChargerSettingDto,
    @Req() req: Request,
  ) {
    const value = encodeChargerValue(dto.vbat, dto.ibat);
    const result =
      await this.chargerSettingService.updateValueByUserIdAndDeviceId(
        userId,
        deviceId,
        value,
        auditCtx(req, { actor: userId }),
      );
    return {
      ...(result ?? { userId, deviceId, value }),
      vbat: dto.vbat,
      ibat: dto.ibat,
    };
  }
}
