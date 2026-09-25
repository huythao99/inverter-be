import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Header,
  Headers,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from '../auth/decorators/firebase-user.decorator';
import { FirebaseUser } from '../auth/strategies/firebase.strategy';
import { InverterDeviceService } from '../services/inverter-device.service';
import { InverterDataService } from '../services/inverter-data.service';
import { InverterSettingService } from '../services/inverter-setting.service';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { GridTieService } from '../services/grid-tie.service';
import { ShareService } from '../services/share.service';
import { DailyTotalsService } from '../services/daily-totals.service';
import { SetGridTieDto } from '../dto/set-grid-tie.dto';
import { CreateShareGroupDto } from '../dto/create-share-group.dto';
import { UpdateShareGroupDto } from '../dto/update-share-group.dto';
import {
  GRID_TIE_OFF_VALUE,
  BLACKLIST_OFF_VALUE,
} from '../constants/grid-tie.constants';
import { BlacklistDeviceService } from '../services/blacklist-device.service';
import { DeviceRestartService } from '../services/device-restart.service';
import { MqttService } from '../services/mqtt.service';
import { StmFirmwareService } from '../services/stm-firmware.service';
import { BetaFirmwareDeviceService } from '../services/beta-firmware-device.service';
import {
  newestFirmwareVersion,
  newestBetaFirmwareVersion,
  compareFirmwareVersions,
  isLegacyDevice,
} from '../services/firmware.service';

// One firmware-update trigger per device per minute (double clicks, retries).
const FIRMWARE_UPDATE_COOLDOWN_MS = 60000;

@Controller('api/user')
@UseGuards(FirebaseAuthGuard)
export class UserApiController {
  constructor(
    private readonly inverterDeviceService: InverterDeviceService,
    private readonly inverterDataService: InverterDataService,
    private readonly inverterSettingService: InverterSettingService,
    private readonly inverterScheduleService: InverterScheduleService,
    private readonly gridTieService: GridTieService,
    private readonly shareService: ShareService,
    private readonly dailyTotalsService: DailyTotalsService,
    private readonly blacklistDeviceService: BlacklistDeviceService,
    private readonly deviceRestartService: DeviceRestartService,
    private readonly mqttService: MqttService,
    private readonly betaFirmwareDeviceService: BetaFirmwareDeviceService,
    private readonly stmFirmwareService: StmFirmwareService,
  ) {}

  private readonly firmwareUpdateAt = new Map<string, number>();

  /** Version this user's device should run (beta list -> beta build). */
  private firmwareTargetFor(userId: string, deviceId: string): string {
    return this.betaFirmwareDeviceService.isBeta(deviceId, userId)
      ? newestBetaFirmwareVersion()
      : newestFirmwareVersion();
  }

  /** Firmware the device reports running. Legacy (< 436) = always up to date. */
  private firmwareCurrentFor(
    userId: string,
    deviceId: string,
    reported?: string | null,
  ): string {
    if (isLegacyDevice(deviceId))
      return this.firmwareTargetFor(userId, deviceId);
    return reported || this.firmwareTargetFor(userId, deviceId);
  }

  // Verify every member device belongs to the authenticated user.
  private async assertMembersOwned(
    userId: string,
    members: { deviceId: string }[],
  ): Promise<void> {
    for (const member of members) {
      const device = await this.inverterDeviceService.findByUserIdAndDeviceId(
        userId,
        member.deviceId,
      );
      if (!device) {
        throw new NotFoundException(`Device ${member.deviceId} not found`);
      }
    }
  }

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

    // Blacklisted device: report the OFF command (real value preserved in DB).
    if (this.blacklistDeviceService.isBlacklisted(deviceId, user.uid)) {
      return {
        ...(settings ?? { userId: user.uid, deviceId }),
        value: BLACKLIST_OFF_VALUE,
        blacklisted: true,
      };
    }

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

    const forcedOff = this.blacklistDeviceService.isBlacklisted(
      deviceId,
      user.uid,
    );
    const settings =
      await this.inverterSettingService.updateValueByUserIdAndDeviceId(
        user.uid,
        deviceId,
        forcedOff ? BLACKLIST_OFF_VALUE : value,
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

  // ---- Share groups (share _p + _energy across chosen devices) ----

  // Create a share group with selected devices + ratios
  @Post('share-groups')
  async createShareGroup(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Body() dto: CreateShareGroupDto,
  ) {
    await this.assertMembersOwned(user.uid, dto.members);
    return this.shareService.createGroup(user.uid, dto);
  }

  // List the user's share groups
  @Get('share-groups')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async listShareGroups(@CurrentFirebaseUser() user: FirebaseUser) {
    return this.shareService.listGroups(user.uid);
  }

  // Get one share group
  @Get('share-groups/:groupId')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getShareGroup(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('groupId') groupId: string,
  ) {
    const group = await this.shareService.getGroup(user.uid, groupId);
    if (!group) {
      throw new NotFoundException(`Share group ${groupId} not found`);
    }
    return group;
  }

  // Update a share group (members / ratios / enabled)
  @Patch('share-groups/:groupId')
  async updateShareGroup(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateShareGroupDto,
  ) {
    if (dto.members) {
      await this.assertMembersOwned(user.uid, dto.members);
    }
    const group = await this.shareService.updateGroup(user.uid, groupId, dto);
    if (!group) {
      throw new NotFoundException(`Share group ${groupId} not found`);
    }
    return group;
  }

  // Delete a share group
  @Delete('share-groups/:groupId')
  async deleteShareGroup(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('groupId') groupId: string,
  ) {
    const deleted = await this.shareService.deleteGroup(user.uid, groupId);
    if (!deleted) {
      throw new NotFoundException(`Share group ${groupId} not found`);
    }
    return { deleted: true, groupId };
  }

  // Share status + current computed value for a device
  @Get('devices/:deviceId/share')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceShareStatus(
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
    return this.shareService.getShareStatus(user.uid, deviceId);
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

    // Blacklisted device: force each segment's value to the OFF command.
    if (this.blacklistDeviceService.isBlacklisted(deviceId, user.uid)) {
      const overridden = schedule?.schedule
        ? schedule.schedule.replace(
            /value=[^&#]*/g,
            `value=${BLACKLIST_OFF_VALUE}`,
          )
        : BLACKLIST_OFF_VALUE;
      return {
        ...(schedule ?? { userId: user.uid, deviceId }),
        schedule: overridden,
        blacklisted: true,
      };
    }

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

    const normalizedSchedule = this.blacklistDeviceService.isBlacklisted(
      deviceId,
      user.uid,
    )
      ? schedule.replace(/value=[^&#]*/g, `value=${BLACKLIST_OFF_VALUE}`)
      : schedule;

    const updatedSchedule =
      await this.inverterScheduleService.updateScheduleByUserIdAndDeviceId(
        user.uid,
        deviceId,
        normalizedSchedule,
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

  // Calculate total energy across all historical records for a device
  @Get('devices/:deviceId/calculate-daily-totals')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async calculateDeviceDailyTotals(
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

    return this.dailyTotalsService.calculateTotalsByUserAndDevice(
      user.uid,
      deviceId,
    );
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

  // ---- Firmware (OTA) — used by the web app ----------------------------------

  // Newest firmware for the user's device (beta list -> beta version). Without
  // deviceId: the stable version.
  @Get('firmware/newest')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  getNewestFirmware(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Query('deviceId') deviceId?: string,
  ) {
    return {
      version: deviceId
        ? this.firmwareTargetFor(user.uid, deviceId)
        : newestFirmwareVersion(),
    };
  }

  // Firmware the device runs (as reported by the ESP32 after each boot).
  @Get('devices/:deviceId/firmware/version')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getDeviceFirmware(
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
    return {
      firmwareVersion: this.firmwareCurrentFor(
        user.uid,
        deviceId,
        device.firmwareVersion,
      ),
    };
  }

  // Trigger an OTA update (same non-retained MQTT trigger as the mobile app).
  // Progress arrives on inverter/{uid}/{deviceId}/ota/status.
  @Post('devices/:deviceId/firmware/update')
  async updateDeviceFirmware(
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
    if (isLegacyDevice(deviceId)) {
      throw new BadRequestException(
        'Thiết bị này không hỗ trợ cập nhật firmware từ xa',
      );
    }
    const targetVersion = this.firmwareTargetFor(user.uid, deviceId);
    const currentVersion = this.firmwareCurrentFor(
      user.uid,
      deviceId,
      device.firmwareVersion,
    );
    if (compareFirmwareVersions(currentVersion, targetVersion) >= 0) {
      throw new BadRequestException(
        `Thiết bị đã ở phiên bản mới nhất (${currentVersion})`,
      );
    }
    if (!this.mqttService.isConnected()) {
      throw new HttpException(
        'Máy chủ MQTT đang mất kết nối, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const key = `${user.uid}/${deviceId}`;
    const now = Date.now();
    const last = this.firmwareUpdateAt.get(key) ?? 0;
    if (now - last < FIRMWARE_UPDATE_COOLDOWN_MS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Đã gửi lệnh cập nhật, vui lòng chờ thiết bị cập nhật xong',
          retryAfterSeconds: Math.ceil(
            (FIRMWARE_UPDATE_COOLDOWN_MS - (now - last)) / 1000,
          ),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (this.firmwareUpdateAt.size > 1000) this.firmwareUpdateAt.clear();
    this.firmwareUpdateAt.set(key, now);

    await this.mqttService.publish(
      `inverter/${user.uid}/${deviceId}/firmware/update`,
      {
        action: 'start_update',
        userId: user.uid,
        deviceId,
        timestamp: new Date().toISOString(),
        currentVersion,
        targetVersion,
        source: 'web',
      },
    );
    return { success: true, currentVersion, targetVersion };
  }

  // ---- STM32 (power board) firmware — web + mobile app ----------------------

  // Reported STM32 version (a.b.c, b = voltage class) + available update.
  @Get('devices/:deviceId/stm')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  getDeviceStm(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    return this.stmFirmwareService.describeByUserDevice(user.uid, deviceId);
  }

  // Trigger the STM32 update. The device stops producing power for ~40 s.
  @Post('devices/:deviceId/stm/update')
  updateDeviceStm(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Headers('x-client') client?: string,
  ) {
    return this.stmFirmwareService.trigger(user.uid, deviceId, {
      source: client === 'mobile' ? 'app' : 'web',
    });
  }

  // Remote reboot of the device's ESP32 (mobile app + web). Rate-limited to
  // one request per device per minute.
  @Post('devices/:deviceId/restart')
  async restartDevice(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Headers('x-client') client?: string,
  ) {
    return this.deviceRestartService.restartByUserAndDevice(
      user.uid,
      deviceId,
      client === 'mobile' ? 'app' : 'web',
    );
  }

  // Update device description
  @Patch('devices/:deviceId/description')
  async updateDeviceDescription(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body('description') description: string,
  ) {
    const device = await this.inverterDeviceService.updateDescription(
      user.uid,
      deviceId,
      description ?? '',
    );

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
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

  // Update device name
  @Patch('devices/:deviceId')
  async updateDevice(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() updateData: { deviceName?: string; description?: string },
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
