import {
  Controller,
  Get,
  Param,
  Delete,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { InverterDataService } from '../services/inverter-data.service';
import { QueryInverterDataDto } from '../dto/query-inverter-data.dto';

@Controller('api/inverter')
@UseInterceptors(CacheInterceptor)
export class InverterDataController {
  constructor(private readonly inverterDataService: InverterDataService) {}

  @Get('data')
  @CacheTTL(30000) // 30 seconds
  findAll(@Query() query: QueryInverterDataDto) {
    return this.inverterDataService.findAll(query.page, query.limit);
  }

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

  @Get('data/:userId/:deviceId')
  @CacheTTL(30000) // 30 seconds
  findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Query() query: QueryInverterDataDto,
  ) {
    return this.inverterDataService.findByUserIdAndDeviceId(
      userId,
      deviceId,
      query.page,
      query.limit,
    );
  }

  @Get('data/:id')
  @CacheTTL(60000) // 60 seconds
  findOne(@Param('id') id: string) {
    return this.inverterDataService.findOne(id);
  }

  @Delete('data/:id')
  remove(@Param('id') id: string) {
    return this.inverterDataService.remove(id);
  }

  @Delete('data')
  deleteAll() {
    return this.inverterDataService.deleteAll();
  }
}
