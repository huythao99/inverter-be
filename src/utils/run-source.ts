/**
 * What an inverter is running right now: lock / grid-tie OFF / share /
 * schedule slot / setting. Mirrors the ESP32 firmware (logic.cpp
 * applyCurrentValue + parseScheduleData + isTimeInRange) so the CMS can show
 * which value the device should be on, and compares it with what the STM32
 * reports in telemetry fields 7/8 (cut-off V / limit W).
 *
 * Values are "VVVVPPPP": cut-off VV.VV V, limit PPPP - 1000 W.
 * Schedule times are stored in UTC (the app subtracts 7 h); an end >= 24:00
 * means "next day" (e.g. 27:00 = 03:00). The device clock runs in UTC.
 */

export const VN_OFFSET_MIN = 7 * 60;
/** Firmware keeps at most this many schedule slots. */
export const MAX_SLOTS = 10;

export type RunSource =
  | 'lock'
  | 'gridtie'
  | 'share'
  | 'schedule'
  | 'setting'
  | 'none';

export interface DecodedValue {
  cutoffV: number;
  limitW: number;
}

export interface ScheduleSlot {
  index: number;
  raw: string;
  startUtc: string;
  endUtc: string;
  startVn: string;
  endVn: string;
  value: string;
  decoded: DecodedValue | null;
  /** App's empty slot: 00:00-00:00 (still matches minute 00:00 UTC on the device). */
  placeholder: boolean;
  /** First slot whose window contains "now" (the firmware stops at it). */
  active: boolean;
}

/** "52001800" -> 52.00 V / 800 W. null when not 8 digits. */
export function decodeValue(v: string | null | undefined): DecodedValue | null {
  const s = String(v ?? '').trim();
  if (!/^\d{8}$/.test(s)) return null;
  return {
    cutoffV: Number(s.slice(0, 4)) / 100,
    limitW: Number(s.slice(4, 8)) - 1000,
  };
}

function hm(t: string): { h: number; m: number } {
  const h = parseInt(t.slice(0, 2), 10);
  const m = parseInt(t.slice(3, 5), 10);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC "HH:MM" (hour may be >= 24) -> Vietnam "HH:MM". */
export function utcToVn(t: string): string {
  if (!t) return '';
  const { h, m } = hm(t);
  return `${pad((((h + 7) % 24) + 24) % 24)}:${pad(m)}`;
}

/** Same as the firmware's isTimeInRange (minutes of the UTC day). */
export function isTimeInRange(
  nowMin: number,
  startTime: string,
  endTime: string,
): boolean {
  const s = hm(startTime);
  const e = hm(endTime);
  const startMin = s.h * 60 + s.m;
  const endMin = (e.h >= 24 ? e.h - 24 : e.h) * 60 + e.m;
  if (endMin < startMin) return nowMin >= startMin || nowMin <= endMin;
  return nowMin >= startMin && nowMin <= endMin;
}

/** Same splitting as the firmware's parseScheduleData ("#"-separated slots). */
export function parseSchedule(
  schedule: string | null | undefined,
  now: Date,
): ScheduleSlot[] {
  const data = String(schedule ?? '');
  if (!data || data === 'null') return [];
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slots: ScheduleSlot[] = [];
  let activeFound = false;
  for (const raw of data.split('#')) {
    if (slots.length >= MAX_SLOTS) break;
    const field = (key: string) => {
      const i = raw.indexOf(`${key}=`);
      if (i < 0) return '';
      const rest = raw.slice(i + key.length + 1);
      const amp = key === 'value' ? -1 : rest.indexOf('&');
      return (amp < 0 ? rest : rest.slice(0, amp)).trim();
    };
    const startUtc = field('start');
    const endUtc = field('end');
    const value = field('value');
    const active =
      !activeFound && !!startUtc && isTimeInRange(nowMin, startUtc, endUtc);
    if (active) activeFound = true;
    slots.push({
      index: slots.length + 1,
      raw,
      startUtc,
      endUtc,
      startVn: utcToVn(startUtc),
      endVn: utcToVn(endUtc),
      value,
      decoded: decodeValue(value),
      placeholder: startUtc === '00:00' && endUtc === '00:00',
      active,
    });
  }
  return slots;
}

export interface RunSourceInput {
  now: Date;
  setting: string | null;
  schedule: string | null;
  gridTieOff: boolean;
  blacklisted: boolean;
  share: { enabled: boolean; computedW: number | null };
}

export interface Expected {
  source: RunSource;
  /** Schedule slot number (1-based) when source = schedule. */
  slot: number | null;
  value: DecodedValue | null;
  /** Why: e.g. the active slot has a bad value so the setting runs. */
  note: string | null;
}

/** lock > grid-tie OFF > share > schedule > setting (firmware order). */
export function expectedSource(
  inp: RunSourceInput,
  slots: ScheduleSlot[],
): Expected {
  if (inp.blacklisted) {
    return { source: 'lock', slot: null, value: null, note: null };
  }
  if (inp.gridTieOff) {
    return {
      source: 'gridtie',
      slot: null,
      value: { cutoffV: 99, limitW: 1 },
      note: null,
    };
  }
  const setting = decodeValue(inp.setting);
  if (inp.share.enabled && inp.share.computedW !== null) {
    return {
      source: 'share',
      slot: null,
      value: setting
        ? { cutoffV: setting.cutoffV, limitW: inp.share.computedW }
        : null,
      note: null,
    };
  }
  const active = slots.find((s) => s.active);
  if (active) {
    if (active.decoded) {
      return {
        source: 'schedule',
        slot: active.index,
        value: active.decoded,
        note: active.placeholder
          ? 'Ô lịch trống 00:00-00:00 vẫn khớp phút 00:00 UTC (07:00 giờ VN)'
          : null,
      };
    }
    // Firmware: a matching slot with a bad value returns "" -> setting.
    return {
      source: setting ? 'setting' : 'none',
      slot: null,
      value: setting,
      note: `Ô lịch #${active.index} đang khớp giờ nhưng giá trị "${active.value}" không hợp lệ nên chạy theo cài đặt`,
    };
  }
  return {
    source: setting ? 'setting' : 'none',
    slot: null,
    value: setting,
    note: null,
  };
}

/** Telemetry "vAC#Hz#pGrid#vBat#pGridTie#temp#cutoff#limit[...]" -> fields 7/8. */
export function stmValueOf(
  frame: string | null | undefined,
): DecodedValue | null {
  if (!frame || typeof frame !== 'string') return null;
  const p = frame.replace(/\$/g, '').split('#');
  if (p.length < 8) return null;
  const cutoffV = parseFloat(p[6]);
  const limitW = parseFloat(p[7]);
  if (!Number.isFinite(cutoffV) || !Number.isFinite(limitW)) return null;
  return { cutoffV, limitW };
}

/**
 * Does the STM32 run this value? Limit within 5 W (AUTO detection offsets it
 * by 2-4 W); a legacy board clamps the limit to 1200 W.
 */
export function stmRuns(
  stm: DecodedValue,
  v: DecodedValue | null,
  legacy = false,
): boolean {
  if (!v) return false;
  const lim = legacy ? Math.min(Math.max(v.limitW, 0), 1200) : v.limitW;
  return (
    Math.abs(stm.cutoffV - v.cutoffV) < 0.06 && Math.abs(stm.limitW - lim) <= 5
  );
}

/** Which candidates the STM32 value matches ("setting", "schedule#2", ...). */
export function stmMatches(
  stm: DecodedValue,
  candidates: { key: string; value: DecodedValue | null }[],
  legacy = false,
): string[] {
  return candidates
    .filter((c) => stmRuns(stm, c.value, legacy))
    .map((c) => c.key);
}

/** Firmware SOURCE_CHANGE log: "source=schedule value=*5200@1800#". */
export function parseSourceLog(
  msg: string,
): { source: string; value: string } | null {
  const s = /source=(\w+)/.exec(msg)?.[1];
  if (!s) return null;
  const v = /value=(\S+)/.exec(msg)?.[1] ?? '';
  return { source: s.slice(0, 16), value: v.slice(0, 24) };
}
