import {
  Controller,
  Get,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { InverterDataService } from '../services/inverter-data.service';
import { QueryInverterDataDto } from '../dto/query-inverter-data.dto';

@Controller('api/inverter')
export class InverterDataController {
  constructor(
    private readonly inverterDataService: InverterDataService,
  ) {}


  @Get('data')
  findAll(@Query() query: QueryInverterDataDto) {
    return this.inverterDataService.findAll(query.page, query.limit);
  }

  @Get('data/:userId/:deviceId/latest')
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
