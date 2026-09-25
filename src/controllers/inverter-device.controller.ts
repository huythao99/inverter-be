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
  NotFoundException,
  Header,
} from '@nestjs/common';
import { InverterDeviceService } from '../services/inverter-device.service';
import { CreateInverterDeviceDto } from '../dto/create-inverter-device.dto';

@Controller('api/inverter-device')
export class InverterDeviceController {
  constructor(private readonly inverterDeviceService: InverterDeviceService) {}

  @Post('data')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createInverterDeviceDto: CreateInverterDeviceDto) {
    await this.inverterDeviceService.create(createInverterDeviceDto);
  }

  @Get('data/device/:userId')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  findByUserId(@Param('userId') userId: string) {
    return this.inverterDeviceService.findByUserId(userId);
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
      throw new NotFoundException(
        `Device with ID ${deviceId} not found for user ${userId}`,
      );
    }
    return device;
  }

  @Patch('data/:userId/:deviceId/description')
  async updateDescription(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body('description') description: string,
  ) {
    if (description === undefined || description === null) {
      throw new NotFoundException('description is required');
    }

    const device = await this.inverterDeviceService.updateDescription(
      userId,
      deviceId,
      description,
    );

    if (!device) {
      throw new NotFoundException(
        `Device with ID ${deviceId} not found for user ${userId}`,
      );
    }

    return {
      message: 'Description updated successfully',
      device: {
        userId: device.userId,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        description: device.description,
      },
    };
  }

  @Patch('data/:userId/:deviceId/firmware')
  async updateFirmwareVersion(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body('firmwareVersion') firmwareVersion: string,
  ) {
    if (!firmwareVersion) {
      throw new NotFoundException('firmwareVersion is required');
    }

    const device = await this.inverterDeviceService.updateFirmwareVersion(
      userId,
      deviceId,
      firmwareVersion,
    );

    if (!device) {
      throw new NotFoundException(
        `Device with ID ${deviceId} not found for user ${userId}`,
      );
    }

    return {
      message: 'Firmware version updated successfully',
      device: {
        userId: device.userId,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        firmwareVersion: device.firmwareVersion,
      },
    };
  }
}
