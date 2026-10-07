/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  DayRow,
  EnergyOverviewService,
  gmt7DateKey,
  monthlySavings,
  splitSharedGrid,
  summarizePeriod,
} from './services/energy-overview.service';

// 2 VND per kWh up to 100 kWh, 4 VND above: savings depend on the month total.
const bill = (kwh: number) =>
  Math.round(Math.min(kwh, 100) * 2 + Math.max(0, kwh - 100) * 4);

const names = new Map([
  ['A', 'Máy A'],
  ['B', 'Máy B'],
]);

describe('energy overview', () => {
  it('GMT+7 day key (stored dates are GMT+7 midnight = 17:00Z)', () => {
    expect(gmt7DateKey(new Date('2026-09-30T17:00:00Z'))).toBe('2026-10-01');
    expect(gmt7DateKey(new Date('2026-10-01T16:59:59Z'))).toBe('2026-10-01');
  });

  it('sums devices, share and savings per device-month', () => {
    const rows: DayRow[] = [
      { deviceId: 'A', date: '2026-10-01', a: 30, a2: 50 },
      { deviceId: 'A', date: '2026-10-02', a: 30, a2: 50 },
      { deviceId: 'B', date: '2026-10-01', a: 20, a2: 0 },
    ];
    const sav = monthlySavings(rows, bill);
    // A: bill(160) - bill(100) = 440 - 200 = 240 ; B: bill(20) - 0 = 40
    expect(sav.get('A|2026-10')!.savings).toBe(240);
    expect(sav.get('B|2026-10')!.savings).toBe(40);

    const p = summarizePeriod(rows, names, sav);
    expect(p.generatedKwh).toBe(80);
    expect(p.gridKwh).toBe(100);
    expect(p.savings).toBe(280);
    expect(p.selfSufficiency).toBeCloseTo(44.4, 1);
    expect(p.devices.map((d) => [d.deviceId, d.sharePercent])).toEqual([
      ['A', 75],
      ['B', 25],
    ]);

    // One day of the month: its share of the month's savings.
    const day = summarizePeriod(
      rows.filter((r) => r.date === '2026-10-02'),
      names,
      sav,
    );
    expect(day.savings).toBe(120);
    // Device without data in the period still listed, with 0.
    expect(day.devices.find((d) => d.deviceId === 'B')!.generatedKwh).toBe(0);
  });

  it('owned devices only, today taken live, past months cached', async () => {
    const todayKey = gmt7DateKey(new Date());
    const [y, m] = todayKey.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1) - 7 * 3600 * 1000);
    const todayStart = new Date(
      Date.parse(`${todayKey}T00:00:00Z`) - 7 * 3600 * 1000,
    );
    const prevDay = new Date(monthStart.getTime() - 24 * 3600 * 1000);
    let pastCalls = 0;
    const dailyTotals = {
      getDailyValuesForRange: (o: { start?: Date; end?: Date }) => {
        if (o.end) {
          pastCalls++;
          return Promise.resolve([
            { deviceId: 'A', date: prevDay, totalA: 5, totalA2: 1 },
            { deviceId: 'SHARED', date: prevDay, totalA: 99, totalA2: 0 },
          ]);
        }
        return Promise.resolve([
          // stale Mongo value for today, replaced by the live one
          { deviceId: 'A', date: todayStart, totalA: 1, totalA2: 1 },
          { deviceId: 'B', date: todayStart, totalA: -3, totalA2: 2 },
        ]);
      },
    };
    const redisTotals = {
      getDailyTotals: (_u: string, d: string) =>
        Promise.resolve(d === 'A' ? { totalA: 4, totalA2: 2 } : null),
    };
    const devices = {
      findByUserId: () =>
        Promise.resolve([
          { deviceId: 'A', deviceName: 'Máy A' },
          { deviceId: 'B', deviceName: '' },
        ]),
    };
    const energyReport = {
      flatPriceFor: () => null,
      billFor: (kwh: number) => bill(kwh),
      tariffInfo: () => ({ mode: 'tiered' }),
    };
    const svc = new EnergyOverviewService(
      dailyTotals as any,
      redisTotals as any,
      devices as any,
      energyReport as any,
      { gridClusters: () => Promise.resolve(new Map()) } as any,
    );

    const o = await svc.overview('u');
    expect(o.devices).toEqual([
      { deviceId: 'A', name: 'Máy A' },
      { deviceId: 'B', name: 'B' },
    ]);
    expect(o.today.generatedKwh).toBe(4); // live A=4, B negative -> 0
    expect(o.today.gridKwh).toBe(4); // A 2 + B 2
    expect(o.lifetime.generatedKwh).toBe(9); // + A 5 last month, SHARED ignored
    expect(o.lifetime.since).toBe(gmt7DateKey(prevDay));
    expect(o.month.days.find((d) => d.date === todayKey)!.generatedKwh).toBe(4);
    expect(o.year.months).toHaveLength(12);

    await svc.overview('u');
    expect(pastCalls).toBe(1);
  });

  it('share group = one grid line: import counted once', () => {
    // A and B measure the same import (4 kWh each); C is on its own line.
    const rows: DayRow[] = [
      { deviceId: 'A', date: '2026-10-01', a: 1, a2: 4 },
      { deviceId: 'B', date: '2026-10-01', a: 3, a2: 4.2 },
      { deviceId: 'C', date: '2026-10-01', a: 2, a2: 5 },
      // B offline the next day: A alone, nothing to average
      { deviceId: 'A', date: '2026-10-02', a: 1, a2: 3 },
      { deviceId: 'B', date: '2026-10-02', a: 0, a2: 0 },
    ];
    const clusterOf = (id: string) => (id === 'C' ? 'C' : 'grid:A');
    const fixed = splitSharedGrid(rows, clusterOf);
    const names3 = new Map([...names, ['C', 'Máy C']]);
    const sav = monthlySavings(fixed, bill, clusterOf);
    const p = summarizePeriod(fixed, names3, sav, clusterOf);
    // grid: avg(4, 4.2) = 4.1 + 3 (day 2) + C 5
    expect(p.gridKwh).toBe(12.1);
    expect(p.generatedKwh).toBe(7);
    // A+B billed as one meter: bill(5 + 7.1) - bill(7.1) = 10, split by output
    expect(sav.get('grid:A|2026-10')!.savings).toBe(10);
    const by = new Map(p.devices.map((d) => [d.deviceId, d]));
    expect(by.get('A')!.savings + by.get('B')!.savings).toBe(10);
    expect(by.get('B')!.savings).toBe(6); // 3 of the 5 kWh
    // Without clusters (old behaviour) the import was 4 + 4.2 + 3 + 5
    expect(
      summarizePeriod(rows, names3, monthlySavings(rows, bill)).gridKwh,
    ).toBe(16.2);
  });

  it('rejects an invalid month', async () => {
    const svc = new EnergyOverviewService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(svc.overview('u', 2026, 13)).rejects.toThrow();
  });
});
