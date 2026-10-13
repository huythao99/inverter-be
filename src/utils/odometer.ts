/**
 * Daily energy from STM32 odometer readings (12/13-number frames).
 *
 * Per GMT+7 day the DB keeps, for each counter: the max reading, the first
 * (min) reading and - since lastA/lastA2 exist - the latest reading. The
 * counter is cumulative but restarts from 0 when the STM32 reboots (power
 * loss, STM firmware update...). A day's energy:
 *   - no reset:                     end - previous day's end
 *   - reset during the day:         (max - previous end) + end   (the counter
 *                                   ran up to max, restarted at 0, reached end)
 *   - reset between two days:       end (counted from 0)
 * The end of a day is its latest reading; old records without it use the
 * next day's first reading when the whole next day stays below this day's
 * max (the reset happened that evening/night), else the max.
 *
 * Small drops (frames arriving out of order) are not resets: a reset must
 * drop the counter by more than RESET_DROP_KWH.
 */
export const RESET_DROP_KWH = 0.05;

export interface OdoDay {
  /** Highest reading of the day (kWh). */
  max: number;
  /** First (lowest) reading of the day, null on legacy records. */
  start: number | null;
  /** Latest reading of the day, null on records written before it existed. */
  last: number | null;
}

export interface OdoPrev {
  max: number;
  last: number | null;
}

const dropped = (from: number, to: number) => from - to > RESET_DROP_KWH;

export interface OdoDayResult {
  /** Energy of the day (kWh). */
  value: number;
  /**
   * The day's lowest reading is below the previous day's end: the counter
   * went back (STM32 restart restoring an older saved value, or a reset)
   * somewhere in the day, even if it climbed above the previous end again.
   */
  startDrop: boolean;
}

/**
 * Same as odometerDayEnergies, with per-day details. `rollback[i]` = trust a
 * start drop of day i as a real counter rollback (the caller checks that BOTH
 * counters dropped, so one corrupted frame is not enough): the day then
 * counts at least end - lowest reading, the energy since the rollback (the
 * plain end - previous end would miss what was lost by going back).
 */
export function odometerDayDetails(
  days: OdoDay[],
  prev: OdoPrev | null,
  rollback?: boolean[],
): OdoDayResult[] {
  const endOf = (i: number): number => {
    const d = days[i];
    if (d.last !== null && isFinite(d.last)) return d.last;
    const next = days[i + 1];
    // Next day entirely below this max: the counter restarted after this
    // day's max, so the next day's first reading is this day's end. (If the
    // next day climbed above it, the restart happened during the next day
    // and its min - which is all `start` is - says nothing about today.)
    if (next && next.start !== null && dropped(d.max, next.max)) {
      return next.start;
    }
    return d.max;
  };

  let p: number | null = null;
  if (prev) {
    if (prev.last !== null && isFinite(prev.last)) p = prev.last;
    else if (days[0]?.start != null && dropped(prev.max, days[0].max)) {
      p = days[0].start;
    } else p = prev.max;
  }

  const out: OdoDayResult[] = [];
  for (let i = 0; i < days.length; i++) {
    const { max: m, start: s } = days[i];
    const e = endOf(i);
    const startDrop = p !== null && s !== null && dropped(p, s);
    let v: number;
    if (dropped(m, e)) {
      // Reset during the day.
      // Without a previous reading the pre-reset part has no baseline (its
      // first reading is hidden by the min): count the post-reset part only.
      v = (p !== null ? Math.max(m - p, 0) : 0) + e;
    } else if (p === null) {
      // First day online: against the first reading seen that day.
      v = s !== null && e >= s ? e - s : e;
    } else if (!dropped(p, e)) {
      v = Math.max(e - p, 0);
      // Went back below the previous end and climbed above it again: at
      // least the climb from the lowest reading was produced today.
      if (startDrop && rollback?.[i] && s !== null && e >= s) {
        v = Math.max(v, e - s);
      }
    } else {
      // Reset between the previous reading and this day's readings.
      v = e;
    }
    out.push({ value: round6(v), startDrop });
    p = e;
  }
  return out;
}

/** Energy of each day (same order as `days`, oldest first). */
export function odometerDayEnergies(
  days: OdoDay[],
  prev: OdoPrev | null,
  rollback?: boolean[],
): number[] {
  return odometerDayDetails(days, prev, rollback).map((r) => r.value);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
