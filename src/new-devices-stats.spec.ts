import { bucketNewDevices, periodStart } from './services/cms.service';

// GMT+7 calendar: 2026-10-28 is a Wednesday.
const at = (s: string) => new Date(`${s}+07:00`);

describe('new devices per week / month', () => {
  it('week starts on Monday 00:00 GMT+7', () => {
    expect(periodStart(at('2026-10-28T10:00:00'), 'week').toISOString()).toBe(
      at('2026-10-26T00:00:00').toISOString(),
    );
    // Sunday late evening still belongs to the week of the Monday before.
    expect(periodStart(at('2026-10-25T23:30:00'), 'week').toISOString()).toBe(
      at('2026-10-19T00:00:00').toISOString(),
    );
    expect(periodStart(at('2026-10-01T00:10:00'), 'month').toISOString()).toBe(
      at('2026-10-01T00:00:00').toISOString(),
    );
  });

  it('counts per product, oldest first, empty buckets kept', () => {
    const now = at('2026-10-28T10:00:00');
    const b = bucketNewDevices(
      {
        inverter: [
          at('2026-10-27T08:00:00'),
          at('2026-10-20T08:00:00'),
          at('2026-01-01T08:00:00'),
        ],
        charger: [at('2026-10-26T00:00:00')],
        hybrid: [at('2026-10-25T23:59:00')],
      },
      'week',
      3,
      now,
    );
    expect(b.map((x) => x.start)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(b.map((x) => x.label)).toEqual(['12/10', '19/10', '26/10']);
    expect(b[0].total).toBe(0);
    expect(b[1]).toMatchObject({
      inverter: 1,
      charger: 0,
      hybrid: 1,
      total: 2,
    });
    expect(b[2]).toMatchObject({
      inverter: 1,
      charger: 1,
      hybrid: 0,
      total: 2,
    });
  });

  it('months across a year boundary', () => {
    const b = bucketNewDevices(
      {
        inverter: [at('2025-12-31T23:00:00'), at('2026-01-01T01:00:00')],
        charger: [],
        hybrid: [],
      },
      'month',
      3,
      at('2026-02-10T10:00:00'),
    );
    expect(b.map((x) => x.label)).toEqual(['12/2025', '01/2026', '02/2026']);
    expect(b.map((x) => x.inverter)).toEqual([1, 1, 0]);
  });
});
