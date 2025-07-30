import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { InverterSettingService } from '../services/inverter-setting.service';
import { CreateInverterSettingDto } from '../dto/create-inverter-setting.dto';
import { UpdateInverterSettingDto } from '../dto/update-inverter-setting.dto';
import { UpdateInverterSettingValueDto } from '../dto/update-inverter-setting-value.dto';

@Controller('api/inverter-setting')
export class InverterSettingController {
  constructor(private readonly inverterSettingService: InverterSettingService) {}

  @Post('data')
  create(@Body() createInverterSettingDto: CreateInverterSettingDto) {
    return this.inverterSettingService.create(createInverterSettingDto);
  }

  @Get('data')
  findAll() {
    return this.inverterSettingService.findAll();
  }

  @Get('data/:userId/:deviceId')
  findByUserIdAndDeviceId(@Param('userId') userId: string, @Param('deviceId') deviceId: string) {
    return this.inverterSettingService.findByUserIdAndDeviceId(userId, deviceId);
  }

  @Get('data/:id')
  findOne(@Param('id') id: string) {
    return this.inverterSettingService.findOne(id);
  }

  @Patch('data/:id')
  update(@Param('id') id: string, @Body() updateInverterSettingDto: UpdateInverterSettingDto) {
    return this.inverterSettingService.update(id, updateInverterSettingDto);
  }

  @Patch('data/:userId/:deviceId')
  updateByUserIdAndDeviceId(@Param('userId') userId: string, @Param('deviceId') deviceId: string, @Body() updateInverterSettingDto: UpdateInverterSettingDto) {
    return this.inverterSettingService.updateByUserIdAndDeviceId(userId, deviceId, updateInverterSettingDto);
  }

  @Patch('data/:userId/:deviceId/value')
  updateValueByUserIdAndDeviceId(@Param('userId') userId: string, @Param('deviceId') deviceId: string, @Body() updateValueDto: UpdateInverterSettingValueDto) {
    return this.inverterSettingService.updateValueByUserIdAndDeviceId(userId, deviceId, updateValueDto.value);
  }

  @Delete('data/:id')
  remove(@Param('id') id: string) {
    return this.inverterSettingService.remove(id);
  }

  @Delete('data')
  deleteAll() {
    return this.inverterSettingService.deleteAll();
  }
} 