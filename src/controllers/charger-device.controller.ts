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
import { ChargerDeviceService } from '../services/charger-device.service';
import { ChargerProvisionService } from '../services/charger-provision.service';
import { ProvisionChargerDto } from '../dto/provision-charger.dto';

// Routes called by the charger FIRMWARE (no user session). Everything the
// app/web needs lives under /api/user/chargers (Firebase auth).
@Controller('api/charger-device')
export class ChargerDeviceController {
  constructor(
    private readonly chargerDeviceService: ChargerDeviceService,
    private readonly chargerProvisionService: ChargerProvisionService,
  ) {}

  // Setup: exchange the one-time claim (from the app) for the charger's own
  // MQTT account. Also registers the charger to the claim's owner.
  // Replaces the old unauthenticated POST data registration.
  @Post('provision')
  @HttpCode(HttpStatus.OK)
  provision(@Body() dto: ProvisionChargerDto) {
    return this.chargerProvisionService.provision(
      dto.deviceId,
      dto.claim,
      dto.firmwareVersion,
    );
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
}
