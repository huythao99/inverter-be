import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CmsService } from '../services/cms.service';
import { BlacklistDeviceService } from '../services/blacklist-device.service';
import { BetaFirmwareDeviceService } from '../services/beta-firmware-device.service';
import { DeviceRestartService } from '../services/device-restart.service';
import { FirmwareBulkUpdateService } from '../services/firmware-bulk-update.service';
import { BulkFirmwareUpdateDto } from '../dto/bulk-firmware-update.dto';
import { StmFirmwareService } from '../services/stm-firmware.service';
import {
  RegisterStmFirmwareDto,
  SetStmFirmwareEnabledDto,
  StmUpdateDto,
} from '../dto/stm-firmware.dto';
import { AdminLoginDto } from '../dto/admin-login.dto';
import {
  DeviceQueryDto,
  UserQueryDto,
  AnalyticsQueryDto,
  UpdateDeviceDto,
  UpdateUserDto,
} from '../dto/cms-query.dto';

@Controller('api/cms')
export class CmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly blacklistDeviceService: BlacklistDeviceService,
    private readonly betaFirmwareDeviceService: BetaFirmwareDeviceService,
    private readonly deviceRestartService: DeviceRestartService,
    private readonly firmwareBulkUpdateService: FirmwareBulkUpdateService,
    private readonly stmFirmwareService: StmFirmwareService,
  ) {}

  // ==================== Authentication ====================

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
  async login(@Body() loginDto: AdminLoginDto) {
    return this.cmsService.login(loginDto);
  }

  @Post('logout')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async logout() {
    // JWT is stateless, so we just return success
    // Client should delete the token
    return { message: 'Logged out successfully' };
  }

  @Get('profile')
  @UseGuards(AdminGuard)
  async getProfile(@Request() req: any) {
    return this.cmsService.getProfile(req.user);
  }

  // ==================== Dashboard/Analytics ====================

  @Get('dashboard')
  @UseGuards(AdminGuard)
  async getDashboard() {
    return this.cmsService.getDashboardStats();
  }

  @Get('analytics')
  @UseGuards(AdminGuard)
  async getAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.cmsService.getAnalytics(query);
  }

  // ==================== Device Management ====================

  @Get('devices')
  @UseGuards(AdminGuard)
  async getDevices(@Query() query: DeviceQueryDto) {
    return this.cmsService.getDevices(query);
  }

  @Get('devices/:id')
  @UseGuards(AdminGuard)
  async getDevice(@Param('id') id: string) {
    return this.cmsService.getDeviceById(id);
  }

  @Put('devices/:id')
  @UseGuards(AdminGuard)
  async updateDevice(
    @Param('id') id: string,
    @Body() updateDto: UpdateDeviceDto,
  ) {
    return this.cmsService.updateDevice(id, updateDto);
  }

  @Delete('devices/:id')
  @UseGuards(AdminGuard)
  async deleteDevice(@Param('id') id: string) {
    return this.cmsService.deleteDevice(id);
  }

  @Get('devices/:userId/:deviceId/details')
  @UseGuards(AdminGuard)
  async getDeviceDetails(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.cmsService.getDeviceDetails(userId, deviceId);
  }

  @Post('devices/:id/firmware-update')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async triggerFirmwareUpdate(
    @Param('id') id: string,
    @Body('targetVersion') targetVersion: string,
  ) {
    return this.cmsService.triggerFirmwareUpdate(id, targetVersion);
  }

  // ---- STM32 firmware (static images registered from the CMS) ----
  @Get('stm-firmwares')
  @UseGuards(AdminGuard)
  listStmFirmwares(@Query('product') product?: 'inverter' | 'charger') {
    return this.stmFirmwareService.list(
      product === 'inverter' || product === 'charger' ? product : undefined,
    );
  }

  // Where images are expected by default (shown in the CMS form).
  @Get('stm-firmwares/config')
  @UseGuards(AdminGuard)
  getStmFirmwareConfig() {
    return {
      baseUrl: this.stmFirmwareService.baseUrl,
      pathTemplate: `${this.stmFirmwareService.baseUrl}/{product}/{version}/app.bin`,
      minEspVersion: this.stmFirmwareService.minEspVersion,
    };
  }

  @Post('stm-firmwares')
  @UseGuards(AdminGuard)
  registerStmFirmware(@Body() dto: RegisterStmFirmwareDto) {
    return this.stmFirmwareService.register(dto);
  }

  @Patch('stm-firmwares/:id')
  @UseGuards(AdminGuard)
  setStmFirmwareEnabled(
    @Param('id') id: string,
    @Body() dto: SetStmFirmwareEnabledDto,
  ) {
    return this.stmFirmwareService.setEnabled(id, dto.enabled);
  }

  @Delete('stm-firmwares/:id')
  @UseGuards(AdminGuard)
  deleteStmFirmware(@Param('id') id: string) {
    return this.stmFirmwareService.remove(id);
  }

  // STM32 info + update target of one device (by device _id)
  @Get('devices/:id/stm')
  @UseGuards(AdminGuard)
  getDeviceStm(@Param('id') id: string) {
    return this.stmFirmwareService.describeById(id);
  }

  @Post('devices/:id/stm-update')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async triggerStmUpdate(@Param('id') id: string, @Body() dto: StmUpdateDto) {
    const d = await this.stmFirmwareService.describeById(id);
    return this.stmFirmwareService.trigger(d.userId, d.deviceId, {
      force: dto.force,
      source: 'cms',
    });
  }

  // ---- Bulk (forced) firmware update ----
  // Declared before the ':id' routes so 'firmware-bulk-updates' is never
  // captured as a device id.
  @Post('firmware-bulk-updates')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async startBulkFirmwareUpdate(@Body() dto: BulkFirmwareUpdateDto) {
    return this.firmwareBulkUpdateService.start(dto);
  }

  @Get('firmware-bulk-updates/latest')
  @UseGuards(AdminGuard)
  async getLatestBulkFirmwareUpdate() {
    return { job: await this.firmwareBulkUpdateService.getLatest() };
  }

  @Get('firmware-bulk-updates/:jobId/devices')
  @UseGuards(AdminGuard)
  async getBulkFirmwareUpdateDevices(
    @Param('jobId') jobId: string,
    @Query('state') state?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.firmwareBulkUpdateService.getDevices(
      jobId,
      state,
      Number(page) || 1,
      Number(limit) || 50,
    );
  }

  @Get('firmware-bulk-updates/:jobId')
  @UseGuards(AdminGuard)
  async getBulkFirmwareUpdate(@Param('jobId') jobId: string) {
    return this.firmwareBulkUpdateService.getStatus(jobId);
  }

  @Post('devices/:id/restart')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async restartDevice(@Param('id') id: string) {
    return this.deviceRestartService.restartById(id, 'cms');
  }

  // ==================== User Management ====================

  @Get('users')
  @UseGuards(AdminGuard)
  async getUsers(@Query() query: UserQueryDto) {
    return this.cmsService.getUsers(query);
  }

  @Get('users/:userId')
  @UseGuards(AdminGuard)
  async getUser(@Param('userId') userId: string) {
    return this.cmsService.getUserById(userId);
  }

  @Put('users/:userId')
  @UseGuards(AdminGuard)
  async updateUser(
    @Param('userId') userId: string,
    @Body() updateDto: UpdateUserDto,
  ) {
    return this.cmsService.updateUser(userId, updateDto);
  }

  @Delete('users/:userId')
  @UseGuards(AdminGuard)
  async deleteUser(@Param('userId') userId: string) {
    return this.cmsService.deleteUser(userId);
  }

  // ==================== Settings ====================

  @Get('settings')
  @UseGuards(AdminGuard)
  async getSettings() {
    return this.cmsService.getSettings();
  }

  @Get('mqtt-config')
  @UseGuards(AdminGuard)
  async getMqttConfig() {
    return this.cmsService.getMqttConfig();
  }

  // ==================== Blacklist Devices ====================

  @Get('blacklist')
  @UseGuards(AdminGuard)
  async getBlacklist() {
    return this.blacklistDeviceService.findAll();
  }

  @Post('blacklist')
  @UseGuards(AdminGuard)
  async addToBlacklist(
    @Body('deviceId') deviceId: string,
    @Body('userId') userId?: string,
    @Body('reason') reason?: string,
  ) {
    return this.blacklistDeviceService.create({ deviceId, userId, reason });
  }

  @Delete('blacklist/:id')
  @UseGuards(AdminGuard)
  async removeFromBlacklist(@Param('id') id: string) {
    return this.blacklistDeviceService.remove(id);
  }

  @Delete('blacklist/device/:deviceId')
  @UseGuards(AdminGuard)
  async removeDeviceFromBlacklist(@Param('deviceId') deviceId: string) {
    return this.blacklistDeviceService.removeByDeviceId(deviceId);
  }

  // ==================== Beta Firmware Devices ====================

  @Get('beta-firmware')
  @UseGuards(AdminGuard)
  async getBetaFirmwareDevices() {
    return this.betaFirmwareDeviceService.findAll();
  }

  @Post('beta-firmware')
  @UseGuards(AdminGuard)
  async addBetaFirmwareDevice(
    @Body('deviceId') deviceId: string,
    @Body('userId') userId?: string,
    @Body('note') note?: string,
  ) {
    return this.betaFirmwareDeviceService.create({ deviceId, userId, note });
  }

  @Delete('beta-firmware/:id')
  @UseGuards(AdminGuard)
  async removeBetaFirmwareDevice(@Param('id') id: string) {
    return this.betaFirmwareDeviceService.remove(id);
  }

  @Delete('beta-firmware/device/:deviceId')
  @UseGuards(AdminGuard)
  async removeBetaFirmwareByDeviceId(@Param('deviceId') deviceId: string) {
    return this.betaFirmwareDeviceService.removeByDeviceId(deviceId);
  }
}
