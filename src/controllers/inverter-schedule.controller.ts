import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { CreateInverterScheduleDto } from '../dto/create-inverter-schedule.dto';
import { UpdateInverterScheduleDto } from '../dto/update-inverter-schedule.dto';
import { UpdateInverterScheduleValueDto } from '../dto/update-inverter-schedule-value.dto';

@Controller('api/inverter-schedule')
export class InverterScheduleController {
  constructor(
    private readonly inverterScheduleService: InverterScheduleService,
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
  ) {
    try {
      const result = await this.inverterScheduleService.findByUserIdAndDeviceId(
        userId,
        deviceId,
      );
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
