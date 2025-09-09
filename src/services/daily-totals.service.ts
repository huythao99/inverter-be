import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DailyTotals,
  DailyTotalsDocument,
} from '../models/daily-totals.schema';
import { CreateDailyTotalsDto } from '../dto/create-daily-totals.dto';
import { UpdateDailyTotalsDto } from '../dto/update-daily-totals.dto';
import { QueryDailyTotalsDto } from '../dto/query-daily-totals.dto';

@Injectable()
export class DailyTotalsService {
  constructor(
    @InjectModel(DailyTotals.name)
    private dailyTotalsModel: Model<DailyTotalsDocument>,
  ) {}

  private getGMT7Date(date?: Date): Date {
    const now = date || new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const gmt7 = new Date(utc + 7 * 3600000);

    // Get start of day in GMT+7
    gmt7.setHours(0, 0, 0, 0);
    return gmt7;
  }

  private getGMT7DateRange(dateStr: string): { start: Date; end: Date } {
    const inputDate = new Date(dateStr);
    const gmt7Date = this.getGMT7Date(inputDate);

    const start = new Date(gmt7Date);
    const end = new Date(gmt7Date);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  async create(
    createDailyTotalsDto: CreateDailyTotalsDto,
  ): Promise<DailyTotals> {
    const { start } = this.getGMT7DateRange(createDailyTotalsDto.date);

    const dailyTotals = new this.dailyTotalsModel({
      ...createDailyTotalsDto,
      date: start,
      timezone: createDailyTotalsDto.timezone || 'Asia/Ho_Chi_Minh',
    });

    return dailyTotals.save();
  }

  async findAll(queryDto: QueryDailyTotalsDto = {}): Promise<{
    data: DailyTotals[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const {
      userId,
      deviceId,
      startDate,
      endDate,
      date,
      limit = 50,
      offset = 0,
      sortOrder = 'desc',
    } = queryDto;

    const filter: any = {};

    if (userId) filter.userId = userId;
    if (deviceId) filter.deviceId = deviceId;

    if (date) {
      const { start, end } = this.getGMT7DateRange(date);
      filter.date = { $gte: start, $lte: end };
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const { start } = this.getGMT7DateRange(startDate);
        filter.date.$gte = start;
      }
      if (endDate) {
        const { end } = this.getGMT7DateRange(endDate);
        filter.date.$lte = end;
      }
    }

    const sortValue = sortOrder === 'desc' ? -1 : 1;
    const sort: any = { date: sortValue, createdAt: -1 };

    const [data, total] = await Promise.all([
      this.dailyTotalsModel
        .find(filter)
        .sort(sort)
        .limit(limit)
        .skip(offset)
        .exec(),
      this.dailyTotalsModel.countDocuments(filter),
    ]);

    return { data, total, limit, offset };
  }

  async findOne(id: string): Promise<DailyTotals | null> {
    return this.dailyTotalsModel.findById(id).exec() as Promise<DailyTotals | null>;
  }

  async findByUserAndDevice(
    userId: string,
    deviceId: string,
    date: string,
  ): Promise<DailyTotals | null> {
    const { start, end } = this.getGMT7DateRange(date);

    return this.dailyTotalsModel
      .findOne({
        userId,
        deviceId,
        date: { $gte: start, $lte: end },
      })
      .exec() as Promise<DailyTotals | null>;
  }

  async update(
    id: string,
    updateDailyTotalsDto: UpdateDailyTotalsDto,
  ): Promise<DailyTotals | null> {
    const updateData: any = { ...updateDailyTotalsDto };

    if (updateDailyTotalsDto.date) {
      const { start } = this.getGMT7DateRange(updateDailyTotalsDto.date);
      updateData.date = start;
    }

    updateData.updatedAt = new Date();

    return this.dailyTotalsModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec() as Promise<DailyTotals | null>;
  }

  async upsertByUserAndDevice(
    userId: string,
    deviceId: string,
    date: string,
    totalA: number,
    totalA2: number,
  ): Promise<DailyTotals> {
    const { start } = this.getGMT7DateRange(date);

    return this.dailyTotalsModel
      .findOneAndUpdate(
        {
          userId,
          deviceId,
          date: start,
        },
        {
          $set: {
            totalA,
            totalA2,
            timezone: 'Asia/Ho_Chi_Minh',
            updatedAt: new Date(),
          },
          $setOnInsert: {
            userId,
            deviceId,
            date: start,
            createdAt: new Date(),
          },
        },
        {
          new: true,
          upsert: true,
        },
      )
      .exec();
  }

  async incrementTotals(
    userId: string,
    deviceId: string,
    date: string,
    totalAIncrement: number,
    totalA2Increment: number,
  ): Promise<DailyTotals> {
    const { start } = this.getGMT7DateRange(date);

    return this.dailyTotalsModel
      .findOneAndUpdate(
        {
          userId,
          deviceId,
          date: start,
        },
        {
          $inc: {
            totalA: totalAIncrement,
            totalA2: totalA2Increment,
          },
          $set: {
            updatedAt: new Date(),
          },
          $setOnInsert: {
            userId,
            deviceId,
            date: start,
            timezone: 'Asia/Ho_Chi_Minh',
            createdAt: new Date(),
          },
        },
        {
          new: true,
          upsert: true,
        },
      )
      .exec();
  }

  async remove(id: string): Promise<DailyTotals | null> {
    return this.dailyTotalsModel.findByIdAndDelete(id).exec() as Promise<DailyTotals | null>;
  }

  async removeByUserAndDevice(
    userId: string,
    deviceId: string,
    date: string,
  ): Promise<DailyTotals | null> {
    const { start, end } = this.getGMT7DateRange(date);

    return this.dailyTotalsModel
      .findOneAndDelete({
        userId,
        deviceId,
        date: { $gte: start, $lte: end },
      })
      .exec() as Promise<DailyTotals | null>;
  }

  async getTotalsByDateRange(
    userId: string,
    deviceId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{
    totalA: number;
    totalA2: number;
    count: number;
    records: DailyTotals[];
  }> {
    const filter: any = { userId };

    if (deviceId) filter.deviceId = deviceId;

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const { start } = this.getGMT7DateRange(startDate);
        filter.date.$gte = start;
      }
      if (endDate) {
        const { end } = this.getGMT7DateRange(endDate);
        filter.date.$lte = end;
      }
    }

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    const totalA = records.reduce((sum, record) => sum + record.totalA, 0);
    const totalA2 = records.reduce((sum, record) => sum + record.totalA2, 0);

    return {
      totalA,
      totalA2,
      count: records.length,
      records,
    };
  }

  async getDailyTotalsByDay(
    userId: string,
    deviceId?: string,
    date?: string,
  ): Promise<DailyTotals[]> {
    const filter: any = { userId };

    if (deviceId) filter.deviceId = deviceId;

    if (date) {
      const { start, end } = this.getGMT7DateRange(date);
      filter.date = { $gte: start, $lte: end };
    }

    return this.dailyTotalsModel
      .find(filter)
      .sort({ date: -1, createdAt: -1 })
      .exec();
  }

  async getMonthlyTotals(
    userId: string,
    deviceId?: string,
    year?: number,
    month?: number,
  ): Promise<{
    year: number;
    month: number;
    totalA: number;
    totalA2: number;
    dailyRecords: Array<{
      date: string;
      totalA: number;
      totalA2: number;
      devices: number;
    }>;
    summary: {
      totalDays: number;
      averageDailyA: number;
      averageDailyA2: number;
      peakDayA: { date: string; value: number };
      peakDayA2: { date: string; value: number };
    };
  }> {
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || currentDate.getMonth() + 1;

    // Create date range for the month in GMT+7
    const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
    const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    // Convert to GMT+7
    const utcStart = startOfMonth.getTime() + startOfMonth.getTimezoneOffset() * 60000;
    const gmt7Start = new Date(utcStart + 7 * 3600000);
    gmt7Start.setHours(0, 0, 0, 0);

    const utcEnd = endOfMonth.getTime() + endOfMonth.getTimezoneOffset() * 60000;
    const gmt7End = new Date(utcEnd + 7 * 3600000);
    gmt7End.setHours(23, 59, 59, 999);

    const filter: any = {
      userId,
      date: { $gte: gmt7Start, $lte: gmt7End },
    };

    if (deviceId) filter.deviceId = deviceId;

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    // Group by date
    const dailyMap = new Map<string, { totalA: number; totalA2: number; devices: Set<string> }>();

    records.forEach((record) => {
      const dateKey = record.date.toISOString().split('T')[0];
      
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { totalA: 0, totalA2: 0, devices: new Set() });
      }

      const daily = dailyMap.get(dateKey)!;
      daily.totalA += record.totalA;
      daily.totalA2 += record.totalA2;
      daily.devices.add(record.deviceId);
    });

    // Convert to array and calculate totals
    const dailyRecords = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      totalA: data.totalA,
      totalA2: data.totalA2,
      devices: data.devices.size,
    }));

    const totalA = dailyRecords.reduce((sum, day) => sum + day.totalA, 0);
    const totalA2 = dailyRecords.reduce((sum, day) => sum + day.totalA2, 0);

    // Calculate summary statistics
    const totalDays = dailyRecords.length;
    const averageDailyA = totalDays > 0 ? totalA / totalDays : 0;
    const averageDailyA2 = totalDays > 0 ? totalA2 / totalDays : 0;

    const peakDayA = dailyRecords.reduce((peak, day) => 
      day.totalA > peak.value ? { date: day.date, value: day.totalA } : peak,
      { date: '', value: 0 }
    );

    const peakDayA2 = dailyRecords.reduce((peak, day) => 
      day.totalA2 > peak.value ? { date: day.date, value: day.totalA2 } : peak,
      { date: '', value: 0 }
    );

    return {
      year: targetYear,
      month: targetMonth,
      totalA,
      totalA2,
      dailyRecords,
      summary: {
        totalDays,
        averageDailyA,
        averageDailyA2,
        peakDayA,
        peakDayA2,
      },
    };
  }
}
