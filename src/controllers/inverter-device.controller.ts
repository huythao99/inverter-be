import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { InverterDeviceService } from '../services/inverter-device.service';
import { CreateInverterDeviceDto } from '../dto/create-inverter-device.dto';
import { UpdateInverterDeviceDto } from '../dto/update-inverter-device.dto';

@Controller('api/inverter-device')
export class InverterDeviceController {
  constructor(private readonly inverterDeviceService: InverterDeviceService) {}

  @Post('data')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createInverterDeviceDto: CreateInverterDeviceDto) {
    await this.inverterDeviceService.create(createInverterDeviceDto);
  }

  @Get('data')
  findAll() {
    return this.inverterDeviceService.findAll();
  }

  @Get('data/device/:userId')
  findByUserId(@Param('userId') userId: string) {
    return this.inverterDeviceService.findByUserId(userId);
  }

  @Get('data/:userId/:deviceId')
  findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.inverterDeviceService.findByUserIdAndDeviceId(userId, deviceId);
  }

  @Get('data/:id')
  findOne(@Param('id') id: string) {
    return this.inverterDeviceService.findOne(id);
  }

  @Patch('data/:id')
  update(
    @Param('id') id: string,
    @Body() updateInverterDeviceDto: UpdateInverterDeviceDto,
  ) {
    return this.inverterDeviceService.update(id, updateInverterDeviceDto);
  }

  @Patch('data/:userId/:deviceId')
  updateByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() updateInverterDeviceDto: UpdateInverterDeviceDto,
  ) {
    return this.inverterDeviceService.updateByUserIdAndDeviceId(
      userId,
      deviceId,
      updateInverterDeviceDto,
    );
  }

  @Delete('data/:id')
  remove(@Param('id') id: string) {
    return this.inverterDeviceService.remove(id);
  }

  @Delete('data/:userId/:deviceId')
  removeByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.inverterDeviceService.removeByUserIdAndDeviceId(
      userId,
      deviceId,
    );
  }

  @Delete('data')
  deleteAll() {
    return this.inverterDeviceService.deleteAll();
  }
}
