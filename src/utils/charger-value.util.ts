/**
 * Charger setting value helpers.
 *
 * The charger setting is an 8-digit string `HHHHLLLL` where:
 *   - HHHH = VBAT in tenths of a volt  (round(VBAT * 10), 4 digits, zero-padded)
 *   - LLLL = IBAT in tenths of an amp  (round(IBAT * 10), 4 digits, zero-padded)
 *
 * Examples: 05400200 => 54.0V / 20.0A · 10000999 => 100.0V / 99.9A
 *
 * Valid STM32 range: VBAT 3.0–100.0 V, IBAT 0.0–100.0 A. Out-of-range values are
 * rejected by the STM32 (device logs STM_SET_RANGE), so we clamp/validate here.
 */

export const CHARGER_VALUE_REGEX = /^\d{8}$/;

export const CHARGER_VBAT_MIN = 3.0;
export const CHARGER_VBAT_MAX = 100.0;
export const CHARGER_IBAT_MIN = 0.0;
export const CHARGER_IBAT_MAX = 100.0;

export interface ChargerValueParts {
  vbat: number; // volts
  ibat: number; // amps
}

/** Encode VBAT/IBAT (human units) into the 8-digit `HHHHLLLL` string. */
export function encodeChargerValue(vbat: number, ibat: number): string {
  const hhhh = Math.round(vbat * 10);
  const llll = Math.round(ibat * 10);
  const pad = (n: number) => String(Math.max(0, n)).padStart(4, '0').slice(-4);
  return `${pad(hhhh)}${pad(llll)}`;
}

/** Decode the 8-digit `HHHHLLLL` string into VBAT/IBAT (human units). */
export function decodeChargerValue(value: string): ChargerValueParts | null {
  if (!value || !CHARGER_VALUE_REGEX.test(value)) {
    return null;
  }
  const vbat = parseInt(value.slice(0, 4), 10) / 10;
  const ibat = parseInt(value.slice(4, 8), 10) / 10;
  return { vbat, ibat };
}

/** True when VBAT/IBAT are inside the STM32-accepted range. */
export function isChargerValueInRange(vbat: number, ibat: number): boolean {
  return (
    vbat >= CHARGER_VBAT_MIN &&
    vbat <= CHARGER_VBAT_MAX &&
    ibat >= CHARGER_IBAT_MIN &&
    ibat <= CHARGER_IBAT_MAX
  );
}
