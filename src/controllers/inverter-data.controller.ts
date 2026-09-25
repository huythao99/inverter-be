import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { InverterDataService } from '../services/inverter-data.service';

@Controller('api/inverter')
@UseInterceptors(CacheInterceptor)
export class InverterDataController {
  constructor(private readonly inverterDataService: InverterDataService) {}

  @Get('data/:userId/:deviceId/latest')
  @CacheTTL(10000) // 10 seconds
  findLatestByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.inverterDataService.findLatestByUserIdAndDeviceId(
      userId,
      deviceId,
    );
  }
}
