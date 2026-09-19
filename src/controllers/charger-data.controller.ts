import { Controller, Get, Param, Delete, Query, Header } from '@nestjs/common';
import { ChargerDataService } from '../services/charger-data.service';
import { QueryInverterDataDto } from '../dto/query-inverter-data.dto';

@Controller('api/charger')
export class ChargerDataController {
  constructor(private readonly chargerDataService: ChargerDataService) {}

  @Get('data')
  findAll(@Query() query: QueryInverterDataDto) {
    return this.chargerDataService.findAll(query.page, query.limit);
  }

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

  @Delete('data')
  deleteAll() {
    return this.chargerDataService.deleteAll();
  }
}
