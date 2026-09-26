/**
 * EVN household (sinh hoạt) electricity tariff, used to turn kWh into money.
 *
 * Default = 6-tier tariff of Quyết định 1279/QĐ-BCT (9/5/2025), VND/kWh
 * before VAT. Override without a deploy of code:
 *   EVN_TARIFF_TIERS="50:1984,50:2050,100:2380,100:2998,100:3350,0:3460"
 *     (size kWh:price, size 0 = the rest)
 *   EVN_VAT_PERCENT=8
 * Prepaid meters pay one flat price (2,909 đ/kWh) - pass tariff=flat.
 */
export interface TariffTier {
  /** kWh in this tier; 0 = unlimited (last tier). */
  size: number;
  /** VND per kWh, before VAT. */
  price: number;
}

export const DEFAULT_EVN_TIERS: TariffTier[] = [
  { size: 50, price: 1984 },
  { size: 50, price: 2050 },
  { size: 100, price: 2380 },
  { size: 100, price: 2998 },
  { size: 100, price: 3350 },
  { size: 0, price: 3460 },
];
export const DEFAULT_EVN_VAT_PERCENT = 8;
export const DEFAULT_FLAT_PRICE = 2909;
export const EVN_TARIFF_SOURCE = 'QĐ 1279/QĐ-BCT (09/05/2025)';

export function parseTiers(raw?: string): TariffTier[] | null {
  if (!raw) return null;
  const tiers = raw.split(',').map((p) => {
    const [size, price] = p.split(':').map((x) => Number(x.trim()));
    return { size, price };
  });
  const ok =
    tiers.length > 0 &&
    tiers.every(
      (t) =>
        Number.isFinite(t.size) &&
        t.size >= 0 &&
        Number.isFinite(t.price) &&
        t.price > 0,
    );
  return ok ? tiers : null;
}

/** Bill of `kwh` over one month, VND incl. VAT (rounded to đồng). */
export function billForKwh(
  kwh: number,
  tiers: TariffTier[],
  vatPercent: number,
): number {
  let left = Math.max(0, kwh);
  let total = 0;
  for (const t of tiers) {
    if (left <= 0) break;
    const used = t.size > 0 ? Math.min(left, t.size) : left;
    total += used * t.price;
    left -= used;
  }
  return Math.round(total * (1 + vatPercent / 100));
}
