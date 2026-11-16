import { repairSchedule, repairScheduleValue } from './utils/schedule-value';

describe('schedule values (8 digits VVVVPPPP)', () => {
  const setting = '23001900'; // 23.00 V / 900 W

  it('keeps valid values', () => {
    expect(repairScheduleValue('23001800', setting)).toBe('23001800');
    expect(repairScheduleValue('23001000', setting)).toBe('23001000'); // 0 W set on purpose
  });

  it('blank volts + blank watts ("01000") -> the setting', () => {
    expect(repairScheduleValue('01000', setting)).toBe('23001900');
  });

  it('blank volts only -> setting volts, watts kept', () => {
    expect(repairScheduleValue('01800', setting)).toBe('23001800');
  });

  it('short volts are padded, garbage -> setting', () => {
    expect(repairScheduleValue('9501800', setting)).toBe('09501800');
    expect(repairScheduleValue('NaN1800', setting)).toBe('23001900');
    expect(repairScheduleValue('', setting)).toBe('23001900');
  });

  it('nothing to fill from: left as is', () => {
    expect(repairScheduleValue('01000', null)).toBeNull();
    expect(repairScheduleValue('01000', '19')).toBeNull();
  });

  it('repairs a whole schedule, keeping times and order', () => {
    const s =
      'start=02:00&end=06:00&value=23001800#start=09:07&end=16:47&value=23001850#start=23:12&end=23:42&value=01000';
    expect(repairSchedule(s, '23001900M')).toEqual({
      schedule:
        'start=02:00&end=06:00&value=23001800#start=09:07&end=16:47&value=23001850#start=23:12&end=23:42&value=23001900',
      fixed: 1,
      invalid: 0,
    });
    expect(repairSchedule(s, null)).toMatchObject({ fixed: 0, invalid: 1 });
    expect(repairSchedule('', setting)).toEqual({
      schedule: '',
      fixed: 0,
      invalid: 0,
    });
  });
});
