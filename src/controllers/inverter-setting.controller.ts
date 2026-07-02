import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { InverterSettingService } from '../services/inverter-setting.service';
import { GridTieService } from '../services/grid-tie.service';
import { CreateInverterSettingDto } from '../dto/create-inverter-setting.dto';
import { UpdateInverterSettingDto } from '../dto/update-inverter-setting.dto';
import { UpdateInverterSettingValueDto } from '../dto/update-inverter-setting-value.dto';
import { GRID_TIE_OFF_VALUE } from '../constants/grid-tie.constants';

@Controller('api/inverter-setting')
export class InverterSettingController {
  constructor(
    private readonly inverterSettingService: InverterSettingService,
    private readonly gridTieService: GridTieService,
  ) {}

  @Post('data')
  create(@Body() createInverterSettingDto: CreateInverterSettingDto) {
    return this.inverterSettingService.create(createInverterSettingDto);
  }

  @Get('data')
  findAll() {
    return this.inverterSettingService.findAll();
  }

  @Get('data/:userId/:deviceId')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30000) // 30 seconds, invalidated on write
  async findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    try {
      const result = await this.inverterSettingService.findByUserIdAndDeviceId(
        userId,
        deviceId,
      );

      // When grid-tie is OFF, report the OFF command instead of the stored
      // value (which is preserved untouched in the DB).
      if (await this.gridTieService.isOff(userId, deviceId)) {
        return {
          ...(result ?? { userId, deviceId }),
          value: GRID_TIE_OFF_VALUE,
          gridTieOff: true,
        };
      }

      return result || { message: 'Device not found', userId, deviceId };
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.name === 'MongoTimeoutError' ||
          error.message.includes('timeout')
        ) {
          return {
            message: 'Device lookup timeout - device may not exist',
            userId,
            deviceId,
          };
        }
      }
      throw error;
    }
  }

  @Get('data/:id')
  findOne(@Param('id') id: string) {
    return this.inverterSettingService.findOne(id);
  }

  @Patch('data/:id')
  update(
    @Param('id') id: string,
    @Body() updateInverterSettingDto: UpdateInverterSettingDto,
  ) {
    return this.inverterSettingService.update(id, updateInverterSettingDto);
  }

  @Patch('data/:userId/:deviceId')
  updateByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() updateInverterSettingDto: UpdateInverterSettingDto,
  ) {
    return this.inverterSettingService.updateByUserIdAndDeviceId(
      userId,
      deviceId,
      updateInverterSettingDto,
    );
  }

  @Patch('data/:userId/:deviceId/value')
  updateValueByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() updateValueDto: UpdateInverterSettingValueDto,
  ) {
    return this.inverterSettingService.updateValueByUserIdAndDeviceId(
      userId,
      deviceId,
      updateValueDto.value,
    );
  }

  @Delete('data/:id')
  remove(@Param('id') id: string) {
    return this.inverterSettingService.remove(id);
  }

  @Delete('data')
  deleteAll() {
    return this.inverterSettingService.deleteAll();
  }
}
