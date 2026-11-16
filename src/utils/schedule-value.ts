/**
 * Inverter schedule values ("start=HH:MM&end=HH:MM&value=VVVVPPPP#...").
 *
 * The ESP32 only accepts an 8-digit value (VVVV = cut-off volts x100, PPPP =
 * watts + 1000) and skips a slot with any other value (convertSetupValue), so
 * the device runs the base setting in that window. Older app builds sent the
 * fields the user left blank as 0 V / 0 W without padding ("01000"): blank
 * meant "use the setting". This repairs such values with the device setting,
 * the way the fixed app fills blank fields.
 */

const SETTING_RE = /^(\d{4})(\d{4})/;

export interface ScheduleRepair {
  schedule: string;
  /** Slots whose value was rewritten. */
  fixed: number;
  /** Slots still not 8 digits (no usable setting to fill them from). */
  invalid: number;
}

/** "VVVV" + "PPPP" of the setting ("23001900", possibly with a suffix). */
function settingParts(setting?: string | null): [string, string] | null {
  const m = SETTING_RE.exec(String(setting ?? '').trim());
  return m ? [m[1], m[2]] : null;
}

/** One slot value -> its repaired form, or null when it can't be repaired. */
export function repairScheduleValue(
  value: string,
  setting?: string | null,
): string | null {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) return v;
  const s = settingParts(setting);
  if (!/^\d{4,7}$/.test(v)) return s ? s[0] + s[1] : null; // "NaN...", empty
  const power = v.slice(-4);
  const volts = Number(v.slice(0, -4) || '0');
  if (volts === 0) {
    if (!s) return null;
    // Both blank ("0" + "1000" = 0 W): the setting as a whole.
    return s[0] + (power === '1000' ? s[1] : power);
  }
  return String(volts).padStart(4, '0') + power; // short volts: pad
}

/** Repair every slot of a schedule string; other text is kept as is. */
export function repairSchedule(
  schedule: string | null | undefined,
  setting?: string | null,
): ScheduleRepair {
  let fixed = 0;
  let invalid = 0;
  const out = String(schedule ?? '').replace(
    /value=([^&#]*)/g,
    (whole, value: string) => {
      const r = repairScheduleValue(value, setting);
      if (r === null) {
        invalid++;
        return whole;
      }
      if (r !== value) fixed++;
      return `value=${r}`;
    },
  );
  return { schedule: out, fixed, invalid };
}
