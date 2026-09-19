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
  Header,
} from '@nestjs/common';
import { ChargerDeviceService } from '../services/charger-device.service';
import { CreateChargerDeviceDto } from '../dto/create-charger-device.dto';
import { UpdateChargerDeviceDto } from '../dto/update-charger-device.dto';
import { QueryInverterDataDto } from '../dto/query-inverter-data.dto';

@Controller('api/charger-device')
export class ChargerDeviceController {
  constructor(private readonly chargerDeviceService: ChargerDeviceService) {}

  // Device registration (firmware calls this on first online)
  @Post('data')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateChargerDeviceDto) {
    await this.chargerDeviceService.create(dto);
  }

  @Get('data')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  findAll(@Query() query: QueryInverterDataDto) {
    return this.chargerDeviceService.findAll(query.page, query.limit);
  }

  // List a user's chargers (app/web)
  @Get('data/device/:userId')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  findByUserId(@Param('userId') userId: string) {
    return this.chargerDeviceService.findByUserId(userId);
  }

  @Get('data/:userId/:deviceId')
  async findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.chargerDeviceService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    if (!device) {
      throw new NotFoundException(
        `Charger ${deviceId} not found for user ${userId}`,
      );
    }
    return device;
  }

  @Get('data/:id')
  async findOne(@Param('id') id: string) {
    const device = await this.chargerDeviceService.findOne(id);
    if (!device) {
      throw new NotFoundException(`Charger with ID ${id} not found`);
    }
    return device;
  }

  @Patch('data/:userId/:deviceId')
  async updateByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateChargerDeviceDto,
  ) {
    const device = await this.chargerDeviceService.updateByUserIdAndDeviceId(
      userId,
      deviceId,
      dto,
    );
    if (!device) {
      throw new NotFoundException(
        `Charger ${deviceId} not found for user ${userId}`,
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
    const device = await this.chargerDeviceService.updateDescription(
      userId,
      deviceId,
      description,
    );
    if (!device) {
      throw new NotFoundException(
        `Charger ${deviceId} not found for user ${userId}`,
      );
    }
    return { message: 'Description updated successfully', device };
  }

  // Firmware version report (firmware calls after OTA reboot)
  @Patch('data/:userId/:deviceId/firmware')
  async updateFirmwareVersion(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body('firmwareVersion') firmwareVersion: string,
  ) {
    if (!firmwareVersion) {
      throw new NotFoundException('firmwareVersion is required');
    }
    const device = await this.chargerDeviceService.updateFirmwareVersion(
      userId,
      deviceId,
      firmwareVersion,
    );
    if (!device) {
      throw new NotFoundException(
        `Charger ${deviceId} not found for user ${userId}`,
      );
    }
    return { message: 'Firmware version updated successfully', device };
  }

  @Delete('data/:userId/:deviceId')
  async removeByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.chargerDeviceService.removeByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    if (!device) {
      throw new NotFoundException(
        `Charger ${deviceId} not found for user ${userId}`,
      );
    }
    return device;
  }

  @Delete('data/:id')
  async remove(@Param('id') id: string) {
    const device = await this.chargerDeviceService.remove(id);
    if (!device) {
      throw new NotFoundException(`Charger with ID ${id} not found`);
    }
    return device;
  }
}
