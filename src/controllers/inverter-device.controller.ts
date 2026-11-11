import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  HttpStatus,
  HttpCode,
  NotFoundException,
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
