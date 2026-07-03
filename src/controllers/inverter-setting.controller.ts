import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
  UseInterceptors,
} from '@nestjs/common';
import { CacheTTL } from '@nestjs/cache-manager';
import { InverterSettingService } from '../services/inverter-setting.service';
import { GridTieService } from '../services/grid-tie.service';
import { ShareService } from '../services/share.service';
import { CreateInverterSettingDto } from '../dto/create-inverter-setting.dto';
import { UpdateInverterSettingDto } from '../dto/update-inverter-setting.dto';
import { UpdateInverterSettingValueDto } from '../dto/update-inverter-setting-value.dto';
import { SetGridTieDto } from '../dto/set-grid-tie.dto';
import { GRID_TIE_OFF_VALUE } from '../constants/grid-tie.constants';
import { SettingCacheInterceptor } from '../interceptors/setting-cache.interceptor';

@Controller('api/inverter-setting')
export class InverterSettingController {
  constructor(
    private readonly inverterSettingService: InverterSettingService,
    private readonly gridTieService: GridTieService,
    private readonly shareService: ShareService,
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
  @UseInterceptors(SettingCacheInterceptor) // skips cache when ?source=hardware
  @CacheTTL(30000) // 30 seconds, invalidated on write
  async findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Query('source') source?: string,
  ) {
    try {
      const result = await this.inverterSettingService.findByUserIdAndDeviceId(
        userId,
        deviceId,
      );

      // When grid-tie is OFF, report the OFF command instead of the stored
      // value (which is preserved untouched in the DB). Grid-tie wins over share.
      if (await this.gridTieService.isOff(userId, deviceId)) {
        return {
          ...(result ?? { userId, deviceId }),
          value: GRID_TIE_OFF_VALUE,
          gridTieOff: true,
        };
      }

      // For ESP32 calls, apply the power/energy share cap to the first field of
      // the setting value (min(computed, threshold), zero-padded). App calls get
      // the raw stored value.
      if (source === 'hardware' && result?.value) {
        const shared = await this.shareService.getHardwareSettingValue(
          userId,
          deviceId,
          result.value,
        );
        if (shared !== null) {
          return { ...result, value: shared, shared: true };
        }
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

  // Grid-tie ("hoà lưới") status - no auth, userId in the URL.
  // GET returns { status: 1|0 } where 1 = OFF (tắt hoà lưới), 0 = ON.
  @Get('grid-tie/:userId/:deviceId')
  async getGridTieStatus(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    const off = await this.gridTieService.isOff(userId, deviceId);
    return { userId, deviceId, status: off ? 1 : 0, gridTieOff: off };
  }

  // Tắt/bật hoà lưới. Body { "status": 1 } => OFF, { "status": 0 } => ON.
  @Patch('grid-tie/:userId/:deviceId')
  async setGridTieStatus(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: SetGridTieDto,
  ) {
    const off = dto.status === 1;
    const setting = await this.gridTieService.setGridTie(userId, deviceId, off);
    return {
      userId,
      deviceId,
      status: off ? 1 : 0,
      gridTieOff: off,
      setting,
    };
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
