import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
  ForbiddenException,
  Header,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import {
  CurrentFirebaseUser,
} from '../auth/decorators/firebase-user.decorator';
import { FirebaseUser } from '../auth/strategies/firebase.strategy';
import { InverterDeviceService } from '../services/inverter-device.service';
import { InverterDataService } from '../services/inverter-data.service';
import { InverterSettingService } from '../services/inverter-setting.service';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { DailyTotalsService } from '../services/daily-totals.service';

@Controller('api/user')
@UseGuards(FirebaseAuthGuard)
export class UserApiController {
  constructor(
    private readonly inverterDeviceService: InverterDeviceService,
    private readonly inverterDataService: InverterDataService,
    private readonly inverterSettingService: InverterSettingService,
    private readonly inverterScheduleService: InverterScheduleService,
    private readonly dailyTotalsService: DailyTotalsService,
  ) {}

  // Get user profile from Firebase token
  @Get('profile')
  getProfile(@CurrentFirebaseUser() user: FirebaseUser) {
    return {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoURL: user.photoURL,
    };
  }

  // List user's devices
  @Get('devices')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDevices(@CurrentFirebaseUser() user: FirebaseUser) {
    const devices = await this.inverterDeviceService.findByUserId(user.uid);
    return { devices };
  }

  // Get device detail
  @Get('devices/:deviceId')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDevice(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    return device;
  }

  // Get device settings
  @Get('devices/:deviceId/settings')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const settings = await this.inverterSettingService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    return settings || { userId: user.uid, deviceId, value: '' };
  }

  // Update device settings
  @Patch('devices/:deviceId/settings')
  async updateDeviceSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body('value') value: string,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const settings =
      await this.inverterSettingService.updateValueByUserIdAndDeviceId(
        user.uid,
        deviceId,
        value,
      );

    return settings;
  }

  // Get device schedule
  @Get('devices/:deviceId/schedule')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceSchedule(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const schedule =
      await this.inverterScheduleService.findByUserIdAndDeviceId(
        user.uid,
        deviceId,
      );

    return schedule || { userId: user.uid, deviceId, schedule: '' };
  }

  // Update device schedule
  @Patch('devices/:deviceId/schedule')
  async updateDeviceSchedule(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body('schedule') schedule: string,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const updatedSchedule =
      await this.inverterScheduleService.updateScheduleByUserIdAndDeviceId(
        user.uid,
        deviceId,
        schedule,
      );

    return updatedSchedule;
  }

  // Get recent telemetry data
  @Get('devices/:deviceId/data')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceData(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const data = await this.inverterDataService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
      page,
      limit,
    );

    return data;
  }

  // Get latest telemetry data
  @Get('devices/:deviceId/data/latest')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getLatestDeviceData(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const data = await this.inverterDataService.findLatestByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    return data || { userId: user.uid, deviceId, value: '' };
  }

  // Get daily totals
  @Get('devices/:deviceId/daily-totals')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceDailyTotals(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit: number = 30,
    @Query('offset') offset: number = 0,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const result = await this.dailyTotalsService.findAll({
      userId: user.uid,
      deviceId,
      startDate,
      endDate,
      limit,
      offset,
    });

    return result;
  }

  // Get monthly totals
  @Get('devices/:deviceId/monthly-totals')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceMonthlyTotals(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Query('year') year?: number,
    @Query('month') month?: number,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const result = await this.dailyTotalsService.getMonthlyTotals(
      user.uid,
      deviceId,
      year,
      month,
    );

    return result;
  }

  // Get monthly chart data
  @Get('devices/:deviceId/chart-data')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceChartData(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Query('year') year?: number,
    @Query('month') month?: number,
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const result = await this.dailyTotalsService.getMonthlyChartData(
      user.uid,
      deviceId,
      year,
      month,
    );

    return result;
  }

  // Update device name
  @Patch('devices/:deviceId')
  async updateDevice(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() updateData: { deviceName?: string },
  ) {
    // First verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const updatedDevice =
      await this.inverterDeviceService.updateByUserIdAndDeviceId(
        user.uid,
        deviceId,
        updateData,
      );

    return updatedDevice;
  }
}
