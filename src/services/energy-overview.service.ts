import { BadRequestException, Injectable } from '@nestjs/common';
import { DailyTotalsService } from './daily-totals.service';
import { RedisDailyTotalsService } from './redis-daily-totals.service';
import { InverterDeviceService } from './inverter-device.service';
import { EnergyReportService, TariffMode } from './energy-report.service';
import { ShareService } from './share.service';

const GMT7_MS = 7 * 3600 * 1000;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** One device-day of real energy (odometer deltas already applied). */
export interface DayRow {
  deviceId: string;
  /** GMT+7 calendar day, YYYY-MM-DD. */
  date: string;
  /** Inverter output ("xả"), kWh. */
  a: number;
  /** Taken from the grid ("lấy lưới"), kWh. */
  a2: number;
}

export interface OverviewDevice {
  deviceId: string;
  name: string;
  generatedKwh: number;
  gridKwh: number;
  savings: number;
  /** Share of the account's generated energy in this period, 0..100. */
  sharePercent: number;
}

export interface OverviewPeriod {
  generatedKwh: number;
  gridKwh: number;
  consumptionKwh: number;
  /** Share of the consumption covered by the inverters, 0..100. */
  selfSufficiency: number;
  savings: number;
  /** Sorted by generated energy, biggest first. */
  devices: OverviewDevice[];
}

export interface EnergyOverview {
  generatedAt: string;
  devices: Array<{ deviceId: string; name: string }>;
  tariff: ReturnType<EnergyReportService['tariffInfo']>;
  today: OverviewPeriod & { date: string };
  month: OverviewPeriod & {
    year: number;
    month: number;
    partial: boolean;
    days: Array<{ date: string; generatedKwh: number; gridKwh: number }>;
  };
  year: OverviewPeriod & {
    year: number;
    months: Array<{
      month: number;
      generatedKwh: number;
      gridKwh: number;
      savings: number;
    }>;
  };
  lifetime: OverviewPeriod & { since: string | null };
}

export function gmt7DateKey(d: Date): string {
  return new Date(d.getTime() + GMT7_MS).toISOString().slice(0, 10);
}

/** deviceId -> billing / grid-line key (own id unless in a share cluster). */
export type ClusterOf = (deviceId: string) => string;
const ownId: ClusterOf = (id) => id;

/**
 * Devices on the same grid line (share group members) all measure the same
 * import: per cluster and day, the import counts once - the average of the
 * members' readings that day. Each member keeps readings / n, so sums over
 * the cluster give the average while every device stays listed.
 */
export function splitSharedGrid(
  rows: DayRow[],
  clusterOf: ClusterOf,
): DayRow[] {
  // Only members that measured something that day (an offline member's 0
  // must not pull the average down).
  const n = new Map<string, number>();
  const key = (r: DayRow) => `${clusterOf(r.deviceId)}|${r.date}`;
  for (const r of rows) {
    if (r.a2 > 0) n.set(key(r), (n.get(key(r)) ?? 0) + 1);
  }
  return rows.map((r) => {
    const k = n.get(key(r)) ?? 1;
    return k > 1 && r.a2 > 0 ? { ...r, a2: r.a2 / k } : r;
  });
}

/**
 * Savings of every (meter, month): bill(generated + grid) - bill(grid).
 * A meter is one inverter, or all the inverters of one grid line (share
 * group): they sit behind the same electricity meter. Key: `${meter}|YYYY-MM`.
 */
export function monthlySavings(
  rows: DayRow[],
  bill: (kwh: number) => number,
  clusterOf: ClusterOf = ownId,
): Map<string, { a: number; savings: number }> {
  const sums = new Map<string, { a: number; a2: number }>();
  for (const r of rows) {
    const k = `${clusterOf(r.deviceId)}|${r.date.slice(0, 7)}`;
    const s = sums.get(k) ?? { a: 0, a2: 0 };
    s.a += r.a;
    s.a2 += r.a2;
    sums.set(k, s);
  }
  const out = new Map<string, { a: number; savings: number }>();
  for (const [k, s] of sums) {
    out.set(k, { a: s.a, savings: bill(s.a + s.a2) - bill(s.a2) });
  }
  return out;
}

/**
 * Sum rows into a period. Savings of a part of a month (e.g. today) is that
 * month's savings in proportion to the energy generated in the part.
 */
export function summarizePeriod(
  rows: DayRow[],
  names: Map<string, string>,
  savingsByMonth: Map<string, { a: number; savings: number }>,
  clusterOf: ClusterOf = ownId,
): OverviewPeriod {
  const perDev = new Map<
    string,
    { a: number; a2: number; byMonth: Map<string, number> }
  >();
  for (const r of rows) {
    const d = perDev.get(r.deviceId) ?? { a: 0, a2: 0, byMonth: new Map() };
    d.a += r.a;
    d.a2 += r.a2;
    const m = r.date.slice(0, 7);
    d.byMonth.set(m, (d.byMonth.get(m) ?? 0) + r.a);
    perDev.set(r.deviceId, d);
  }
  let gen = 0;
  let grid = 0;
  let savings = 0;
  const devices: OverviewDevice[] = [];
  for (const [deviceId, name] of names) {
    const d = perDev.get(deviceId);
    let devSavings = 0;
    if (d) {
      for (const [m, a] of d.byMonth) {
        // The meter's savings, in proportion to this device's output.
        const full = savingsByMonth.get(`${clusterOf(deviceId)}|${m}`);
        if (!full || full.a <= 0) continue;
        devSavings += full.savings * Math.min(1, a / full.a);
      }
    }
    devSavings = Math.round(devSavings);
    gen += d?.a ?? 0;
    grid += d?.a2 ?? 0;
    savings += devSavings;
    devices.push({
      deviceId,
      name,
      generatedKwh: round(d?.a ?? 0),
      gridKwh: round(d?.a2 ?? 0),
      savings: devSavings,
      sharePercent: 0,
    });
  }
  for (const dev of devices) {
    dev.sharePercent = gen > 0 ? round((dev.generatedKwh / gen) * 100, 1) : 0;
  }
  devices.sort((x, y) => y.generatedKwh - x.generatedKwh);
  const cons = gen + grid;
  return {
    generatedKwh: round(gen),
    gridKwh: round(grid),
    consumptionKwh: round(cons),
    selfSufficiency: cons > 0 ? round((gen / cons) * 100, 1) : 0,
    savings,
    devices,
  };
}

/**
 * Energy of all the inverters a user OWNS (devices shared with them are not
 * counted): today (live), one month by day, one year by month, lifetime.
 */
@Injectable()
export class EnergyOverviewService {
  /** Days before the current month never change: cached per user. */
  private readonly pastCache = new Map<
    string,
    { at: number; rows: DayRow[] }
  >();
  private readonly PAST_CACHE_MS = 6 * 3600 * 1000;

  constructor(
    private readonly dailyTotals: DailyTotalsService,
    private readonly redisTotals: RedisDailyTotalsService,
    private readonly devices: InverterDeviceService,
    private readonly energyReport: EnergyReportService,
    private readonly share: ShareService,
  ) {}

  private toRows(
    values: Array<{
      deviceId: string;
      date: Date;
      totalA: number;
      totalA2: number;
    }>,
    owned: Set<string>,
  ): DayRow[] {
    const byKey = new Map<string, DayRow>();
    for (const v of values) {
      if (!owned.has(v.deviceId)) continue;
      const date = gmt7DateKey(new Date(v.date));
      const k = `${v.deviceId}|${date}`;
      const r = byKey.get(k) ?? { deviceId: v.deviceId, date, a: 0, a2: 0 };
      // A negative day (odometer reset) counts as 0, as in the energy report.
      r.a += Math.max(0, Number(v.totalA) || 0);
      r.a2 += Math.max(0, Number(v.totalA2) || 0);
      byKey.set(k, r);
    }
    return [...byKey.values()];
  }

  private async pastRows(
    userId: string,
    monthStart: Date,
    owned: Set<string>,
  ): Promise<DayRow[]> {
    const key = `${userId}|${monthStart.toISOString()}`;
    const hit = this.pastCache.get(key);
    if (hit && Date.now() - hit.at < this.PAST_CACHE_MS) {
      return hit.rows.filter((r) => owned.has(r.deviceId));
    }
    const values = await this.dailyTotals.getDailyValuesForRange({
      userId,
      end: new Date(monthStart.getTime() - 1),
    });
    const rows = this.toRows(values, owned);
    if (this.pastCache.size > 2000) this.pastCache.clear();
    this.pastCache.set(key, { at: Date.now(), rows });
    return rows;
  }

  async overview(
    userId: string,
    yearIn?: number,
    monthIn?: number,
    mode: TariffMode = 'tiered',
    flatPriceIn?: number,
  ): Promise<EnergyOverview> {
    const todayKey = gmt7DateKey(new Date());
    const nowY = Number(todayKey.slice(0, 4));
    const nowM = Number(todayKey.slice(5, 7));
    const year = Number(yearIn) || nowY;
    const month = Number(monthIn) || nowM;
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      year < 2020 ||
      year > nowY + 1
    ) {
      throw new BadRequestException('Invalid year/month');
    }

    const list = await this.devices.findByUserId(userId);
    const names = new Map<string, string>();
    for (const d of list) names.set(d.deviceId, d.deviceName || d.deviceId);
    const owned = new Set(names.keys());

    const monthStart = new Date(Date.UTC(nowY, nowM - 1, 1) - GMT7_MS);
    const [past, currentValues, live] = await Promise.all([
      this.pastRows(userId, monthStart, owned),
      this.dailyTotals.getDailyValuesForRange({ userId, start: monthStart }),
      // Today live: Redis for 10-number devices, Mongo (odometer) otherwise.
      Promise.all(
        [...owned].map(async (deviceId) => ({
          deviceId,
          t: await this.redisTotals
            .getDailyTotals(userId, deviceId, todayKey)
            .catch(() => null),
        })),
      ),
    ]);
    let current = this.toRows(currentValues, owned);
    const liveToday = new Map<string, DayRow>();
    for (const { deviceId, t } of live) {
      if (!t) continue;
      liveToday.set(deviceId, {
        deviceId,
        date: todayKey,
        a: Math.max(0, t.totalA || 0),
        a2: Math.max(0, t.totalA2 || 0),
      });
    }
    current = current.filter(
      (r) => !(r.date === todayKey && liveToday.has(r.deviceId)),
    );
    current.push(...liveToday.values());

    // Share group members = one grid line: their grid import counts once.
    const clusters = await this.share
      .gridClusters(userId)
      .catch(() => new Map<string, string>());
    const clusterOf: ClusterOf = (id) => clusters.get(id) ?? id;
    const rows = splitSharedGrid([...past, ...current], clusterOf);
    const flatPrice = this.energyReport.flatPriceFor(mode, flatPriceIn);
    const bill = (kwh: number) => this.energyReport.billFor(kwh, flatPrice);
    const savings = monthlySavings(rows, bill, clusterOf);
    const sum = (filter: (r: DayRow) => boolean) =>
      summarizePeriod(rows.filter(filter), names, savings, clusterOf);

    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const monthRows = rows.filter((r) => r.date.startsWith(ym));
    const dayMap = new Map<string, { a: number; a2: number }>();
    for (const r of monthRows) {
      const d = dayMap.get(r.date) ?? { a: 0, a2: 0 };
      d.a += r.a;
      d.a2 += r.a2;
      dayMap.set(r.date, d);
    }
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
      const d = dayMap.get(date);
      return {
        date,
        generatedKwh: round(d?.a ?? 0),
        gridKwh: round(d?.a2 ?? 0),
      };
    });

    const yearRows = rows.filter((r) => r.date.startsWith(`${year}-`));
    const months = Array.from({ length: 12 }, (_, i) => {
      const p = `${year}-${String(i + 1).padStart(2, '0')}`;
      const s = summarizePeriod(
        yearRows.filter((r) => r.date.startsWith(p)),
        names,
        savings,
        clusterOf,
      );
      return {
        month: i + 1,
        generatedKwh: s.generatedKwh,
        gridKwh: s.gridKwh,
        savings: s.savings,
      };
    });

    const withData = rows.filter((r) => r.a > 0 || r.a2 > 0);
    const since = withData.length
      ? withData.reduce((m, r) => (r.date < m ? r.date : m), withData[0].date)
      : null;

    return {
      generatedAt: new Date().toISOString(),
      devices: [...names].map(([deviceId, name]) => ({ deviceId, name })),
      tariff: this.energyReport.tariffInfo(mode, flatPrice),
      today: { date: todayKey, ...sum((r) => r.date === todayKey) },
      month: {
        year,
        month,
        partial: year === nowY && month === nowM,
        ...summarizePeriod(monthRows, names, savings, clusterOf),
        days,
      },
      year: {
        year,
        ...summarizePeriod(yearRows, names, savings, clusterOf),
        months,
      },
      lifetime: { since, ...sum(() => true) },
    };
  }
}
