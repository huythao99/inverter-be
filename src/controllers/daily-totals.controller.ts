import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { DailyTotalsService } from '../services/daily-totals.service';
import { CreateDailyTotalsDto } from '../dto/create-daily-totals.dto';
import { UpdateDailyTotalsDto } from '../dto/update-daily-totals.dto';
import { QueryDailyTotalsDto } from '../dto/query-daily-totals.dto';

@Controller('api/daily-totals')
export class DailyTotalsController {
  constructor(private readonly dailyTotalsService: DailyTotalsService) {}

  @Post()
  async create(@Body() createDailyTotalsDto: CreateDailyTotalsDto) {
    try {
      return await this.dailyTotalsService.create(createDailyTotalsDto);
    } catch (error) {
      if (error.code === 11000) {
        throw new HttpException(
          'Daily totals already exist for this user, device, and date',
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        'Failed to create daily totals',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async findAll(@Query() queryDto: QueryDailyTotalsDto) {
    return this.dailyTotalsService.findAll(queryDto);
  }

  @Get('summary')
  async getTotalsByDateRange(
    @Query('userId') userId: string,
    @Query('deviceId') deviceId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }

    return this.dailyTotalsService.getTotalsByDateRange(
      userId,
      deviceId,
      startDate,
      endDate,
    );
  }

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
        throw new HttpException('Invalid month format (1-12)', HttpStatus.BAD_REQUEST);
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

  @Get('user/:userId/device/:deviceId/date/:date')
  async findByUserAndDevice(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Param('date') date: string,
  ) {
    const result = await this.dailyTotalsService.findByUserAndDevice(
      userId,
      deviceId,
      date,
    );

    if (!result) {
      throw new HttpException(
        'Daily totals not found for the specified user, device, and date',
        HttpStatus.NOT_FOUND,
      );
    }

    return result;
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.dailyTotalsService.findOne(id);

    if (!result) {
      throw new HttpException('Daily totals not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDailyTotalsDto: UpdateDailyTotalsDto,
  ) {
    const result = await this.dailyTotalsService.update(
      id,
      updateDailyTotalsDto,
    );

    if (!result) {
      throw new HttpException('Daily totals not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Post('upsert')
  async upsertByUserAndDevice(
    @Body('userId') userId: string,
    @Body('deviceId') deviceId: string,
    @Body('date') date: string,
    @Body('totalA') totalA: number,
    @Body('totalA2') totalA2: number,
  ) {
    if (
      !userId ||
      !deviceId ||
      !date ||
      totalA === undefined ||
      totalA2 === undefined
    ) {
      throw new HttpException(
        'userId, deviceId, date, totalA, and totalA2 are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.dailyTotalsService.upsertByUserAndDevice(
      userId,
      deviceId,
      date,
      totalA,
      totalA2,
    );
  }

  @Post('increment')
  async incrementTotals(
    @Body('userId') userId: string,
    @Body('deviceId') deviceId: string,
    @Body('date') date: string,
    @Body('totalAIncrement') totalAIncrement: number,
    @Body('totalA2Increment') totalA2Increment: number,
  ) {
    if (
      !userId ||
      !deviceId ||
      !date ||
      totalAIncrement === undefined ||
      totalA2Increment === undefined
    ) {
      throw new HttpException(
        'userId, deviceId, date, totalAIncrement, and totalA2Increment are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.dailyTotalsService.incrementTotals(
      userId,
      deviceId,
      date,
      totalAIncrement,
      totalA2Increment,
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.dailyTotalsService.remove(id);

    if (!result) {
      throw new HttpException('Daily totals not found', HttpStatus.NOT_FOUND);
    }

    return { message: 'Daily totals deleted successfully' };
  }

  @Delete('user/:userId/device/:deviceId/date/:date')
  async removeByUserAndDevice(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Param('date') date: string,
  ) {
    const result = await this.dailyTotalsService.removeByUserAndDevice(
      userId,
      deviceId,
      date,
    );

    if (!result) {
      throw new HttpException(
        'Daily totals not found for the specified user, device, and date',
        HttpStatus.NOT_FOUND,
      );
    }

    return { message: 'Daily totals deleted successfully' };
  }

  @Get('calculate/:userId/:deviceId')
  async calculateTotalsByUserAndDevice(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.dailyTotalsService.calculateTotalsByUserAndDevice(userId, deviceId);
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
}
