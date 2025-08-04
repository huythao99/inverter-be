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
  findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.inverterScheduleService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );
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
