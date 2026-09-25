import { Controller, Get, Param, Header } from '@nestjs/common';
import { ChargerDataService } from '../services/charger-data.service';

@Controller('api/charger')
export class ChargerDataController {
  constructor(private readonly chargerDataService: ChargerDataService) {}

  // Latest merged snapshot (telemetry + config + info + online/offline status).
  @Get('data/:userId/:deviceId/latest')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  findLatestByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.chargerDataService.findLatestByUserIdAndDeviceId(
      userId,
      deviceId,
    );
  }
}
