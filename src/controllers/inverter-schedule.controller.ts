import { Controller, Get, Param, Query } from '@nestjs/common';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { GridTieService } from '../services/grid-tie.service';
import { ShareService } from '../services/share.service';

import {
  GRID_TIE_OFF_VALUE,
  BLACKLIST_OFF_VALUE,
} from '../constants/grid-tie.constants';
import { BlacklistDeviceService } from '../services/blacklist-device.service';
import { InverterSettingService } from '../services/inverter-setting.service';
import { repairSchedule } from '../utils/schedule-value';

@Controller('api/inverter-schedule')
export class InverterScheduleController {
  constructor(
    private readonly inverterScheduleService: InverterScheduleService,
    private readonly gridTieService: GridTieService,
    private readonly shareService: ShareService,
    private readonly blacklistDeviceService: BlacklistDeviceService,
    private readonly inverterSettingService: InverterSettingService,
  ) {}

  @Get('data/:userId/:deviceId')
  async findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Query('source') source?: string,
  ) {
    try {
      const result = await this.inverterScheduleService.findByUserIdAndDeviceId(
        userId,
        deviceId,
      );

      // Blacklisted device: force every segment's value to the OFF command
      // (times preserved). The stored schedule is left untouched in the DB.
      if (this.blacklistDeviceService.isBlacklisted(deviceId, userId)) {
        const schedule = result?.schedule
          ? result.schedule.replace(
              /value=[^&#]*/g,
              `value=${BLACKLIST_OFF_VALUE}`,
            )
          : BLACKLIST_OFF_VALUE;
        return {
          ...(result ?? { userId, deviceId }),
          schedule,
          blacklisted: true,
        };
      }

      // When grid-tie is OFF, keep each segment's start/end times but force its
      // value to the OFF command. The stored schedule is preserved untouched in
      // the DB; only the response is rewritten. Grid-tie wins over share.
      if (await this.gridTieService.isOff(userId, deviceId)) {
        const schedule = result?.schedule
          ? result.schedule.replace(
              /value=[^&#]*/g,
              `value=${GRID_TIE_OFF_VALUE}`,
            )
          : GRID_TIE_OFF_VALUE;
        return {
          ...(result ?? { userId, deviceId }),
          schedule,
          gridTieOff: true,
        };
      }

      // For ESP32 calls: values saved unpadded by older app builds ("01000",
      // blank = use the setting) are filled from the setting (the ESP32 skips
      // a slot that is not 8 digits), then the share cap is applied to each
      // segment's value (last 4 digits). App calls get the stored schedule.
      if (source === 'hardware' && result?.schedule) {
        const setting = await this.inverterSettingService
          .findByUserIdAndDeviceId(userId, deviceId)
          .catch(() => null);
        const repaired = repairSchedule(result.schedule, setting?.value);
        const schedule = repaired.schedule;
        const shared = await this.shareService.getHardwareScheduleValue(
          userId,
          deviceId,
          schedule,
        );
        if (shared !== null) {
          return { ...result, schedule: shared, shared: true };
        }
        if (repaired.fixed) return { ...result, schedule };
      }

      return (
        result || { message: 'Device schedule not found', userId, deviceId }
      );
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.name === 'MongoTimeoutError' ||
          error.message.includes('timeout')
        ) {
          return {
            message: 'Device schedule lookup timeout - device may not exist',
            userId,
            deviceId,
          };
        }
      }
      throw error;
    }
  }
}
