import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CmsService } from '../services/cms.service';
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
  constructor(private readonly cmsService: CmsService) {}

  // ==================== Authentication ====================

  @Post('login')
  @HttpCode(HttpStatus.OK)
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
}
