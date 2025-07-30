import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { InverterDataService } from '../services/inverter-data.service';
import { CreateInverterDataDto } from '../dto/create-inverter-data.dto';
import { UpdateInverterDataDto } from '../dto/update-inverter-data.dto';
import { QueryInverterDataDto } from '../dto/query-inverter-data.dto';

@Controller('api/inverter')
export class InverterDataController {
  constructor(private readonly inverterDataService: InverterDataService) {}

  @Post('data')
  create(@Body() createInverterDataDto: CreateInverterDataDto) {
    return this.inverterDataService.create(createInverterDataDto);
  }

  @Get('data')
  findAll() {
    return this.inverterDataService.findAll();
  }

  @Get('data/:userId/:deviceId/latest')
  findLatestByUserIdAndDeviceId(@Param('userId') userId: string, @Param('deviceId') deviceId: string) {
    return this.inverterDataService.findLatestByUserIdAndDeviceId(userId, deviceId);
  }

  @Get('data/:userId/:deviceId')
  findByUserIdAndDeviceId(@Param('userId') userId: string, @Param('deviceId') deviceId: string, @Query() query: QueryInverterDataDto) {
    return this.inverterDataService.findByUserIdAndDeviceId(userId, deviceId, query.page, query.limit);
  }

  @Get('data/:id')
  findOne(@Param('id') id: string) {
    return this.inverterDataService.findOne(id);
  }

  @Patch('data/:id')
  update(@Param('id') id: string, @Body() updateInverterDataDto: UpdateInverterDataDto) {
    return this.inverterDataService.update(id, updateInverterDataDto);
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