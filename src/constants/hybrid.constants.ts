// STM32 output target per grid-tie ("hoà lưới") state (PROTOCOL_MPPT_V1_1.md
// §6, key OUT): grid-tie ON -> feed the inverter / grid, OFF -> battery only.
export const HYBRID_OUT_GRID_TIE_ON = 'INV';
export const HYBRID_OUT_GRID_TIE_OFF = 'BAT';

export function hybridOutFor(gridTieOff: boolean): 'INV' | 'BAT' {
  return gridTieOff ? HYBRID_OUT_GRID_TIE_OFF : HYBRID_OUT_GRID_TIE_ON;
}

/**
 * Does the machine run what grid-tie asks for? Uses the applied config
 * ($CFG OUT), else the telemetry OUT. null = unknown (no data yet).
 */
export function hybridGridTieApplied(
  gridTieOff: boolean,
  data: { cfgOut?: string; out?: string } | null | undefined,
): boolean | null {
  const out = (data?.cfgOut || data?.out || '').toUpperCase();
  if (out !== 'INV' && out !== 'BAT') return null;
  return out === hybridOutFor(gridTieOff);
}
