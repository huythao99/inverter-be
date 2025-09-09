import {
  Controller,
  Get,
  Post,
  Query,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { RedisDailyTotalsService } from '../services/redis-daily-totals.service';

@Controller('redis-totals')
export class RedisTotalsController {
  constructor(
    private readonly redisDailyTotalsService: RedisDailyTotalsService,
  ) {}

  @Get('current')
  async getCurrentDayTotals(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId: string,
  ) {
    if (!userId || !deviceId) {
      throw new HttpException(
        'userId and deviceId are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const totals = await this.redisDailyTotalsService.getDailyTotals(
      userId,
      deviceId,
    );

    return {
      userId,
      deviceId,
      date: new Date().toISOString().split('T')[0],
      totals: totals || { totalA: 0, totalA2: 0 },
    };
  }

  @Get('by-date')
  async getTotalsByDate(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId: string,
    @Query('date') date: string,
  ) {
    if (!userId || !deviceId || !date) {
      throw new HttpException(
        'userId, deviceId, and date are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const totals = await this.redisDailyTotalsService.getDailyTotals(
      userId,
      deviceId,
      date,
    );

    return {
      userId,
      deviceId,
      date,
      totals: totals || { totalA: 0, totalA2: 0 },
    };
  }

  @Get('range')
  async getTotalsByRange(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    return this.redisDailyTotalsService.getTotalsByDateRange(
      userId,
      deviceId,
      startDate,
      endDate,
    );
  }

  @Get('today')
  async getTodaysTotals(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    const totals = await this.redisDailyTotalsService.getTodaysTotals(
      userId,
      deviceId,
    );

    const totalA = totals.reduce((sum, device) => sum + device.totalA, 0);
    const totalA2 = totals.reduce((sum, device) => sum + device.totalA2, 0);

    return {
      userId,
      deviceId: deviceId || 'all',
      date: new Date().toISOString().split('T')[0],
      timezone: 'GMT+7',
      devices: totals,
      summary: {
        totalDevices: totals.length,
        totalA,
        totalA2,
      },
    };
  }

  @Post('flush')
  async forceFlushToDatabase() {
    await this.redisDailyTotalsService.forceFlushToDatabase();
    return { message: 'Successfully flushed all dirty records to database' };
  }

  @Post('reset')
  async manualDailyReset() {
    await this.redisDailyTotalsService.manualDailyReset();
    return {
      message: 'Daily reset completed successfully',
      timestamp: new Date().toISOString(),
      timezone: 'GMT+7',
    };
  }

  @Get('info')
  async getRedisInfo() {
    return this.redisDailyTotalsService.getRedisInfo();
  }

  @Get('health')
  async healthCheck() {
    try {
      const info = await this.redisDailyTotalsService.getRedisInfo();
      return {
        status: 'healthy',
        redis: info,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        {
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
