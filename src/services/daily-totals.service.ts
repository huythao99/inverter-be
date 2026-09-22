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

  private readonly GMT7_OFFSET_MS = 7 * 3600000;

  // Start of the given instant's GMT+7 calendar day, expressed in UTC.
  // Timezone-INDEPENDENT (does not use the server's local timezone), so every
  // process/server computes the same day key. This prevents the same GMT+7 day
  // from being stored under two different keys (duplicate buckets).
  private getGMT7Date(date?: Date): Date {
    const base = date || new Date();
    const shifted = new Date(base.getTime() + this.GMT7_OFFSET_MS);
    return new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
      ) - this.GMT7_OFFSET_MS,
    );
  }

  private getGMT7DateRange(dateStr: string): { start: Date; end: Date } {
    const start = this.getGMT7Date(new Date(dateStr));
    const end = new Date(start.getTime() + 24 * 3600000 - 1);
    return { start, end };
  }

  // Only GTIControl devices numbered 1100 and above use the autoCalculate path.
  // autoCalculate records belonging to any other device are invalid and must be
  // ignored by the calculations.
  private isAutoCalcDevice(deviceId: string): boolean {
    const match = /^GTIControl(\d+)$/.exec(deviceId || '');
    if (!match) return false;
    return parseInt(match[1], 10) >= 1100;
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

  // Last reading of the GMT+7 day immediately before `dayStart`. Handles legacy
  // duplicate buckets by taking the max value within that day (the counter is
  // monotonic, so the max is the day's last reading).
  private async getPrevDayReading(
    userId: string,
    deviceId: string,
    dayStart: Date,
  ): Promise<{ totalA: number; totalA2: number } | null> {
    const latest = await this.dailyTotalsModel
      .findOne({
        userId,
        deviceId,
        autoCalculate: true,
        date: { $lt: dayStart },
        deletedAt: null,
      })
      .sort({ date: -1 })
      .exec();
    if (!latest) return null;

    const prevStart = this.getGMT7Date(latest.date);
    const prevEnd = new Date(prevStart.getTime() + 24 * 3600000 - 1);
    const dayRecords = await this.dailyTotalsModel
      .find({
        userId,
        deviceId,
        autoCalculate: true,
        date: { $gte: prevStart, $lte: prevEnd },
        deletedAt: null,
      })
      .exec();

    let maxA = new Decimal(latest.totalA);
    let maxA2 = new Decimal(latest.totalA2);
    for (const r of dayRecords) {
      if (new Decimal(r.totalA).greaterThan(maxA)) maxA = new Decimal(r.totalA);
      if (new Decimal(r.totalA2).greaterThan(maxA2))
        maxA2 = new Decimal(r.totalA2);
    }
    return { totalA: maxA.toNumber(), totalA2: maxA2.toNumber() };
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
      const isAuto =
        this.isAutoCalcDevice(deviceId) &&
        devRecords.some((r) => r.autoCalculate);

      if (!isAuto) {
        for (const record of devRecords) {
          // Skip autoCalculate records on non-qualifying devices (< 1100).
          if (record.autoCalculate) continue;
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

    // Fetch all matching records; auto-calculated devices are collapsed to one
    // row per GMT+7 day, so pagination is applied in-memory afterwards.
    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    const byDevice = new Map<string, DailyTotalsDocument[]>();
    for (const record of records) {
      const list = byDevice.get(record.deviceId);
      if (list) list.push(record);
      else byDevice.set(record.deviceId, [record]);
    }

    const rows: DailyTotals[] = [];

    for (const [devId, devRecords] of byDevice) {
      // A device can have both legacy records (real daily values, no
      // autoCalculate) and new records (cumulative counter, autoCalculate).
      // Handle them separately — a non-auto record is NOT a cumulative reading
      // and must never be used as a subtraction baseline.
      // autoCalculate records only belong to GTIControl11xx+; on any other
      // device they are invalid and skipped entirely.
      const isAutoDevice = this.isAutoCalcDevice(devId);
      const autoRecords = isAutoDevice
        ? devRecords.filter((r) => r.autoCalculate)
        : [];
      const plainRecords = devRecords.filter((r) => !r.autoCalculate);

      // Non auto-calculated records already hold real daily values.
      rows.push(...plainRecords);

      if (autoRecords.length === 0) continue;

      // Collapse auto records to one reading per GMT+7 day (last reading = max
      // of the monotonic counter), then daily value = this day - previous
      // AUTO day.
      const dayMap = new Map<number, DailyTotalsDocument>();
      for (const r of autoRecords) {
        const key = this.getGMT7Date(r.date).getTime();
        const cur = dayMap.get(key);
        if (!cur || r.totalA > cur.totalA) dayMap.set(key, r);
      }

      const dayKeys = [...dayMap.keys()].sort((a, b) => a - b);
      const ownerId = userId || autoRecords[0].userId;
      let prev = await this.getPrevDayReading(
        ownerId,
        devId,
        new Date(dayKeys[0]),
      );

      for (const key of dayKeys) {
        const rec = dayMap.get(key)!;
        const totalA = prev
          ? new Decimal(rec.totalA).minus(prev.totalA).toNumber()
          : rec.totalA;
        const totalA2 = prev
          ? new Decimal(rec.totalA2).minus(prev.totalA2).toNumber()
          : rec.totalA2;

        const obj = rec.toObject() as DailyTotals;
        obj.date = new Date(key);
        obj.totalA = totalA;
        obj.totalA2 = totalA2;
        rows.push(obj);

        // Baseline for the next day is this day's raw reading.
        prev = { totalA: rec.totalA, totalA2: rec.totalA2 };
      }
    }

    // Sort combined rows and paginate in-memory.
    const dir = sortOrder === 'desc' ? -1 : 1;
    rows.sort((a, b) => (a.date.getTime() - b.date.getTime()) * dir);

    const total = rows.length;
    const data = rows.slice(offset, offset + limit);

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

    // Group by device (records are already sorted ascending by date).
    const byDevice = new Map<string, DailyTotalsDocument[]>();
    for (const record of records) {
      const list = byDevice.get(record.deviceId);
      if (list) list.push(record);
      else byDevice.set(record.deviceId, [record]);
    }

    let totalADec = new Decimal(0);
    let totalA2Dec = new Decimal(0);

    for (const [deviceId, devRecords] of byDevice) {
      const isAuto =
        this.isAutoCalcDevice(deviceId) &&
        devRecords.some((r) => r.autoCalculate);

      if (isAuto) {
        // Cumulative counter: the range total is the last reading of the end
        // day minus the last reading of the start day (GMT+7). There is one
        // record per day and its value already holds that day's last reading,
        // so the first/last records in the range are those two readings.
        const autoRecords = devRecords.filter((r) => r.autoCalculate);
        const first = autoRecords[0];
        const last = autoRecords[autoRecords.length - 1];
        const dA = new Decimal(last.totalA).minus(first.totalA);
        const dA2 = new Decimal(last.totalA2).minus(first.totalA2);
        totalADec = totalADec.plus(dA.isNegative() ? 0 : dA);
        totalA2Dec = totalA2Dec.plus(dA2.isNegative() ? 0 : dA2);
      } else {
        // Non auto-calculated records already hold real daily values → sum.
        // Skip autoCalculate records on non-qualifying devices (< 1100).
        for (const r of devRecords) {
          if (r.autoCalculate) continue;
          totalADec = totalADec.plus(r.totalA);
          totalA2Dec = totalA2Dec.plus(r.totalA2);
        }
      }
    }

    const totalA = totalADec.toNumber();
    const totalA2 = totalA2Dec.toNumber();

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

    // Auto-calculated records store a cumulative counter; convert to the real
    // daily value (current reading - previous day's reading). autoCalculate
    // records on non-qualifying devices (< 1100) are invalid and skipped.
    const results: DailyTotals[] = [];
    for (const record of records) {
      if (!record.autoCalculate) {
        results.push(record);
        continue;
      }
      if (!this.isAutoCalcDevice(record.deviceId)) continue;
      const { totalA, totalA2 } = await this.getAutoCalculateDelta(record);
      const obj = record.toObject() as DailyTotals;
      obj.totalA = totalA;
      obj.totalA2 = totalA2;
      results.push(obj);
    }
    return results;
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
      .sort({ date: 1 })
      .exec();

    const isAuto =
      this.isAutoCalcDevice(deviceId) &&
      records.some((record) => record.autoCalculate);

    // Auto-calculated records hold a cumulative counter, so summing them is
    // wrong. The lifetime total is simply the latest reading minus the first
    // reading.
    if (isAuto) {
      const autoRecords = records.filter((record) => record.autoCalculate);
      const first = autoRecords[0];
      const last = autoRecords[autoRecords.length - 1];

      return {
        totalA: new Decimal(last.totalA).minus(first.totalA).toNumber(),
        totalA2: new Decimal(last.totalA2).minus(first.totalA2).toNumber(),
      };
    }

    // Non auto-calculated records already hold real daily values → sum them.
    // Skip autoCalculate records on non-qualifying devices (< 1100).
    // Use decimal.js for precise aggregation to avoid floating point errors.
    const plainRecords = records.filter((record) => !record.autoCalculate);
    const totalA = plainRecords
      .reduce((sum, record) => sum.plus(record.totalA), new Decimal(0))
      .toNumber();
    const totalA2 = plainRecords
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
