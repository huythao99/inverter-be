import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Header,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from '../auth/decorators/firebase-user.decorator';
import { FirebaseUser } from '../auth/strategies/firebase.strategy';
import { ChargerDeviceService } from '../services/charger-device.service';
import { ChargerSettingService } from '../services/charger-setting.service';
import { ChargerDataService } from '../services/charger-data.service';
import { UpdateUserChargerSettingDto } from '../dto/update-user-charger-setting.dto';
import {
  decodeChargerValue,
  encodeChargerValue,
} from '../utils/charger-value.util';

// End-user (mobile/web) charger API. Auth: Firebase JWT (same as inverter's
// /api/user/*). Chargers have no grid-tie / share / schedule / daily-totals.
@Controller('api/user/chargers')
@UseGuards(FirebaseAuthGuard)
export class UserChargerController {
  constructor(
    private readonly chargerDeviceService: ChargerDeviceService,
    private readonly chargerSettingService: ChargerSettingService,
    private readonly chargerDataService: ChargerDataService,
  ) {}

  // Ensure the charger belongs to the authenticated user (throws if not).
  private async assertOwned(userId: string, deviceId: string) {
    const device = await this.chargerDeviceService.findByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    if (!device) {
      throw new NotFoundException(`Charger ${deviceId} not found`);
    }
    return device;
  }

  // List the user's chargers
  @Get()
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getChargers(@CurrentFirebaseUser() user: FirebaseUser) {
    const chargers = await this.chargerDeviceService.findByUserId(user.uid);
    return { chargers };
  }

  // Charger detail
  @Get(':deviceId')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getCharger(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    return this.assertOwned(user.uid, deviceId);
  }

  // Latest telemetry/config snapshot (merged, with online/offline status)
  @Get(':deviceId/data/latest')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getLatestData(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const data = await this.chargerDataService.findLatestByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );
    return data || { userId: user.uid, deviceId, status: 'offline' };
  }

  // Read setting (raw value + decoded vbat/ibat)
  @Get(':deviceId/settings')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const setting = await this.chargerSettingService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );
    if (!setting) {
      return { userId: user.uid, deviceId, value: '' };
    }
    const decoded = decodeChargerValue(setting.value);
    return { ...setting, ...(decoded ?? {}) };
  }

  // Update setting: either { value: "HHHHLLLL" } or { vbat, ibat }.
  // Backend then publishes cmd/settings so the device pulls the new value.
  @Patch(':deviceId/settings')
  async updateSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateUserChargerSettingDto,
  ) {
    await this.assertOwned(user.uid, deviceId);

    let value: string;
    if (dto.value) {
      value = dto.value;
    } else if (dto.vbat !== undefined && dto.ibat !== undefined) {
      value = encodeChargerValue(dto.vbat, dto.ibat);
    } else {
      throw new BadRequestException(
        'Provide either "value" (HHHHLLLL) or both "vbat" and "ibat"',
      );
    }

    const result =
      await this.chargerSettingService.updateValueByUserIdAndDeviceId(
        user.uid,
        deviceId,
        value,
      );
    const decoded = decodeChargerValue(value);
    return {
      ...(result ?? { userId: user.uid, deviceId, value }),
      ...(decoded ?? {}),
    };
  }

  // Update charger description
  @Patch(':deviceId/description')
  async updateDescription(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body('description') description: string,
  ) {
    const device = await this.chargerDeviceService.updateDescription(
      user.uid,
      deviceId,
      description ?? '',
    );
    if (!device) {
      throw new NotFoundException(`Charger ${deviceId} not found`);
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

  // Update charger name / description
  @Patch(':deviceId')
  async updateCharger(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() updateData: { deviceName?: string; description?: string },
  ) {
    await this.assertOwned(user.uid, deviceId);
    return this.chargerDeviceService.updateByUserIdAndDeviceId(
      user.uid,
      deviceId,
      updateData,
    );
  }
}
