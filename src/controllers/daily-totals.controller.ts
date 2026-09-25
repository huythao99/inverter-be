import {
  Controller,
  Get,
  Body,
  Param,
  Delete,
  Query,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { DailyTotalsService } from '../services/daily-totals.service';

@Controller('api/daily-totals')
export class DailyTotalsController {
  constructor(private readonly dailyTotalsService: DailyTotalsService) {}

  @Get('by-day')
  async getDailyTotalsByDay(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId?: string,
    @Query('date') date?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    const records = await this.dailyTotalsService.getDailyTotalsByDay(
      userId,
      deviceId,
      date,
    );

    // Sum all records to get total values
    const totalA = records.reduce((sum, record) => sum + record.totalA, 0);
    const totalA2 = records.reduce((sum, record) => sum + record.totalA2, 0);

    return {
      userId,
      deviceId: deviceId || 'all',
      date: date || 'all',
      totalA,
      totalA2,
      count: records.length,
    };
  }

  @Get('monthly')
  async getMonthlyTotals(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    let yearNum: number | undefined;
    let monthNum: number | undefined;

    if (year) {
      yearNum = parseInt(year, 10);
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 3000) {
        throw new HttpException('Invalid year format', HttpStatus.BAD_REQUEST);
      }
    }

    if (month) {
      monthNum = parseInt(month, 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new HttpException(
          'Invalid month format (1-12)',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const monthlyData = await this.dailyTotalsService.getMonthlyTotals(
      userId,
      deviceId,
      yearNum,
      monthNum,
    );

    // Return only totalA and totalA2
    return {
      totalA: monthlyData.totalA,
      totalA2: monthlyData.totalA2,
    };
  }

  @Get('monthly/chart')
  async getMonthlyChartData(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    let yearNum: number | undefined;
    let monthNum: number | undefined;

    if (year) {
      yearNum = parseInt(year, 10);
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 3000) {
        throw new HttpException('Invalid year format', HttpStatus.BAD_REQUEST);
      }
    }

    if (month) {
      monthNum = parseInt(month, 10);
      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        throw new HttpException(
          'Invalid month format (1-12)',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return this.dailyTotalsService.getMonthlyChartData(
      userId,
      deviceId,
      yearNum,
      monthNum,
    );
  }

  @Delete('clear-current-month')
  async clearCurrentMonthTotals(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    await this.dailyTotalsService.clearCurrentMonthTotals(userId, deviceId);

    return { message: 'Current month totals cleared successfully' };
  }

  @Get('calculate/:userId/:deviceId')
  async calculateTotalsByUserAndDevice(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.dailyTotalsService.calculateTotalsByUserAndDevice(
      userId,
      deviceId,
    );
  }
}
