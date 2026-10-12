import { odometerDayEnergies } from './utils/odometer';

const r = (xs: number[]) => xs.map((x) => Math.round(x * 1000) / 1000);

describe('odometerDayEnergies', () => {
  it('normal days: end - previous end', () => {
    expect(
      r(
        odometerDayEnergies(
          [
            { max: 131.204, start: 122.928, last: 131.204 },
            { max: 135, start: 131.3, last: 135 },
          ],
          { max: 122.9, last: 122.9 },
        ),
      ),
    ).toEqual([8.304, 3.796]);
  });

  it('GTIControl1125 10-12/10: reset on 11/10, old records without lastA', () => {
    const days = [
      { max: 131.204, start: 122.928, last: null }, // 10/10
      { max: 131.554, start: 0, last: null }, // 11/10: reset in the evening
      { max: 7.048, start: 5.105, last: null }, // 12/10
    ];
    expect(r(odometerDayEnergies(days, { max: 122.928, last: null }))).toEqual([
      8.276, // 131.204 - 122.928
      5.455, // (131.554 - 131.204) + 5.105 (end of 11/10 = first of 12/10)
      1.943, // 7.048 - 5.105, no longer 7.048
    ]);
  });

  it('only today queried: previous day end recovered from today first reading', () => {
    expect(
      r(
        odometerDayEnergies([{ max: 7.048, start: 5.105, last: null }], {
          max: 131.554,
          last: null,
        }),
      ),
    ).toEqual([1.943]);
  });

  it('reset during the day with lastA: pre-reset part + post-reset part', () => {
    expect(
      r(
        odometerDayEnergies([{ max: 131.554, start: 0, last: 5.105 }], {
          max: 131.204,
          last: 131.204,
        }),
      ),
    ).toEqual([5.455]);
  });

  it('reset between two days (offline overnight): counted from 0', () => {
    expect(
      r(
        odometerDayEnergies([{ max: 2.5, start: 0.4, last: 2.5 }], {
          max: 100,
          last: 100,
        }),
      ),
    ).toEqual([2.5]);
  });

  it('a stray 0 frame or out-of-order last is not a reset', () => {
    expect(
      r(
        odometerDayEnergies([{ max: 140, start: 0, last: 139.99 }], {
          max: 131,
          last: 131,
        }),
      ),
    ).toEqual([8.99]);
    // last slightly below the previous end: 0, not the whole counter
    expect(
      r(
        odometerDayEnergies([{ max: 131, start: 130.99, last: 130.99 }], {
          max: 131,
          last: 131,
        }),
      ),
    ).toEqual([0]);
  });

  it('first day online: against the first reading seen', () => {
    expect(
      r(odometerDayEnergies([{ max: 50, start: 48, last: 50 }], null)),
    ).toEqual([2]);
  });
});
