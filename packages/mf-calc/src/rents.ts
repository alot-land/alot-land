/**
 * Rent estimation — added in calc v1.13.0 (new module + tests per the
 * frozen-module protocol).
 *
 * The weakest input in the whole system is rent: a ZORI *blended* zip band
 * treats a 1BR unit in a duplex and a 3BR unit in a fourplex as the same
 * number, and every downstream figure (NOI, cap, DSCR, verdict, max offer)
 * inherits that error.
 *
 * Two fixes live here, both pure:
 *  1. {@link bedroomRatios} + {@link adjustRentForBedrooms} — reshape a
 *     blended zip rent to a specific bedroom count using HUD Small Area FMR
 *     as the SHAPE. SAFMR levels are policy figures (roughly a 40th
 *     percentile), so they are never used as rent directly — only the
 *     ratios between bedroom counts within one zip, which is the part that
 *     travels well.
 *  2. {@link pickRent} — a stated precedence over every rent source, so the
 *     number that wins is always the most specific one available and always
 *     carries its provenance.
 */

/** HUD FMR figures for one zip/area, by bedroom count. Missing = unavailable. */
export interface FmrByBedroom {
  /** 0BR / studio. */
  efficiency?: number | null;
  one?: number | null;
  two?: number | null;
  three?: number | null;
  four?: number | null;
}

export type BedroomRatios = Record<number, number>;

/**
 * FMR levels → ratios against a base bedroom count (2BR by default: the
 * typical small-multifamily unit and the densest FMR sample).
 *
 * Returns only the bedroom counts actually present and positive — a ratio
 * invented from a missing figure would be indistinguishable from a real one.
 */
export function bedroomRatios(fmr: FmrByBedroom, baseBedrooms = 2): BedroomRatios {
  const byBed: Array<[number, number | null | undefined]> = [
    [0, fmr.efficiency],
    [1, fmr.one],
    [2, fmr.two],
    [3, fmr.three],
    [4, fmr.four],
  ];
  const present = new Map<number, number>();
  for (const [bed, v] of byBed) if (v != null && v > 0) present.set(bed, v);

  const base = present.get(baseBedrooms);
  if (base == null) return {};

  const out: BedroomRatios = {};
  for (const [bed, v] of present) out[bed] = v / base;
  return out;
}

export interface AdjustRentInput {
  /** Blended market rent for the zip (e.g. the ZORI band). */
  blended_rent: number | null | undefined;
  /** Bedroom count of the unit being priced. */
  bedrooms: number | null | undefined;
  ratios: BedroomRatios;
  /** Bedroom count the blend is assumed to sit at. */
  blend_bedrooms?: number;
}

/**
 * Reshape a blended zip rent to one bedroom count.
 *
 *   rent(b) = blended × ratio(b) / ratio(blend)
 *
 * Null unless every part is real — no ratio for the requested bedroom count,
 * or none for the blend's own position, means we cannot honestly reshape and
 * the caller should fall back to the blend itself.
 */
export function adjustRentForBedrooms(inp: AdjustRentInput): number | null {
  const blended = inp.blended_rent;
  if (!(blended != null && blended > 0)) return null;
  if (inp.bedrooms == null) return null;

  const blendBed = inp.blend_bedrooms ?? 2;
  const target = inp.ratios[inp.bedrooms];
  const blendRatio = inp.ratios[blendBed];
  if (!(target != null && target > 0) || !(blendRatio != null && blendRatio > 0)) return null;

  return (blended * target) / blendRatio;
}

/**
 * Bedroom count out of a unit-type label ("2BR/1BA" → 2, "Studio" → 0).
 * Unit types are free text in this app, so this is best-effort by design and
 * returns null rather than a default when the label says nothing.
 */
export function bedroomsFromLabel(label: string | null | undefined): number | null {
  const s = String(label || '').toLowerCase();
  if (!s.trim()) return null;
  if (/\bstudio\b|\befficiency\b|\bbachelor\b/.test(s)) return 0;
  const m = /(\d{1,2})\s*(?:br\b|bd\b|bed(?:room)?s?\b|\/)/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  }
  return null;
}

/**
 * Rent sources in precedence order. Lower index wins — most specific first.
 *
 *  actual          rent the property is really collecting (a rent roll)
 *  api_address     address-level estimate from a rent API (RentCast)
 *  safmr_adjusted  zip blend reshaped to this unit's bedroom count
 *  zori_blended    the raw blended zip band
 *  fmr             HUD FMR level itself — a policy floor, last resort
 */
export const RENT_SOURCE_ORDER = [
  'actual',
  'api_address',
  'safmr_adjusted',
  'zori_blended',
  'fmr',
] as const;

export type RentSourceKind = (typeof RENT_SOURCE_ORDER)[number];

export interface RentCandidate {
  rent: number | null | undefined;
  source: RentSourceKind;
  /** Free-form detail for the provenance table ("RentCast, 3bd/2ba"). */
  detail?: string;
  /** ISO date the figure was obtained, for staleness display. */
  as_of?: string | null;
}

export interface PickedRent {
  rent: number;
  source: RentSourceKind;
  detail?: string;
  as_of?: string | null;
  /** Sources that were available but outranked — shown as alternates. */
  alternates: RentCandidate[];
}

/**
 * Choose the rent to underwrite on. Candidates with no usable number are
 * dropped rather than ranked, so a configured-but-empty API never outranks a
 * real zip band. Returns null when nothing is usable — the caller must then
 * say "needs data" instead of inventing one.
 */
export function pickRent(candidates: RentCandidate[]): PickedRent | null {
  const usable = (candidates || []).filter((c) => c && c.rent != null && Number(c.rent) > 0);
  if (!usable.length) return null;

  const rank = (c: RentCandidate) => {
    const i = RENT_SOURCE_ORDER.indexOf(c.source);
    return i < 0 ? RENT_SOURCE_ORDER.length : i;
  };
  const sorted = [...usable].sort((a, b) => rank(a) - rank(b));
  const [best, ...rest] = sorted;
  return {
    rent: Number(best.rent),
    source: best.source,
    detail: best.detail,
    as_of: best.as_of ?? null,
    alternates: rest,
  };
}
