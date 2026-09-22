import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Decimal } from 'decimal.js';
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

  /**
   * For auto-calculated records the stored totalA/totalA2 is a cumulative
   * counter reported by the device, not the daily value. The real daily value
   * is the current reading minus the previous day's reading. If there is no
   * previous reading (or the counter was reset, i.e. previous > current) we
   * fall back to the current reading itself.
   */
  private async getAutoCalculateDelta(
    record: DailyTotalsDocument,
  ): Promise<{ totalA: number; totalA2: number }> {
    const prev = await this.dailyTotalsModel
      .findOne({
        userId: record.userId,
        deviceId: record.deviceId,
        date: { $lt: record.date },
        deletedAt: null,
      })
      .sort({ date: -1 })
      .exec();

    if (!prev) {
      return { totalA: record.totalA, totalA2: record.totalA2 };
    }

    const totalA = new Decimal(record.totalA).minus(prev.totalA);
    const totalA2 = new Decimal(record.totalA2).minus(prev.totalA2);

    return {
      totalA: totalA.isNegative() ? record.totalA : totalA.toNumber(),
      totalA2: totalA2.isNegative() ? record.totalA2 : totalA2.toNumber(),
    };
  }

  /**
   * Convert a month's records into real daily values.
   * For auto-calculated devices the stored value is a cumulative counter, so
   * each day's value = its reading minus the previous reading. The baseline for
   * the first day is the last reading before the month starts, which makes the
   * summed month total equal to (last reading of the month - last reading of
   * the previous month). Only one extra query per auto device is needed.
   */
  private async computeMonthlyDailyValues(
    userId: string,
    monthStart: Date,
    records: DailyTotalsDocument[],
  ): Promise<
    Array<{ record: DailyTotalsDocument; totalA: number; totalA2: number }>
  > {
    // Group by device, keeping the ascending-by-date order.
    const byDevice = new Map<string, DailyTotalsDocument[]>();
    for (const record of records) {
      const list = byDevice.get(record.deviceId);
      if (list) list.push(record);
      else byDevice.set(record.deviceId, [record]);
    }

    const result: Array<{
      record: DailyTotalsDocument;
      totalA: number;
      totalA2: number;
    }> = [];

    for (const [deviceId, devRecords] of byDevice) {
      const isAuto = devRecords.some((r) => r.autoCalculate);

      if (!isAuto) {
        for (const record of devRecords) {
          result.push({
            record,
            totalA: record.totalA,
            totalA2: record.totalA2,
          });
        }
        continue;
      }

      // Last reading strictly before the month → baseline for the first day.
      const prevMonth = await this.dailyTotalsModel
        .findOne({
          userId,
          deviceId,
          date: { $lt: monthStart },
          deletedAt: null,
        })
        .sort({ date: -1 })
        .exec();

      let prevA = prevMonth ? new Decimal(prevMonth.totalA) : null;
      let prevA2 = prevMonth ? new Decimal(prevMonth.totalA2) : null;

      for (const record of devRecords) {
        const curA = new Decimal(record.totalA);
        const curA2 = new Decimal(record.totalA2);
        const deltaA = prevA ? curA.minus(prevA) : curA;
        const deltaA2 = prevA2 ? curA2.minus(prevA2) : curA2;

        result.push({
          record,
          totalA: deltaA.isNegative() ? record.totalA : deltaA.toNumber(),
          totalA2: deltaA2.isNegative() ? record.totalA2 : deltaA2.toNumber(),
        });

        prevA = curA;
        prevA2 = curA2;
      }
    }

    return result;
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

    const filter: any = { deletedAt: null };

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
    return this.dailyTotalsModel
      .findOne({ _id: id, deletedAt: null })
      .exec() as Promise<DailyTotals | null>;
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
        deletedAt: null,
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
    autoCalculate = false,
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
            autoCalculate,
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

    // Use atomic $inc operator - single DB call instead of read-then-write
    // This reduces CPU load by 50% and prevents race conditions
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
    return this.dailyTotalsModel
      .findOneAndUpdate(
        { _id: id, deletedAt: null },
        { deletedAt: new Date() },
        { new: true },
      )
      .exec() as Promise<DailyTotals | null>;
  }

  async removeByUserAndDevice(
    userId: string,
    deviceId: string,
    date: string,
  ): Promise<DailyTotals | null> {
    const { start, end } = this.getGMT7DateRange(date);

    return this.dailyTotalsModel
      .findOneAndUpdate(
        {
          userId,
          deviceId,
          date: { $gte: start, $lte: end },
          deletedAt: null,
        },
        { deletedAt: new Date() },
        { new: true },
      )
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
    const filter: any = { userId, deletedAt: null };

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

    // Use decimal.js for precise aggregation to avoid floating point errors
    const totalA = records
      .reduce((sum, record) => sum.plus(record.totalA), new Decimal(0))
      .toNumber();
    const totalA2 = records
      .reduce((sum, record) => sum.plus(record.totalA2), new Decimal(0))
      .toNumber();

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
    const filter: any = { userId, deletedAt: null };

    if (deviceId) filter.deviceId = deviceId;

    if (date) {
      const { start, end } = this.getGMT7DateRange(date);
      filter.date = { $gte: start, $lte: end };
    }

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: -1, createdAt: -1 })
      .exec();

    // Auto-calculated records store a cumulative counter; convert to the
    // real daily value (current reading - previous day's reading).
    return Promise.all(
      records.map(async (record) => {
        if (!record.autoCalculate) return record;
        const { totalA, totalA2 } = await this.getAutoCalculateDelta(record);
        const obj = record.toObject();
        obj.totalA = totalA;
        obj.totalA2 = totalA2;
        return obj as DailyTotals;
      }),
    );
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
    const utcStart =
      startOfMonth.getTime() + startOfMonth.getTimezoneOffset() * 60000;
    const gmt7Start = new Date(utcStart + 7 * 3600000);
    gmt7Start.setHours(0, 0, 0, 0);

    const utcEnd =
      endOfMonth.getTime() + endOfMonth.getTimezoneOffset() * 60000;
    const gmt7End = new Date(utcEnd + 7 * 3600000);
    gmt7End.setHours(23, 59, 59, 999);

    const filter: any = {
      userId,
      date: { $gte: gmt7Start, $lte: gmt7End },
      deletedAt: null,
    };

    if (deviceId) filter.deviceId = deviceId;

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    // Convert cumulative (auto-calculated) readings into real daily values.
    const dailyValues = await this.computeMonthlyDailyValues(
      userId,
      gmt7Start,
      records,
    );

    // Group by date
    const dailyMap = new Map<
      string,
      { totalA: number; totalA2: number; devices: Set<string> }
    >();

    for (const { record, totalA, totalA2 } of dailyValues) {
      const dateKey = record.date.toISOString().split('T')[0];

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { totalA: 0, totalA2: 0, devices: new Set() });
      }

      const daily = dailyMap.get(dateKey)!;
      daily.totalA += totalA;
      daily.totalA2 += totalA2;
      daily.devices.add(record.deviceId);
    }

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

    const peakDayA = dailyRecords.reduce(
      (peak, day) =>
        day.totalA > peak.value ? { date: day.date, value: day.totalA } : peak,
      { date: '', value: 0 },
    );

    const peakDayA2 = dailyRecords.reduce(
      (peak, day) =>
        day.totalA2 > peak.value
          ? { date: day.date, value: day.totalA2 }
          : peak,
      { date: '', value: 0 },
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

  async calculateTotalsByUserAndDevice(
    userId: string,
    deviceId: string,
  ): Promise<{
    totalA: number;
    totalA2: number;
  }> {
    const records = await this.dailyTotalsModel
      .find({ userId, deviceId, deletedAt: null })
      .exec();

    // Use decimal.js for precise aggregation to avoid floating point errors
    const totalA = records
      .reduce((sum, record) => sum.plus(record.totalA), new Decimal(0))
      .toNumber();
    const totalA2 = records
      .reduce((sum, record) => sum.plus(record.totalA2), new Decimal(0))
      .toNumber();

    return {
      totalA,
      totalA2,
    };
  }

  async clearCurrentMonthTotals(
    userId: string,
    deviceId?: string,
  ): Promise<void> {
    const currentDate = new Date();
    const targetYear = currentDate.getFullYear();
    const targetMonth = currentDate.getMonth() + 1;

    const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
    const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    const utcStart =
      startOfMonth.getTime() + startOfMonth.getTimezoneOffset() * 60000;
    const gmt7Start = new Date(utcStart + 7 * 3600000);
    gmt7Start.setHours(0, 0, 0, 0);

    const utcEnd =
      endOfMonth.getTime() + endOfMonth.getTimezoneOffset() * 60000;
    const gmt7End = new Date(utcEnd + 7 * 3600000);
    gmt7End.setHours(23, 59, 59, 999);

    const filter: any = {
      userId,
      date: { $gte: gmt7Start, $lte: gmt7End },
      deletedAt: null,
    };

    if (deviceId) {
      filter.deviceId = deviceId;
    }

    await this.dailyTotalsModel
      .updateMany(filter, { deletedAt: new Date() })
      .exec();
  }

  async getMonthlyChartData(
    userId: string,
    deviceId?: string,
    year?: number,
    month?: number,
  ): Promise<Array<{ date: string; totalA: number; totalA2: number }>> {
    const currentDate = new Date();
    const targetYear = year || currentDate.getFullYear();
    const targetMonth = month || currentDate.getMonth() + 1;

    // Create date range for the month in GMT+7
    const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
    const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    // Convert to GMT+7
    const utcStart =
      startOfMonth.getTime() + startOfMonth.getTimezoneOffset() * 60000;
    const gmt7Start = new Date(utcStart + 7 * 3600000);
    gmt7Start.setHours(0, 0, 0, 0);

    const utcEnd =
      endOfMonth.getTime() + endOfMonth.getTimezoneOffset() * 60000;
    const gmt7End = new Date(utcEnd + 7 * 3600000);
    gmt7End.setHours(23, 59, 59, 999);

    const filter: any = {
      userId,
      date: { $gte: gmt7Start, $lte: gmt7End },
      deletedAt: null,
    };

    if (deviceId) filter.deviceId = deviceId;

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    // Convert cumulative (auto-calculated) readings into real daily values.
    const dailyValues = await this.computeMonthlyDailyValues(
      userId,
      gmt7Start,
      records,
    );

    // Group by date and sum totals
    const dailyMap = new Map<string, { totalA: Decimal; totalA2: Decimal }>();

    for (const { record, totalA, totalA2 } of dailyValues) {
      const dateKey = record.date.toISOString().split('T')[0];

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          totalA: new Decimal(0),
          totalA2: new Decimal(0),
        });
      }

      const daily = dailyMap.get(dateKey)!;
      daily.totalA = daily.totalA.plus(totalA);
      daily.totalA2 = daily.totalA2.plus(totalA2);
    }

    // Convert to array format for charting
    return Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        totalA: data.totalA.toNumber(),
        totalA2: data.totalA2.toNumber(),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
