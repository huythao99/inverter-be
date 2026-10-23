import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  HybridDeviceAccount,
  HybridDeviceAuthGuard,
} from '../auth/guards/hybrid-device-auth.guard';
import { StmFirmwareService } from '../services/stm-firmware.service';
import { HybridDeviceService } from '../services/hybrid-device.service';
import { HybridSettingService } from '../services/hybrid-setting.service';
import { HybridFirmwareService } from '../services/hybrid-firmware.service';
import { ProvisionChargerDto } from '../dto/provision-charger.dto';

// Routes called by the hybrid FIRMWARE (no user session), same shape as the
// charger's. Everything the app/web needs is under /api/user/hybrids.
// Except provision (protected by the one-time claim) and /newest, the device
// authenticates with HTTP Basic = its own broker account (HybridDeviceAuthGuard).
@Controller('api')
export class HybridDeviceController {
  constructor(
    private readonly devices: HybridDeviceService,
    private readonly settings: HybridSettingService,
    private readonly firmware: HybridFirmwareService,
    private readonly stm: StmFirmwareService,
  ) {}

  // Setup: exchange the one-time claim (from the app/web) for the device's
  // own MQTT account (hyb_<deviceId>). Registers it to the claim's owner.
  @Post('hybrid-device/provision')
  @HttpCode(HttpStatus.OK)
  provision(@Body() dto: ProvisionChargerDto) {
    return this.devices.provision(dto.deviceId, dto.claim, dto.firmwareVersion);
  }

  // Firmware version report (after boot / OTA).
  @Patch('hybrid-device/data/:userId/:deviceId/firmware')
  @UseGuards(HybridDeviceAuthGuard)
  async updateFirmwareVersion(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body('firmwareVersion') firmwareVersion: string,
  ) {
    if (!firmwareVersion || typeof firmwareVersion !== 'string') {
      throw new BadRequestException('firmwareVersion is required');
    }
    const device = await this.devices.updateFirmwareVersion(
      userId,
      deviceId,
      firmwareVersion.slice(0, 20),
    );
    if (!device) throw new NotFoundException(`Hybrid ${deviceId} not found`);
    return { message: 'Firmware version updated successfully' };
  }

  /**
   * Desired config for the firmware: { set: "MODE=EXPORT,PEXP=1500,..." }
   * ("" = nothing set yet: the machine keeps its own values). Without
   * ?source=hardware the stored config is added for display.
   */
  @Get('hybrid-setting/data/:userId/:deviceId')
  @UseGuards(HybridDeviceAuthGuard)
  async getSetting(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Query('source') source?: string,
  ) {
    const s = await this.settings.get(userId, deviceId);
    if (source === 'hardware') return { set: s.set };
    return s;
  }

  // OTA: the firmware calls this after the firmware/update trigger.
  @Get('hybrid-firmware')
  @UseGuards(HybridDeviceAuthGuard)
  getFirmwareUrl(@Query('deviceId') deviceId: string) {
    if (!deviceId) throw new BadRequestException('deviceId is required');
    return this.firmware.getFirmwareUrl(deviceId);
  }

  // ---- STM32 FOTA (stm_fota.cpp) ----

  // Image the ESP32 should flash into the STM32: {version,url,size,crc32,...}
  // (404 when none). Owner = the account of the Basic credentials.
  @Get('hybrid-stm-firmware')
  @UseGuards(HybridDeviceAuthGuard)
  getStmTarget(@Req() req: Request & { hybridDevice?: HybridDeviceAccount }) {
    const acct = req.hybridDevice;
    if (!acct) throw new BadRequestException('deviceId is required');
    return this.stm.targetForEsp(acct.userId, acct.deviceId, 'hybrid');
  }

  // After a successful update: { version: "a.b.c", crc32? }.
  @Patch('hybrid-stm-firmware/info/:userId/:deviceId')
  @UseGuards(HybridDeviceAuthGuard)
  reportStmInfo(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: { version?: unknown; crc32?: unknown },
  ) {
    return this.stm.reportInfo(userId, deviceId, body ?? {}, 'hybrid');
  }

  @Get('hybrid-firmware/newest')
  getNewest(@Query('deviceId') deviceId?: string) {
    return this.firmware.getNewestFirmwareVersion(deviceId);
  }
}
