import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
} from '@nestjs/common';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { GridTieService } from '../services/grid-tie.service';
import { ShareService } from '../services/share.service';
import { CreateInverterScheduleDto } from '../dto/create-inverter-schedule.dto';
import { UpdateInverterScheduleDto } from '../dto/update-inverter-schedule.dto';
import { UpdateInverterScheduleValueDto } from '../dto/update-inverter-schedule-value.dto';
import { GRID_TIE_OFF_VALUE } from '../constants/grid-tie.constants';

@Controller('api/inverter-schedule')
export class InverterScheduleController {
  constructor(
    private readonly inverterScheduleService: InverterScheduleService,
    private readonly gridTieService: GridTieService,
    private readonly shareService: ShareService,
  ) {}

  @Post('data')
  create(@Body() createInverterScheduleDto: CreateInverterScheduleDto) {
    return this.inverterScheduleService.create(createInverterScheduleDto);
  }

  @Get('data')
  findAll() {
    return this.inverterScheduleService.findAll();
  }

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

      // When grid-tie is OFF, keep each segment's start/end times but force its
      // value to the OFF command. The stored schedule is preserved untouched in
      // the DB; only the response is rewritten. Grid-tie wins over share.
      // e.g. "start=11:00&end=16:59&value=53001040#..." =>
      //      "start=11:00&end=16:59&value=99001001#..."
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

      // For ESP32 calls, apply the share cap to each segment's value (last 4
      // digits). App calls get the raw stored schedule.
      if (source === 'hardware' && result?.schedule) {
        const shared = await this.shareService.getHardwareScheduleValue(
          userId,
          deviceId,
          result.schedule,
        );
        if (shared !== null) {
          return { ...result, schedule: shared, shared: true };
        }
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

  @Get('data/:id')
  findOne(@Param('id') id: string) {
    return this.inverterScheduleService.findOne(id);
  }

  @Patch('data/:id')
  update(
    @Param('id') id: string,
    @Body() updateInverterScheduleDto: UpdateInverterScheduleDto,
  ) {
    return this.inverterScheduleService.update(id, updateInverterScheduleDto);
  }

  @Patch('data/:userId/:deviceId')
  updateByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() updateInverterScheduleDto: UpdateInverterScheduleDto,
  ) {
    return this.inverterScheduleService.updateByUserIdAndDeviceId(
      userId,
      deviceId,
      updateInverterScheduleDto,
    );
  }

  @Patch('data/:userId/:deviceId/schedule')
  updateScheduleByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() updateScheduleDto: UpdateInverterScheduleValueDto,
  ) {
    return this.inverterScheduleService.updateScheduleByUserIdAndDeviceId(
      userId,
      deviceId,
      updateScheduleDto.schedule,
    );
  }

  @Delete('data/:id')
  remove(@Param('id') id: string) {
    return this.inverterScheduleService.remove(id);
  }

  @Delete('data')
  deleteAll() {
    return this.inverterScheduleService.deleteAll();
  }
}
