import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';
import { ChargerSettingService } from '../services/charger-setting.service';
import { SettingCacheInterceptor } from '../interceptors/setting-cache.interceptor';
import { decodeChargerValue } from '../utils/charger-value.util';

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
}
