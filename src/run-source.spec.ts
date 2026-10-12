import {
  decodeValue,
  expectedSource,
  isTimeInRange,
  parseSchedule,
  parseSourceLog,
  stmMatches,
  stmValueOf,
  utcToVn,
} from './utils/run-source';

const at = (utc: string) => new Date(`2026-10-12T${utc}:00Z`);
const base = {
  setting: '50001800',
  schedule: null as string | null,
  gridTieOff: false,
  blacklisted: false,
  share: { enabled: false, computedW: null as number | null },
};

describe('run-source', () => {
  it('decodes VVVVPPPP', () => {
    expect(decodeValue('52001800')).toEqual({ cutoffV: 52, limitW: 800 });
    expect(decodeValue('5200180')).toBeNull();
  });

  it('converts UTC slot times to Vietnam time (end >= 24 = next day)', () => {
    expect(utcToVn('00:00')).toBe('07:00');
    expect(utcToVn('17:30')).toBe('00:30');
    expect(utcToVn('27:00')).toBe('10:00');
  });

  it('mirrors the firmware time window check', () => {
    expect(isTimeInRange(10 * 60, '01:00', '10:00')).toBe(true);
    expect(isTimeInRange(10 * 60 + 1, '01:00', '10:00')).toBe(false);
    // spans midnight: 20:00 -> 27:00 (03:00)
    expect(isTimeInRange(23 * 60, '20:00', '27:00')).toBe(true);
    expect(isTimeInRange(2 * 60, '20:00', '27:00')).toBe(true);
    expect(isTimeInRange(4 * 60, '20:00', '27:00')).toBe(false);
  });

  it('picks the first matching slot; the setting otherwise', () => {
    const schedule =
      'start=01:00&end=05:00&value=52001500#start=04:00&end=09:00&value=53002000';
    const s1 = parseSchedule(schedule, at('04:30'));
    expect(s1.map((s) => s.active)).toEqual([true, false]);
    expect(s1[0].startVn).toBe('08:00');
    expect(
      expectedSource({ ...base, now: at('04:30'), schedule }, s1),
    ).toMatchObject({
      source: 'schedule',
      slot: 1,
      value: { cutoffV: 52, limitW: 500 },
    });

    const s2 = parseSchedule(schedule, at('12:00'));
    expect(
      expectedSource({ ...base, now: at('12:00'), schedule }, s2),
    ).toMatchObject({ source: 'setting', value: { cutoffV: 50, limitW: 800 } });
  });

  it('grid-tie OFF and share win over the schedule', () => {
    const schedule = 'start=00:00&end=23:59&value=52001500';
    const slots = parseSchedule(schedule, at('06:00'));
    expect(
      expectedSource(
        { ...base, now: at('06:00'), schedule, gridTieOff: true },
        slots,
      ).source,
    ).toBe('gridtie');
    expect(
      expectedSource(
        {
          ...base,
          now: at('06:00'),
          schedule,
          share: { enabled: true, computedW: 350 },
        },
        slots,
      ),
    ).toMatchObject({ source: 'share', value: { cutoffV: 50, limitW: 350 } });
  });

  it('a matching slot with a bad value falls back to the setting', () => {
    const schedule = 'start=00:00&end=23:59&value=abc';
    const slots = parseSchedule(schedule, at('06:00'));
    const e = expectedSource({ ...base, now: at('06:00'), schedule }, slots);
    expect(e.source).toBe('setting');
    expect(e.note).toContain('#1');
  });

  it('flags the empty 00:00-00:00 slot that still matches 00:00 UTC', () => {
    const schedule = 'start=00:00&end=00:00&value=99001001';
    const slots = parseSchedule(schedule, at('00:00'));
    expect(slots[0]).toMatchObject({ placeholder: true, active: true });
    expect(parseSchedule(schedule, at('00:01'))[0].active).toBe(false);
  });

  it('reads the STM32 value and matches candidates', () => {
    const stm = stmValueOf('239.9#50.0#12#52.7#300#30#52.00#797.00')!;
    expect(stm).toEqual({ cutoffV: 52, limitW: 797 });
    expect(
      stmMatches(stm, [
        { key: 'setting', value: { cutoffV: 50, limitW: 800 } },
        { key: 'schedule#1', value: { cutoffV: 52, limitW: 800 } },
      ]),
    ).toEqual(['schedule#1']);
    // legacy board clamps to 1200 W
    expect(
      stmMatches(
        { cutoffV: 52, limitW: 1200 },
        [{ key: 'setting', value: { cutoffV: 52, limitW: 2000 } }],
        true,
      ),
    ).toEqual(['setting']);
  });

  it('parses the SOURCE_CHANGE log', () => {
    expect(parseSourceLog('source=schedule value=*5200@1800#')).toEqual({
      source: 'schedule',
      value: '*5200@1800#',
    });
    expect(parseSourceLog('nothing')).toBeNull();
  });
});
