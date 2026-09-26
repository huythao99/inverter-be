import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DailyTotalsService } from './daily-totals.service';
import {
  DEFAULT_EVN_TIERS,
  DEFAULT_EVN_VAT_PERCENT,
  DEFAULT_FLAT_PRICE,
  EVN_TARIFF_SOURCE,
  TariffTier,
  billForKwh,
  parseTiers,
} from '../constants/evn-tariff';

export type TariffMode = 'tiered' | 'flat';

export interface MonthEnergy {
  year: number;
  month: number;
  /** Days that have data. */
  days: number;
  /** Energy delivered by the inverter (totalA, "xả"), kWh. */
  generatedKwh: number;
  /** Energy taken from the grid (totalA2, "lấy lưới"), kWh. */
  gridKwh: number;
  /** generated + grid, kWh. */
  consumptionKwh: number;
  /** Share of the consumption covered by the inverter, 0..100. */
  selfSufficiency: number;
  /** Bill for the whole consumption, as if there were no inverter (VND). */
  billWithoutSolar: number;
  /** Bill for the grid energy only (VND). */
  billWithSolar: number;
  /** billWithoutSolar - billWithSolar (VND). */
  savings: number;
}

export interface EnergyReport extends MonthEnergy {
  tariff: {
    mode: TariffMode;
    tiers: TariffTier[];
    flatPrice: number | null;
    vatPercent: number;
    source: string;
  };
  bestDay: { date: string; kwh: number } | null;
  /** Month so far: the report is not final. */
  partial: boolean;
  previousMonth: MonthEnergy;
  sameMonthLastYear: MonthEnergy;
  /** Jan..this month of the report's year. */
  yearToDate: { generatedKwh: number; savings: number; months: number };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Monthly energy report of one inverter: kWh turned into money with the EVN
 * household tariff.
 *
 * Savings = bill(generated + grid) - bill(grid): the tiered tariff makes the
 * last kWh the most expensive ones, so the inverter saves the top tiers.
 * Only the energy measured by this device is counted: it is an estimate of
 * the real bill, not the bill itself.
 */
@Injectable()
export class EnergyReportService {
  private readonly tiers: TariffTier[];
  private readonly vat: number;
  private readonly flatDefault: number;
  private readonly CACHE_MS = 6 * 3600 * 1000;
  private readonly cache = new Map<
    string,
    {
      at: number;
      rows: Array<{ date: string; totalA: number; totalA2: number }>;
    }
  >();

  constructor(
    private readonly dailyTotalsService: DailyTotalsService,
    config: ConfigService,
  ) {
    this.tiers =
      parseTiers(config.get<string>('EVN_TARIFF_TIERS')) ?? DEFAULT_EVN_TIERS;
    const vat = Number(config.get('EVN_VAT_PERCENT'));
    this.vat =
      Number.isFinite(vat) && vat >= 0 && vat <= 20
        ? vat
        : DEFAULT_EVN_VAT_PERCENT;
    const flat = Number(config.get('EVN_FLAT_PRICE'));
    this.flatDefault =
      Number.isFinite(flat) && flat > 0 ? flat : DEFAULT_FLAT_PRICE;
  }

  private nowGmt7() {
    const d = new Date(Date.now() + 7 * 3600 * 1000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }

  private shift(year: number, month: number, delta: number) {
    const idx = year * 12 + (month - 1) + delta;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  }

  async report(
    userId: string,
    deviceId: string,
    yearIn?: number,
    monthIn?: number,
    mode: TariffMode = 'tiered',
    flatPriceIn?: number,
  ): Promise<EnergyReport> {
    const now = this.nowGmt7();
    const year = Number(yearIn) || now.year;
    const month = Number(monthIn) || now.month;
    if (month < 1 || month > 12 || year < 2020 || year > now.year + 1) {
      throw new BadRequestException('Invalid year/month');
    }
    const flatPrice =
      mode === 'flat'
        ? Number(flatPriceIn) > 0 && Number(flatPriceIn) < 20000
          ? Number(flatPriceIn)
          : this.flatDefault
        : null;
    const bill = (kwh: number) =>
      flatPrice !== null
        ? Math.round(kwh * flatPrice * (1 + this.vat / 100))
        : billForKwh(kwh, this.tiers, this.vat);

    const load = async (y: number, m: number) => {
      // Finished months never change: cache them (6 h) so the year-to-date
      // part doesn't re-read up to 11 months on every request.
      const past = y * 12 + m < now.year * 12 + now.month;
      const key = `${userId}/${deviceId}/${y}-${m}`;
      const hit = past ? this.cache.get(key) : undefined;
      if (hit && Date.now() - hit.at < this.CACHE_MS) return hit.rows;
      const rows = await this.dailyTotalsService.getMonthlyChartData(
        userId,
        deviceId,
        y,
        m,
      );
      if (past) {
        if (this.cache.size > 5000) this.cache.clear();
        this.cache.set(key, { at: Date.now(), rows });
      }
      return rows;
    };
    const summarize = (
      y: number,
      m: number,
      rows: Array<{ totalA: number; totalA2: number }>,
    ): MonthEnergy => {
      const gen = rows.reduce((s, r) => s + Math.max(0, r.totalA || 0), 0);
      const grid = rows.reduce((s, r) => s + Math.max(0, r.totalA2 || 0), 0);
      const cons = gen + grid;
      const without = bill(cons);
      const withSolar = bill(grid);
      return {
        year: y,
        month: m,
        days: rows.length,
        generatedKwh: round(gen),
        gridKwh: round(grid),
        consumptionKwh: round(cons),
        selfSufficiency: cons > 0 ? round((gen / cons) * 100, 1) : 0,
        billWithoutSolar: without,
        billWithSolar: withSolar,
        savings: without - withSolar,
      };
    };

    const prev = this.shift(year, month, -1);
    const [cur, prevRows, lastYearRows] = await Promise.all([
      load(year, month),
      load(prev.year, prev.month),
      load(year - 1, month),
    ]);

    // Year to date: the months before this one (current one is `cur`).
    const earlier = await Promise.all(
      Array.from({ length: month - 1 }, (_, i) => load(year, i + 1)),
    );
    const earlierSummaries = earlier.map((rows, i) =>
      summarize(year, i + 1, rows),
    );
    const current = summarize(year, month, cur);
    const ytdList = [...earlierSummaries, current].filter((m) => m.days > 0);

    const best = cur.reduce<{ date: string; kwh: number } | null>(
      (b, r) =>
        (r.totalA || 0) > (b?.kwh ?? 0)
          ? { date: r.date.slice(0, 10), kwh: round(r.totalA) }
          : b,
      null,
    );

    return {
      ...current,
      tariff: {
        mode,
        tiers: this.tiers,
        flatPrice,
        vatPercent: this.vat,
        source:
          mode === 'flat' ? 'Giá điện công tơ trả trước' : EVN_TARIFF_SOURCE,
      },
      bestDay: best,
      partial: year === now.year && month === now.month,
      previousMonth: summarize(prev.year, prev.month, prevRows),
      sameMonthLastYear: summarize(year - 1, month, lastYearRows),
      yearToDate: {
        generatedKwh: round(ytdList.reduce((s, m) => s + m.generatedKwh, 0)),
        savings: ytdList.reduce((s, m) => s + m.savings, 0),
        months: ytdList.length,
      },
    };
  }
}
