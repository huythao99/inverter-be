import { Injectable, NotFoundException } from '@nestjs/common';
import { ShareService } from './share.service';
import { RedisDailyTotalsService } from './redis-daily-totals.service';
import { InverterDeviceService } from './inverter-device.service';
import { DailyTotalsService } from './daily-totals.service';

const GMT7_MS = 7 * 3600 * 1000;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export interface ShareMemberLive {
  /** Grid power (W, field 3). */
  gridPower: number | null;
  /** Battery voltage (V, field 4). */
  batteryVoltage: number | null;
  /** Grid-tie output = discharge (W, field 5). */
  gridTiePower: number | null;
  /** MOSFET temperature (°C, field 6). */
  temperature: number | null;
  /** Cut-off voltage the device runs with (V, field 7). */
  cutoffVoltage: number | null;
  /** Power limit the device runs with (W, field 8). */
  powerLimit: number | null;
}

export interface ShareOverviewMember {
  deviceId: string;
  name: string;
  ratio: number;
  /** Ratio as a share of the group, 0..100. */
  ratioPercent: number;
  online: boolean;
  gridTieOff: boolean;
  /** Watts the group gives this member right now; null = not sharing. */
  assignedWatts: number | null;
  live: ShareMemberLive | null;
  today: { generatedKwh: number; gridKwh: number };
  /** Since Monday (GMT+7), today included. */
  week: { generatedKwh: number; gridKwh: number };
  /** Since the 1st of the month (GMT+7), today included. */
  month: { generatedKwh: number; gridKwh: number };
}

export interface ShareOverview {
  groupId: string;
  name: string;
  enabled: boolean;
  generatedAt: string;
  /** Consumption pooled by the active members (W). */
  poolWatts: number;
  totals: {
    gridTiePower: number;
    gridPower: number;
    assignedWatts: number;
    online: number;
    todayGeneratedKwh: number;
    todayGridKwh: number;
    weekGeneratedKwh: number;
    weekGridKwh: number;
    monthGeneratedKwh: number;
    monthGridKwh: number;
  };
  /** First day of the week / month periods, YYYY-MM-DD (GMT+7). */
  weekStart: string;
  monthStart: string;
  members: ShareOverviewMember[];
}

/** Monday of the week and 1st of the month containing `day` (YYYY-MM-DD). */
export function periodStarts(day: string): { week: string; month: string } {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  const week = new Date(d.getTime() - back * 86400000)
    .toISOString()
    .slice(0, 10);
  return { week, month: `${day.slice(0, 7)}-01` };
}

export function parseLive(value: string | null): ShareMemberLive | null {
  if (!value) return null;
  const p = value.replace(/\$/g, '').split('#');
  if (p.length < 8) return null;
  const n = (i: number) => {
    const v = parseFloat(p[i]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    gridPower: n(2),
    batteryVoltage: n(3),
    gridTiePower: n(4),
    temperature: n(5),
    cutoffVoltage: n(6),
    powerLimit: n(7),
  };
}

/**
 * Everything about one share group on a single screen: each member's live
 * frame, the watts the group assigns it and its energy today.
 */
@Injectable()
export class ShareOverviewService {
  constructor(
    private readonly share: ShareService,
    private readonly redisTotals: RedisDailyTotalsService,
    private readonly devices: InverterDeviceService,
    private readonly dailyTotals: DailyTotalsService,
  ) {}

  /**
   * kWh per member for the days before today, from `from` (YYYY-MM-DD,
   * GMT+7): deviceId -> date -> totals. Today comes live from Redis instead.
   */
  private async pastDays(
    userId: string,
    deviceIds: Set<string>,
    from: string,
    today: string,
  ): Promise<Map<string, Map<string, { a: number; a2: number }>>> {
    const out = new Map<string, Map<string, { a: number; a2: number }>>();
    if (from >= today) return out;
    const start = new Date(Date.parse(`${from}T00:00:00Z`) - GMT7_MS);
    const end = new Date(Date.parse(`${today}T00:00:00Z`) - GMT7_MS - 1);
    const rows = await this.dailyTotals
      .getDailyValuesForRange({ userId, start, end })
      .catch(() => []);
    for (const r of rows) {
      if (!deviceIds.has(r.deviceId)) continue;
      const date = new Date(new Date(r.date).getTime() + GMT7_MS)
        .toISOString()
        .slice(0, 10);
      if (date < from || date >= today) continue;
      const byDay =
        out.get(r.deviceId) ?? new Map<string, { a: number; a2: number }>();
      const d = byDay.get(date) ?? { a: 0, a2: 0 };
      // A negative day (odometer reset) counts as 0, as in the reports.
      d.a += Math.max(0, Number(r.totalA) || 0);
      d.a2 += Math.max(0, Number(r.totalA2) || 0);
      byDay.set(date, d);
      out.set(r.deviceId, byDay);
    }
    return out;
  }

  async overview(userId: string, groupId: string): Promise<ShareOverview> {
    const live = await this.share.groupLive(userId, groupId);
    if (!live) throw new NotFoundException('Share group not found');
    const today = new Date(Date.now() + GMT7_MS).toISOString().slice(0, 10);

    const owned = await this.devices.findByUserId(userId);
    const names = new Map(owned.map((d) => [d.deviceId, d.deviceName]));
    const ratioSum = live.members.reduce((s, m) => s + (m.ratio || 0), 0);
    const starts = periodStarts(today);
    const from = starts.week < starts.month ? starts.week : starts.month;
    const past = await this.pastDays(
      userId,
      new Set(live.members.map((m) => m.deviceId)),
      from,
      today,
    );

    const members: ShareOverviewMember[] = await Promise.all(
      live.members.map(async (m) => {
        const t = await this.redisTotals
          .getDailyTotals(userId, m.deviceId, today)
          .catch(() => null);
        const frame = parseLive(m.value);
        const ta = Math.max(0, t?.totalA ?? 0);
        const ta2 = Math.max(0, t?.totalA2 ?? 0);
        const since = (start: string) => {
          let a = ta;
          let a2 = ta2;
          for (const [date, v] of past.get(m.deviceId) ?? []) {
            if (date >= start) {
              a += v.a;
              a2 += v.a2;
            }
          }
          return { generatedKwh: round(a), gridKwh: round(a2) };
        };
        return {
          deviceId: m.deviceId,
          name: names.get(m.deviceId) || m.deviceId,
          ratio: m.ratio,
          ratioPercent: ratioSum > 0 ? round((m.ratio / ratioSum) * 100, 1) : 0,
          online: !!frame,
          gridTieOff: m.gridTieOff,
          assignedWatts: m.assignedWatts,
          live: frame,
          today: { generatedKwh: round(ta), gridKwh: round(ta2) },
          week: since(starts.week),
          month: since(starts.month),
        };
      }),
    );

    const sum = (f: (m: ShareOverviewMember) => number) =>
      members.reduce((s, m) => s + f(m), 0);
    // The members share one grid line and all measure the same import: it
    // counts once, as the average of the members that measured something.
    const mean = (v: number[]) =>
      v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
    const avg = (f: (m: ShareOverviewMember) => number | null | undefined) =>
      mean(
        members
          .map(f)
          .filter((x): x is number => typeof x === 'number' && x !== 0),
      );
    // Grid kWh since a day: averaged per DAY (a member that was offline or
    // not yet in the group on some days does not pull the others down).
    const gridSince = (start: string) => {
      const byDate = new Map<string, number[]>();
      for (const [, days] of past) {
        for (const [date, v] of days) {
          if (date < start || !(v.a2 > 0)) continue;
          byDate.set(date, [...(byDate.get(date) ?? []), v.a2]);
        }
      }
      let total = avg((m) => m.today.gridKwh);
      for (const v of byDate.values()) total += mean(v);
      return total;
    };
    return {
      groupId,
      name: live.group.name ?? '',
      enabled: !!live.group.enabled,
      generatedAt: new Date().toISOString(),
      poolWatts: live.poolWatts,
      totals: {
        gridTiePower: Math.round(sum((m) => m.live?.gridTiePower ?? 0)),
        gridPower: Math.round(avg((m) => m.live?.gridPower)),
        assignedWatts: Math.round(sum((m) => m.assignedWatts ?? 0)),
        online: members.filter((m) => m.online).length,
        todayGeneratedKwh: round(sum((m) => m.today.generatedKwh)),
        todayGridKwh: round(avg((m) => m.today.gridKwh)),
        weekGeneratedKwh: round(sum((m) => m.week.generatedKwh)),
        weekGridKwh: round(gridSince(starts.week)),
        monthGeneratedKwh: round(sum((m) => m.month.generatedKwh)),
        monthGridKwh: round(gridSince(starts.month)),
      },
      weekStart: starts.week,
      monthStart: starts.month,
      members,
    };
  }
}
