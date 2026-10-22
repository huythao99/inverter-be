import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CmsHybridService } from '../services/cms-hybrid.service';
import { IsIn, IsOptional } from 'class-validator';
import { DeviceQueryDto, UpdateDeviceDto } from '../dto/cms-query.dto';

class HybridDeviceQueryDto extends DeviceQueryDto {
  @IsOptional()
  @IsIn(['online', 'offline', 'fault', 'local'])
  status?: 'online' | 'offline' | 'fault' | 'local';
}

/**
 * Admin (CMS) API for hybrid devices — same shape as /api/cms/charger so the
 * CMS pages can be shared. Auth: AdminGuard ('admin-jwt').
 */
@Controller('api/cms/hybrid')
@UseGuards(AdminGuard)
export class CmsHybridController {
  constructor(private readonly cms: CmsHybridService) {}

  @Get('dashboard')
  getDashboard() {
    return this.cms.getDashboard();
  }

  // ?search=&status=online|offline|fault|local&page=&limit=&userId=&deviceId=
  @Get('devices')
  getDevices(@Query() query: HybridDeviceQueryDto) {
    return this.cms.getDevices(query);
  }

  @Get('devices/:userId/:deviceId/details')
  getDeviceDetails(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.cms.getDeviceDetails(userId, deviceId);
  }

  @Get('devices/:id')
  getDevice(@Param('id') id: string) {
    return this.cms.getDeviceById(id);
  }

  @Put('devices/:id')
  updateDevice(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.cms.updateDevice(id, dto);
  }

  @Delete('devices/:id')
  deleteDevice(@Param('id') id: string) {
    return this.cms.deleteDevice(id);
  }

  @Post('devices/:id/firmware-update')
  @HttpCode(HttpStatus.OK)
  triggerFirmwareUpdate(@Param('id') id: string) {
    return this.cms.triggerFirmwareUpdate(id);
  }
}
