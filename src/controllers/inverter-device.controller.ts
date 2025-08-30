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
  Query,
  NotFoundException,
} from '@nestjs/common';
import { InverterDeviceService } from '../services/inverter-device.service';
import { CreateInverterDeviceDto } from '../dto/create-inverter-device.dto';
import { UpdateInverterDeviceDto } from '../dto/update-inverter-device.dto';
import { QueryInverterDataDto } from '../dto/query-inverter-data.dto';

@Controller('api/inverter-device')
export class InverterDeviceController {
  constructor(private readonly inverterDeviceService: InverterDeviceService) {}

  @Post('data')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createInverterDeviceDto: CreateInverterDeviceDto) {
    await this.inverterDeviceService.create(createInverterDeviceDto);
  }

  @Get('data')
  findAll(@Query() query: QueryInverterDataDto) {
    return this.inverterDeviceService.findAll(query.page, query.limit);
  }

  @Get('data/device/:userId')
  findByUserId(@Param('userId') userId: string) {
    return this.inverterDeviceService.findByUserId(userId);
  }

  @Get('data/:userId/:deviceId')
  async findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(userId, deviceId);
    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found for user ${userId}`);
    }
    return device;
  }

  @Get('data/:id')
  async findOne(@Param('id') id: string) {
    const device = await this.inverterDeviceService.findOne(id);
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }
    return device;
  }

  @Patch('data/:id')
  async update(
    @Param('id') id: string,
    @Body() updateInverterDeviceDto: UpdateInverterDeviceDto,
  ) {
    const device = await this.inverterDeviceService.update(id, updateInverterDeviceDto);
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }
    return device;
  }

  @Patch('data/:userId/:deviceId')
  async updateByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() updateInverterDeviceDto: UpdateInverterDeviceDto,
  ) {
    const device = await this.inverterDeviceService.updateByUserIdAndDeviceId(
      userId,
      deviceId,
      updateInverterDeviceDto,
    );
    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found for user ${userId}`);
    }
    return device;
  }

  @Delete('data/:id')
  async remove(@Param('id') id: string) {
    const device = await this.inverterDeviceService.remove(id);
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }
    return device;
  }

  @Delete('data/:userId/:deviceId')
  async removeByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.inverterDeviceService.removeByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found for user ${userId}`);
    }
    return device;
  }

  @Delete('data')
  deleteAll() {
    return this.inverterDeviceService.deleteAll();
  }
}
