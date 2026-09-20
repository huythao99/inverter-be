import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CmsChargerService } from '../services/cms-charger.service';
import { DeviceQueryDto, UpdateDeviceDto } from '../dto/cms-query.dto';

@Controller('api/cms/charger')
@UseGuards(AdminGuard)
export class CmsChargerController {
  constructor(private readonly cmsChargerService: CmsChargerService) {}

  @Get('dashboard')
  getDashboard() {
    return this.cmsChargerService.getDashboard();
  }

  @Get('devices')
  getDevices(@Query() query: DeviceQueryDto) {
    return this.cmsChargerService.getDevices(query);
  }

  @Get('devices/:userId/:deviceId/details')
  getDeviceDetails(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.cmsChargerService.getDeviceDetails(userId, deviceId);
  }

  @Get('devices/:id')
  getDevice(@Param('id') id: string) {
    return this.cmsChargerService.getDeviceById(id);
  }

  @Put('devices/:id')
  updateDevice(@Param('id') id: string, @Body() updateDto: UpdateDeviceDto) {
    return this.cmsChargerService.updateDevice(id, updateDto);
  }

  @Delete('devices/:id')
  deleteDevice(@Param('id') id: string) {
    return this.cmsChargerService.deleteDevice(id);
  }

  @Post('devices/:id/firmware-update')
  @HttpCode(HttpStatus.OK)
  triggerFirmwareUpdate(
    @Param('id') id: string,
    @Body('targetVersion') targetVersion?: string,
  ) {
    return this.cmsChargerService.triggerFirmwareUpdate(id, targetVersion);
  }
}
