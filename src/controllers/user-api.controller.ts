import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
  Header,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from '../auth/decorators/firebase-user.decorator';
import { FirebaseUser } from '../auth/strategies/firebase.strategy';
import { InverterDeviceService } from '../services/inverter-device.service';
import { InverterDataService } from '../services/inverter-data.service';
import { InverterSettingService } from '../services/inverter-setting.service';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { GridTieService } from '../services/grid-tie.service';
import { DailyTotalsService } from '../services/daily-totals.service';
import { SetGridTieDto } from '../dto/set-grid-tie.dto';
import { GRID_TIE_OFF_VALUE } from '../constants/grid-tie.constants';

@Controller('api/user')
@UseGuards(FirebaseAuthGuard)
export class UserApiController {
  constructor(
    private readonly inverterDeviceService: InverterDeviceService,
    private readonly inverterDataService: InverterDataService,
    private readonly inverterSettingService: InverterSettingService,
    private readonly inverterScheduleService: InverterScheduleService,
    private readonly gridTieService: GridTieService,
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

    // When grid-tie is OFF, report the OFF command instead of the stored value
    // (the real value is preserved untouched in the DB).
    if (await this.gridTieService.isOff(user.uid, deviceId)) {
      return {
        ...(settings ?? { userId: user.uid, deviceId }),
        value: GRID_TIE_OFF_VALUE,
        gridTieOff: true,
      };
    }

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

  // Get grid-tie ("hoà lưới") status
  @Get('devices/:deviceId/grid-tie')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getGridTieStatus(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    // Verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const off = await this.gridTieService.isOff(user.uid, deviceId);
    // 1 = tắt hoà lưới (OFF), 0 = grid-tie ON
    return { deviceId, status: off ? 1 : 0, gridTieOff: off };
  }

  // Tắt/bật hoà lưới (set grid-tie on/off).
  // { "status": 1 } => grid-tie OFF; the firmware then reads the OFF command
  // from GET setting/schedule while the real stored value is preserved.
  @Patch('devices/:deviceId/grid-tie')
  async setGridTieStatus(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: SetGridTieDto,
  ) {
    // Verify device belongs to user
    const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const off = dto.status === 1;
    const setting = await this.gridTieService.setGridTie(
      user.uid,
      deviceId,
      off,
    );

    return {
      deviceId,
      // 1 = tắt hoà lưới (OFF), 0 = grid-tie ON
      status: off ? 1 : 0,
      gridTieOff: off,
      setting,
    };
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

    const schedule = await this.inverterScheduleService.findByUserIdAndDeviceId(
      user.uid,
      deviceId,
    );

    // When grid-tie is OFF, force each segment's value to the OFF command while
    // keeping start/end times. The stored schedule is preserved in the DB.
    if (await this.gridTieService.isOff(user.uid, deviceId)) {
      const overridden = schedule?.schedule
        ? schedule.schedule.replace(
            /value=[^&#]*/g,
            `value=${GRID_TIE_OFF_VALUE}`,
          )
        : GRID_TIE_OFF_VALUE;
      return {
        ...(schedule ?? { userId: user.uid, deviceId }),
        schedule: overridden,
        gridTieOff: true,
      };
    }

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
