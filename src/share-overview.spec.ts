/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { NotFoundException } from '@nestjs/common';
import {
  parseLive,
  periodStarts,
  ShareOverviewService,
} from './services/share-overview.service';

const GMT7 = 7 * 3600 * 1000;
const todayKey = () => new Date(Date.now() + GMT7).toISOString().slice(0, 10);
// Stored day = GMT+7 midnight.
const dayDate = (key: string) =>
  new Date(Date.parse(`${key}T00:00:00Z`) - GMT7);

describe('share group overview', () => {
  it('parses the live frame fields', () => {
    expect(parseLive('$230#50#-120#51.2#940#41#46.5#1000#2500#800')).toEqual({
      gridPower: -120,
      batteryVoltage: 51.2,
      gridTiePower: 940,
      temperature: 41,
      cutoffVoltage: 46.5,
      powerLimit: 1000,
    });
    expect(parseLive(null)).toBeNull();
    expect(parseLive('1#2#3')).toBeNull();
  });

  it('week starts on Monday, month on the 1st', () => {
    expect(periodStarts('2026-10-04')).toEqual({
      week: '2026-09-28', // Sunday -> previous Monday
      month: '2026-10-01',
    });
    expect(periodStarts('2026-10-05')).toEqual({
      week: '2026-10-05', // Monday
      month: '2026-10-01',
    });
  });

  function setup(live: unknown, pastRows: unknown[] = []) {
    const share = { groupLive: () => Promise.resolve(live) };
    const redisTotals = {
      getDailyTotals: (_u: string, d: string) =>
        Promise.resolve(d === 'A' ? { totalA: 3.456, totalA2: 1 } : null),
    };
    const devices = {
      findByUserId: () =>
        Promise.resolve([{ deviceId: 'A', deviceName: 'Nhà trên' }]),
    };
    const dailyTotals = {
      getDailyValuesForRange: () => Promise.resolve(pastRows),
    };
    return new ShareOverviewService(
      share as any,
      redisTotals as any,
      devices as any,
      dailyTotals as any,
    );
  }

  it('members with names, ratio %, online, assigned, today + totals', async () => {
    const svc = setup({
      group: { name: 'Nhóm 1', enabled: true },
      poolWatts: 1500,
      members: [
        {
          deviceId: 'A',
          ratio: 2,
          value: '230#50#200#51#1000#40#48#2000',
          gridTieOff: false,
          assignedWatts: 1000,
        },
        {
          deviceId: 'B',
          ratio: 1,
          value: null,
          gridTieOff: false,
          assignedWatts: null,
        },
      ],
    });
    const o = await svc.overview('u', 'g');
    expect(o.members[0]).toMatchObject({
      name: 'Nhà trên',
      ratioPercent: 66.7,
      online: true,
      assignedWatts: 1000,
      today: { generatedKwh: 3.46, gridKwh: 1 },
    });
    expect(o.members[1]).toMatchObject({
      name: 'B',
      online: false,
      live: null,
    });
    expect(o.totals).toMatchObject({
      gridTiePower: 1000,
      gridPower: 200,
      assignedWatts: 1000,
      online: 1,
      todayGeneratedKwh: 3.46,
      todayGridKwh: 1,
    });
  });

  it('week / month = past days (Mongo) + today (live)', async () => {
    const today = todayKey();
    const { week, month } = periodStarts(today);
    const from = week < month ? week : month;
    const rows = [
      { deviceId: 'A', date: dayDate(from), totalA: 2, totalA2: 0.5 },
      { deviceId: 'A', date: dayDate(today), totalA: 99, totalA2: 99 }, // live wins
      { deviceId: 'Z', date: dayDate(from), totalA: 50, totalA2: 0 }, // not a member
    ];
    const svc = setup(
      {
        group: { name: 'N', enabled: true },
        poolWatts: 0,
        members: [
          {
            deviceId: 'A',
            ratio: 1,
            value: null,
            gridTieOff: false,
            assignedWatts: null,
          },
        ],
      },
      rows,
    );
    const o = await svc.overview('u', 'g');
    const a = o.members[0];
    const inWeek = from >= week && from < today;
    const inMonth = from >= month && from < today;
    expect(a.week.generatedKwh).toBeCloseTo(3.456 + (inWeek ? 2 : 0), 2);
    expect(a.month.generatedKwh).toBeCloseTo(3.456 + (inMonth ? 2 : 0), 2);
    expect(o.weekStart).toBe(week);
    expect(o.monthStart).toBe(month);
  });

  it("404 for a group that is not the user's", async () => {
    await expect(setup(null).overview('u', 'g')).rejects.toThrow(
      NotFoundException,
    );
  });
});
