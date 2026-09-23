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

  // YYYY-MM-DD of the GMT+7 calendar day that contains `date`.
  // (record.date is stored as GMT+7 midnight = 17:00Z of the previous UTC day,
  // so a plain toISOString() would be one day early.)
  private toGMT7DateKey(date: Date): string {
    return new Date(date.getTime() + this.GMT7_OFFSET_MS)
      .toISOString()
      .split('T')[0];
  }

  // [start, end] of a GMT+7 calendar month. Timezone-INDEPENDENT (does not
  // depend on the server's TZ). Defaults to the current GMT+7 month.
  private getGMT7MonthRange(
    year?: number,
    month?: number,
  ): { year: number; month: number; start: Date; end: Date } {
    const nowKey = this.toGMT7DateKey(new Date());
    const y = Number(year) || Number(nowKey.slice(0, 4));
    const m = Number(month) || Number(nowKey.slice(5, 7));
    const start = new Date(Date.UTC(y, m - 1, 1) - this.GMT7_OFFSET_MS);
    const end = new Date(Date.UTC(y, m, 1) - this.GMT7_OFFSET_MS - 1);
    return { year: y, month: m, start, end };
  }

  /**
   * Convert ONE device's odometer (autoCalculate) records into real daily
   * values. Records are collapsed to one reading per GMT+7 day (max of each
   * counter = the day's last reading, also absorbs legacy duplicate buckets).
   * Daily value = this day's reading - previous day's reading. With no
   * previous reading (first day online) the first reading seen that day is
   * the baseline (odoStartA/odoStartA2); if the counter went down (STM32
   * odometer reset) the reading itself is used.
   */
  private odometerToDailyValues(
    autoRecords: DailyTotalsDocument[],
    baseline: { totalA: number; totalA2: number } | null,
  ): Array<{
    dayStart: Date;
    record: DailyTotalsDocument;
    totalA: number;
    totalA2: number;
  }> {
    const toDec = (v: number | null | undefined): Decimal | null =>
      v === null || v === undefined || !isFinite(v) ? null : new Decimal(v);
    const minDec = (x: Decimal | null, y: Decimal | null): Decimal | null =>
      x === null ? y : y === null ? x : Decimal.min(x, y);

    const dayMap = new Map<
      number,
      {
        record: DailyTotalsDocument;
        a: Decimal;
        a2: Decimal;
        startA: Decimal | null;
        startA2: Decimal | null;
      }
    >();
    for (const r of autoRecords) {
      const key = this.getGMT7Date(r.date).getTime();
      const a = new Decimal(r.totalA || 0);
      const a2 = new Decimal(r.totalA2 || 0);
      const startA = toDec(r.odoStartA);
      const startA2 = toDec(r.odoStartA2);
      const cur = dayMap.get(key);
      if (!cur) {
        dayMap.set(key, { record: r, a, a2, startA, startA2 });
        continue;
      }
      if (a.greaterThan(cur.a)) {
        cur.a = a;
        cur.record = r;
      }
      if (a2.greaterThan(cur.a2)) cur.a2 = a2;
      cur.startA = minDec(cur.startA, startA);
      cur.startA2 = minDec(cur.startA2, startA2);
    }

    let prevA = baseline ? new Decimal(baseline.totalA) : null;
    let prevA2 = baseline ? new Decimal(baseline.totalA2) : null;
    const out: Array<{
      dayStart: Date;
      record: DailyTotalsDocument;
      totalA: number;
      totalA2: number;
    }> = [];

    for (const key of [...dayMap.keys()].sort((x, y) => x - y)) {
      const { record, a, a2, startA, startA2 } = dayMap.get(key)!;
      // No previous day: measure against the first reading seen that day
      // (legacy records without it fall back to the whole reading).
      const baseA = prevA ?? startA;
      const baseA2 = prevA2 ?? startA2;
      const dA = baseA ? a.minus(baseA) : a;
      const dA2 = baseA2 ? a2.minus(baseA2) : a2;
      out.push({
        dayStart: new Date(key),
        record,
        totalA: dA.isNegative() ? a.toNumber() : dA.toNumber(),
        totalA2: dA2.isNegative() ? a2.toNumber() : dA2.toNumber(),
      });
      prevA = a;
      prevA2 = a2;
    }
    return out;
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
    Array<{
      dateKey: string;
      deviceId: string;
      totalA: number;
      totalA2: number;
    }>
  > {
    // Group by device, keeping the ascending-by-date order.
    const byDevice = new Map<string, DailyTotalsDocument[]>();
    for (const record of records) {
      const list = byDevice.get(record.deviceId);
      if (list) list.push(record);
      else byDevice.set(record.deviceId, [record]);
    }

    const result: Array<{
      dateKey: string;
      deviceId: string;
      totalA: number;
      totalA2: number;
    }> = [];

    for (const [deviceId, devRecords] of byDevice) {
      // A device can have legacy daily-value records AND odometer records
      // (after a firmware upgrade) — handle them separately.
      for (const r of devRecords.filter((x) => !x.autoCalculate)) {
        result.push({
          dateKey: this.toGMT7DateKey(r.date),
          deviceId,
          totalA: r.totalA,
          totalA2: r.totalA2,
        });
      }

      const autoRecords = devRecords.filter((x) => x.autoCalculate);
      if (autoRecords.length === 0) continue;

      // Last odometer reading before the month → baseline for the first day.
      const baseline = await this.getPrevDayReading(
        userId,
        deviceId,
        monthStart,
      );
      for (const d of this.odometerToDailyValues(autoRecords, baseline)) {
        result.push({
          dateKey: this.toGMT7DateKey(d.dayStart),
          deviceId,
          totalA: d.totalA,
          totalA2: d.totalA2,
        });
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
      const autoRecords = devRecords.filter((r) => r.autoCalculate);
      const plainRecords = devRecords.filter((r) => !r.autoCalculate);

      // Non auto-calculated records already hold real daily values.
      rows.push(...plainRecords);

      if (autoRecords.length === 0) continue;

      // Odometer records → one real daily value per GMT+7 day.
      const ownerId = userId || autoRecords[0].userId;
      const baseline = await this.getPrevDayReading(
        ownerId,
        devId,
        this.getGMT7Date(autoRecords[0].date),
      );

      for (const d of this.odometerToDailyValues(autoRecords, baseline)) {
        const obj = d.record.toObject() as DailyTotals;
        obj.date = d.dayStart;
        obj.totalA = d.totalA;
        obj.totalA2 = d.totalA2;
        rows.push(obj);
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
            // The unique index (userId, deviceId, date) makes a soft-deleted
            // record the only possible target: revive it, otherwise new data
            // would keep landing in an invisible record.
            deletedAt: null,
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

  /**
   * Store an odometer reading (12-number frame, positions 11 & 12) as the
   * day's reading. `$max` keeps the stored value monotonic within the day, so
   * a late/out-of-order frame or a lower glitch value can never pull the
   * day's last reading (= next day's baseline) down.
   */
  async upsertOdometerReading(
    userId: string,
    deviceId: string,
    date: string,
    totalA: number,
    totalA2: number,
  ): Promise<void> {
    const { start } = this.getGMT7DateRange(date);

    await this.dailyTotalsModel
      .updateOne(
        { userId, deviceId, date: start },
        {
          $max: { totalA, totalA2 },
          // First reading of the day = baseline for the first day online.
          $min: { odoStartA: totalA, odoStartA2: totalA2 },
          $set: {
            autoCalculate: true,
            timezone: 'Asia/Ho_Chi_Minh',
            updatedAt: new Date(),
            deletedAt: null,
          },
          $setOnInsert: {
            userId,
            deviceId,
            date: start,
            createdAt: new Date(),
          },
        },
        { upsert: true },
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
            deletedAt: null,
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

    for (const [devId, devRecords] of byDevice) {
      // Legacy records already hold real daily values → sum.
      for (const r of devRecords.filter((x) => !x.autoCalculate)) {
        totalADec = totalADec.plus(r.totalA);
        totalA2Dec = totalA2Dec.plus(r.totalA2);
      }

      // Odometer records: sum of real daily values, where the first day is
      // measured against the last reading BEFORE the range (so the first
      // day's production is not lost).
      const autoRecords = devRecords.filter((x) => x.autoCalculate);
      if (autoRecords.length === 0) continue;
      const baseline = await this.getPrevDayReading(
        userId,
        devId,
        this.getGMT7Date(autoRecords[0].date),
      );
      for (const d of this.odometerToDailyValues(autoRecords, baseline)) {
        totalADec = totalADec.plus(d.totalA);
        totalA2Dec = totalA2Dec.plus(d.totalA2);
      }
    }

    return {
      totalA: totalADec.toNumber(),
      totalA2: totalA2Dec.toNumber(),
      count: records.length,
      records,
    };
  }

  /**
   * Flatten every record in a range into REAL daily values, with autoCalculate
   * deltas applied per device. Global scope by default (no user filter) so CMS
   * analytics can aggregate across everyone; optionally narrowed by
   * userId/deviceId. Each returned entry is one (device, GMT+7 day) with the
   * day's real value. Summing them is always safe — odometer readings are
   * never summed raw.
   */
  async getDailyValuesForRange(options: {
    userId?: string;
    deviceId?: string;
    start?: Date;
    end?: Date;
  }): Promise<
    Array<{
      userId: string;
      deviceId: string;
      date: Date;
      totalA: number;
      totalA2: number;
      updatedAt: Date;
    }>
  > {
    const filter: any = { deletedAt: null };
    if (options.userId) filter.userId = options.userId;
    if (options.deviceId) filter.deviceId = options.deviceId;
    if (options.start || options.end) {
      filter.date = {};
      if (options.start) filter.date.$gte = options.start;
      if (options.end) filter.date.$lte = options.end;
    }

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    // Group by user+device (deviceId alone can collide across users).
    const byDevice = new Map<string, DailyTotalsDocument[]>();
    for (const record of records) {
      const key = `${record.userId}:${record.deviceId}`;
      const list = byDevice.get(key);
      if (list) list.push(record);
      else byDevice.set(key, [record]);
    }

    const out: Array<{
      userId: string;
      deviceId: string;
      date: Date;
      totalA: number;
      totalA2: number;
      updatedAt: Date;
    }> = [];

    for (const devRecords of byDevice.values()) {
      const autoRecords = devRecords.filter((r) => r.autoCalculate);
      const plainRecords = devRecords.filter((r) => !r.autoCalculate);

      // Non auto-calculated records already hold real daily values.
      for (const r of plainRecords) {
        out.push({
          userId: r.userId,
          deviceId: r.deviceId,
          date: r.date,
          totalA: r.totalA,
          totalA2: r.totalA2,
          updatedAt: r.updatedAt ?? r.date,
        });
      }

      if (autoRecords.length === 0) continue;

      const first = autoRecords[0];
      const baseline = await this.getPrevDayReading(
        first.userId,
        first.deviceId,
        this.getGMT7Date(first.date),
      );
      for (const d of this.odometerToDailyValues(autoRecords, baseline)) {
        out.push({
          userId: d.record.userId,
          deviceId: d.record.deviceId,
          date: d.dayStart,
          totalA: d.totalA,
          totalA2: d.totalA2,
          updatedAt: d.record.updatedAt ?? d.dayStart,
        });
      }
    }

    return out;
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
      .sort({ date: 1, createdAt: 1 })
      .exec();

    const results: DailyTotals[] = records.filter((r) => !r.autoCalculate);

    // Odometer records → real daily values, one per device per GMT+7 day
    // (legacy duplicate buckets in the same day are collapsed, not summed).
    const autoByDevice = new Map<string, DailyTotalsDocument[]>();
    for (const r of records) {
      if (!r.autoCalculate) continue;
      const list = autoByDevice.get(r.deviceId);
      if (list) list.push(r);
      else autoByDevice.set(r.deviceId, [r]);
    }
    for (const [devId, autoRecords] of autoByDevice) {
      const baseline = await this.getPrevDayReading(
        userId,
        devId,
        this.getGMT7Date(autoRecords[0].date),
      );
      for (const d of this.odometerToDailyValues(autoRecords, baseline)) {
        const obj = d.record.toObject() as DailyTotals;
        obj.date = d.dayStart;
        obj.totalA = d.totalA;
        obj.totalA2 = d.totalA2;
        results.push(obj);
      }
    }

    return results.sort((a, b) => b.date.getTime() - a.date.getTime());
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
    const range = this.getGMT7MonthRange(year, month);

    const filter: any = {
      userId,
      date: { $gte: range.start, $lte: range.end },
      deletedAt: null,
    };

    if (deviceId) filter.deviceId = deviceId;

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    // Convert odometer (auto-calculated) readings into real daily values.
    const dailyValues = await this.computeMonthlyDailyValues(
      userId,
      range.start,
      records,
    );

    // Group by GMT+7 date
    const dailyMap = new Map<
      string,
      { totalA: Decimal; totalA2: Decimal; devices: Set<string> }
    >();

    for (const v of dailyValues) {
      let daily = dailyMap.get(v.dateKey);
      if (!daily) {
        daily = {
          totalA: new Decimal(0),
          totalA2: new Decimal(0),
          devices: new Set(),
        };
        dailyMap.set(v.dateKey, daily);
      }
      daily.totalA = daily.totalA.plus(v.totalA);
      daily.totalA2 = daily.totalA2.plus(v.totalA2);
      daily.devices.add(v.deviceId);
    }

    const dailyRecords = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        totalA: data.totalA.toNumber(),
        totalA2: data.totalA2.toNumber(),
        devices: data.devices.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalA = dailyRecords
      .reduce((sum, day) => sum.plus(day.totalA), new Decimal(0))
      .toNumber();
    const totalA2 = dailyRecords
      .reduce((sum, day) => sum.plus(day.totalA2), new Decimal(0))
      .toNumber();

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
      year: range.year,
      month: range.month,
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

    // Legacy records (real daily values) + odometer records converted to real
    // daily values — the same numbers the daily list / charts show, so the
    // lifetime total always equals the sum of the days.
    let totalA = new Decimal(0);
    let totalA2 = new Decimal(0);

    for (const r of records.filter((x) => !x.autoCalculate)) {
      totalA = totalA.plus(r.totalA);
      totalA2 = totalA2.plus(r.totalA2);
    }

    const autoRecords = records.filter((x) => x.autoCalculate);
    for (const d of this.odometerToDailyValues(autoRecords, null)) {
      totalA = totalA.plus(d.totalA);
      totalA2 = totalA2.plus(d.totalA2);
    }

    return {
      totalA: totalA.toNumber(),
      totalA2: totalA2.toNumber(),
    };
  }

  async clearCurrentMonthTotals(
    userId: string,
    deviceId?: string,
  ): Promise<void> {
    const range = this.getGMT7MonthRange();

    const filter: any = {
      userId,
      date: { $gte: range.start, $lte: range.end },
      deletedAt: null,
      // Odometer readings are never cleared: they are the baselines for the
      // following days, deleting them would make the next day's value jump
      // by the whole month.
      autoCalculate: { $ne: true },
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
    const range = this.getGMT7MonthRange(year, month);

    const filter: any = {
      userId,
      date: { $gte: range.start, $lte: range.end },
      deletedAt: null,
    };

    if (deviceId) filter.deviceId = deviceId;

    const records = await this.dailyTotalsModel
      .find(filter)
      .sort({ date: 1 })
      .exec();

    // Convert odometer (auto-calculated) readings into real daily values.
    const dailyValues = await this.computeMonthlyDailyValues(
      userId,
      range.start,
      records,
    );

    // Group by GMT+7 date and sum totals
    const dailyMap = new Map<string, { totalA: Decimal; totalA2: Decimal }>();

    for (const v of dailyValues) {
      let daily = dailyMap.get(v.dateKey);
      if (!daily) {
        daily = { totalA: new Decimal(0), totalA2: new Decimal(0) };
        dailyMap.set(v.dateKey, daily);
      }
      daily.totalA = daily.totalA.plus(v.totalA);
      daily.totalA2 = daily.totalA2.plus(v.totalA2);
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
