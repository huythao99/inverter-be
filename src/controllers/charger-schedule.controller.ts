import { Controller, Get, Body, Patch, Param, Delete } from '@nestjs/common';
import { ChargerScheduleService } from '../services/charger-schedule.service';
import { UpdateChargerScheduleValueDto } from '../dto/update-charger-schedule-value.dto';

@Controller('api/charger-schedule')
export class ChargerScheduleController {
  constructor(
    private readonly chargerScheduleService: ChargerScheduleService,
  ) {}

  /**
   * Firmware calls with `?source=hardware`; app/web calls without it.
   * Both get `{ schedule }` (the raw schedule string). Returns a friendly
   * message when no schedule exists yet.
   */
  @Get('data/:userId/:deviceId')
  async findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const result = await this.chargerScheduleService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    return (
      result || { message: 'Charger schedule not found', userId, deviceId }
    );
  }

  @Patch('data/:userId/:deviceId/schedule')
  updateScheduleByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateChargerScheduleValueDto,
  ) {
    return this.chargerScheduleService.updateScheduleByUserIdAndDeviceId(
      userId,
      deviceId,
      dto.schedule,
    );
  }

  @Delete('data')
  deleteAll() {
    return this.chargerScheduleService.deleteAll();
  }
}
