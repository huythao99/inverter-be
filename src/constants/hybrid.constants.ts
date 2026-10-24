// HINVLF v1 (STM32 hybrid low-frequency inverter) — see esp32-hybrid
// PROTOCOL_HINVLF_V1.md. Pure helpers (no Nest), unit-tested in hybrid.spec.ts.

export const HYBRID_MODES = [
  'OFF',
  'OFFGRID',
  'LOAD',
  'CHG',
  'EXPORT',
] as const;
export type HybridMode = (typeof HYBRID_MODES)[number];

/** Writable keys ($SET), in the order they are sent. */
export const HYBRID_CONFIG_KEYS = [
  'MODE',
  'PCHG',
  'PEXP',
  'PIMP',
  'VEXP',
  'VCUT',
  'VRES',
  'PMAX',
  'PCMAX',
] as const;
export type HybridConfigKey = (typeof HYBRID_CONFIG_KEYS)[number];

/** Read-only $CFG keys (shown, never sent). */
export const HYBRID_READONLY_KEYS = [
  'VCV',
  'VOVP',
  'SYS',
  'FHZ',
  'VGMAX',
  'VGMIN',
  'VBMAX',
  'SRC',
] as const;

/** Commands the app may send (cmd/action). SAVE / FWU are not exposed. */
export const HYBRID_COMMANDS = ['FAULT_RST', 'STOP', 'RUN'] as const;
export type HybridCommand = (typeof HYBRID_COMMANDS)[number];

export type HybridConfig = Partial<{
  MODE: HybridMode;
  PCHG: number;
  PEXP: number;
  PIMP: number;
  VEXP: number;
  VCUT: number;
  VRES: number;
  PMAX: number;
  PCMAX: number;
}>;

const POWER_KEYS = ['PCHG', 'PEXP', 'PIMP', 'PMAX', 'PCMAX'] as const;
const VOLT_KEYS = ['VEXP', 'VCUT', 'VRES'] as const;

export interface HybridConfigError {
  key: string;
  message: string;
}

/** Number from a $CFG value / API input, undefined if not a plain number. */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string' || !/^[-+]?\d+(\.\d+)?$/.test(v.trim())) {
    return undefined;
  }
  return Number(v);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Parse an API patch: only known keys, MODE upper-cased, powers rounded to
 * whole W, voltages to 0.1 V. Unknown / malformed values -> errors.
 */
export function parseHybridPatch(input: Record<string, unknown>): {
  patch: HybridConfig;
  errors: HybridConfigError[];
} {
  const patch: HybridConfig = {};
  const errors: HybridConfigError[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    const key = k.toUpperCase();
    if (!(HYBRID_CONFIG_KEYS as readonly string[]).includes(key)) {
      errors.push({ key: k, message: 'Không hỗ trợ tham số này' });
      continue;
    }
    if (key === 'MODE') {
      const m = typeof v === 'string' ? v.toUpperCase() : '';
      if ((HYBRID_MODES as readonly string[]).includes(m)) {
        patch.MODE = m as HybridMode;
      } else errors.push({ key, message: 'Chế độ không hợp lệ' });
      continue;
    }
    const n = num(v);
    if (n === undefined) {
      errors.push({ key, message: 'Giá trị phải là số' });
      continue;
    }
    (patch as Record<string, number>)[key] = (
      POWER_KEYS as readonly string[]
    ).includes(key)
      ? Math.round(n)
      : round1(n);
  }
  return { patch, errors };
}

/** Machine limits taken from the latest $CFG (undefined = unknown). */
export interface HybridLimits {
  VCV?: number;
  VBMAX?: number;
}

/**
 * Merge a patch onto the effective config (stored server config over the
 * machine's $CFG), apply the STM32 pull-along rules for keys NOT in the
 * patch, then validate everything. Returns the keys to store (patch keys +
 * pulled-along keys) and the full merged view.
 */
export function mergeHybridConfig(
  base: HybridConfig,
  patch: HybridConfig,
  limits: HybridLimits,
): {
  changes: HybridConfig;
  merged: HybridConfig;
  errors: HybridConfigError[];
} {
  const merged: HybridConfig = { ...base, ...patch };
  const changes: HybridConfig = { ...patch };
  const has = (k: HybridConfigKey) => k in patch;

  // Pull-along (PROTOCOL_HINVLF_V1.md §3 rule 4).
  if (
    !has('PEXP') &&
    merged.PMAX !== undefined &&
    merged.PEXP !== undefined &&
    merged.PEXP > merged.PMAX
  ) {
    merged.PEXP = changes.PEXP = merged.PMAX;
  }
  if (
    !has('PCHG') &&
    merged.PCMAX !== undefined &&
    merged.PCHG !== undefined &&
    merged.PCHG > merged.PCMAX
  ) {
    merged.PCHG = changes.PCHG = merged.PCMAX;
  }
  if (
    !has('VEXP') &&
    merged.VRES !== undefined &&
    merged.VEXP !== undefined &&
    merged.VEXP < merged.VRES
  ) {
    merged.VEXP = changes.VEXP = merged.VRES;
  }

  return { changes, merged, errors: validateHybridConfig(merged, limits) };
}

/** Ranges + cross constraints (PROTOCOL_HINVLF_V1.md §3). */
export function validateHybridConfig(
  c: HybridConfig,
  limits: HybridLimits,
): HybridConfigError[] {
  const e: HybridConfigError[] = [];
  const range = (k: HybridConfigKey, lo: number, hi: number, msg: string) => {
    const v = c[k] as number | undefined;
    if (v !== undefined && (v < lo || v > hi)) e.push({ key: k, message: msg });
  };
  range('PMAX', 500, 6000, 'Công suất tối đa 500 – 6000 W');
  range('PCMAX', 100, 6000, 'Công suất sạc tối đa 100 – 6000 W');
  range('PIMP', -500, 500, 'Công suất nhận lưới -500 – 500 W');
  range('PCHG', 0, c.PCMAX ?? 6000, `Công suất sạc 0 – ${c.PCMAX ?? 6000} W`);
  range(
    'PEXP',
    0,
    c.PMAX ?? 6000,
    `Công suất đẩy lưới 0 – ${c.PMAX ?? 6000} W`,
  );

  const vbmax = limits.VBMAX;
  const vcv = limits.VCV;
  if (c.VCUT !== undefined) {
    if (c.VCUT < 5 || (vbmax !== undefined && c.VCUT > vbmax)) {
      e.push({ key: 'VCUT', message: `Áp ngắt xả 5.0 – ${vbmax ?? '?'} V` });
    } else if (c.VRES !== undefined && c.VCUT > round1(c.VRES - 0.5)) {
      e.push({
        key: 'VCUT',
        message: 'Áp ngắt xả phải thấp hơn áp chạy lại ít nhất 0.5 V',
      });
    }
  }
  if (c.VRES !== undefined) {
    if (c.VCUT !== undefined && c.VRES <= c.VCUT) {
      e.push({ key: 'VRES', message: 'Áp chạy lại phải lớn hơn áp ngắt xả' });
    } else if (vcv !== undefined && c.VRES > round1(vcv - 0.5)) {
      e.push({
        key: 'VRES',
        message: `Áp chạy lại tối đa ${round1(vcv - 0.5)} V (áp sạc − 0.5)`,
      });
    } else if (vbmax !== undefined && c.VRES > vbmax) {
      e.push({ key: 'VRES', message: `Áp chạy lại tối đa ${vbmax} V` });
    }
  }
  if (c.VEXP !== undefined) {
    if (
      (c.VRES !== undefined && c.VEXP < c.VRES) ||
      (vcv !== undefined && c.VEXP > vcv)
    ) {
      e.push({
        key: 'VEXP',
        message: `Áp ngừng đẩy ${c.VRES ?? '?'} – ${vcv ?? '?'} V`,
      });
    }
  }
  return e;
}

/** Stored config -> SET item list for the firmware ("MODE=EXPORT,PEXP=1500,VCUT=42.0"). */
export function hybridSetBody(c: HybridConfig | null | undefined): string {
  if (!c) return '';
  const items: string[] = [];
  for (const k of HYBRID_CONFIG_KEYS) {
    const v = c[k];
    if (v === undefined || v === null) continue;
    if (k === 'MODE') items.push(`MODE=${String(v)}`);
    else if ((VOLT_KEYS as readonly string[]).includes(k)) {
      items.push(`${k}=${(v as number).toFixed(1)}`);
    } else items.push(`${k}=${Math.round(v as number)}`);
  }
  return items.join(',');
}

/** $CFG map -> HybridConfig (writable keys only). */
export function hybridConfigFromCfg(
  cfg: Record<string, string> | null | undefined,
): HybridConfig {
  const out: HybridConfig = {};
  if (!cfg) return out;
  const parsed = parseHybridPatch(
    Object.fromEntries(
      HYBRID_CONFIG_KEYS.filter((k) => cfg[k] !== undefined).map((k) => [
        k,
        cfg[k],
      ]),
    ),
  );
  return parsed.patch;
}

/** Keys whose stored value differs from the machine's $CFG ("chờ áp dụng"). */
export function hybridPendingKeys(
  config: HybridConfig | null | undefined,
  cfg: Record<string, string> | null | undefined,
): string[] {
  if (!config || !cfg) return [];
  const pending: string[] = [];
  for (const k of HYBRID_CONFIG_KEYS) {
    const want = config[k];
    if (want === undefined) continue;
    const have = cfg[k];
    if (k === 'MODE') {
      if (String(want) !== have) pending.push(k);
      continue;
    }
    const h = num(have);
    if (h === undefined || Math.abs((want as number) - h) >= 0.005)
      pending.push(k);
  }
  return pending;
}

// ---- Energy (EDIS / ECHG / EIMP / EEXP, Wh, wrap at 1e7, reset on STM boot) ----

export const HYBRID_ENERGY_KEYS = ['EDIS', 'ECHG', 'EIMP', 'EEXP'] as const;
export type HybridEnergyKey = (typeof HYBRID_ENERGY_KEYS)[number];
const ENERGY_WRAP = 10_000_000;

export interface HybridEnergyRef {
  UP: number;
  EDIS: number;
  ECHG: number;
  EIMP: number;
  EEXP: number;
}

/** Counters of a $TLM (null if any is missing / not a number). */
export function hybridEnergyRef(
  tlm: Record<string, string>,
): HybridEnergyRef | null {
  const up = num(tlm.UP);
  if (up === undefined) return null;
  const ref = { UP: up } as HybridEnergyRef;
  for (const k of HYBRID_ENERGY_KEYS) {
    const v = num(tlm[k]);
    if (v === undefined || v < 0) return null;
    ref[k] = v;
  }
  return ref;
}

/**
 * Energy between two $TLM: STM32 rebooted (counters restarted at 0) -> the
 * new value; else (new - old + 1e7) % 1e7. With `elapsedSec` (wall time
 * between the two frames) a reboot that happened while we saw nothing is
 * also detected: without one, UP grows by ~elapsedSec.
 */
export function hybridEnergyDelta(
  prev: HybridEnergyRef,
  next: HybridEnergyRef,
  elapsedSec?: number,
): Record<HybridEnergyKey, number> {
  const rebooted =
    next.UP < prev.UP ||
    (elapsedSec !== undefined && next.UP < prev.UP + elapsedSec - 120);
  const out = {} as Record<HybridEnergyKey, number>;
  for (const k of HYBRID_ENERGY_KEYS) {
    out[k] = rebooted
      ? next[k]
      : (next[k] - prev[k] + ENERGY_WRAP) % ENERGY_WRAP;
  }
  return out;
}

// ---- $ETOT (protocol v1.1): lifetime totals kept in the STM32 flash ----
// Unsigned 32-bit Wh since the factory, never reset (odometer). The STM32
// sends it on $GET,ETOT and every 60 s. A power cut may lose up to 1 h of
// counting, so a total can come back SMALLER than one already seen: keep the
// largest per key and count nothing for the step back.

export type HybridEtot = Record<HybridEnergyKey, number>;
const U32_MAX = 4_294_967_295;

/** Items of a $ETOT (null unless all four are plain unsigned integers). */
export function hybridEtot(items: Record<string, string>): HybridEtot | null {
  const out = {} as HybridEtot;
  for (const k of HYBRID_ENERGY_KEYS) {
    const s = items[k];
    if (typeof s !== 'string' || !/^\d{1,10}$/.test(s)) return null;
    const v = Number(s);
    if (v > U32_MAX) return null;
    out[k] = v;
  }
  return out;
}

/**
 * Energy between the largest totals seen so far (`max`) and a new $ETOT:
 * only increases count. Returns the energy and the new largest totals.
 */
export function hybridEtotDelta(
  max: HybridEtot,
  next: HybridEtot,
): { delta: HybridEtot; max: HybridEtot } {
  const delta = {} as HybridEtot;
  const m = {} as HybridEtot;
  for (const k of HYBRID_ENERGY_KEYS) {
    delta[k] = Math.max(0, next[k] - max[k]);
    m[k] = Math.max(max[k], next[k]);
  }
  return { delta, max: m };
}

/** Calendar day in Vietnam (UTC+7), "YYYY-MM-DD". */
export function vnDay(at: Date = new Date()): string {
  return new Date(at.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
