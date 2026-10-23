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
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DeviceQueryDto, UpdateDeviceDto } from '../dto/cms-query.dto';

class HybridDeviceQueryDto extends DeviceQueryDto {
  @IsOptional()
  @IsIn(['online', 'offline', 'fault', 'local'])
  status?: 'online' | 'offline' | 'fault' | 'local';
}

class RawLogDto {
  @IsInt()
  @Min(0)
  @Max(30)
  minutes!: number;
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

  // UART debug log (hybrid/{uid}/{id}/raw) on for N minutes, 0 = off.
  @Post('devices/:userId/:deviceId/raw-log')
  @HttpCode(HttpStatus.OK)
  setRawLog(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: RawLogDto,
  ) {
    return this.cms.setRawLog(userId, deviceId, dto.minutes);
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
