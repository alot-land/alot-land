import { describe, it, expect } from 'vitest';
import {
  bedroomRatios,
  adjustRentForBedrooms,
  bedroomsFromLabel,
  pickRent,
  RENT_SOURCE_ORDER,
  CALC_VERSION,
} from '../src/index.js';

// Phoenix-ish SAFMR figures, used only for their SHAPE (the ratios between
// bedroom counts), never as rent levels — see the module docblock.
const FMR = { efficiency: 1160, one: 1250, two: 1500, three: 2100, four: 2450 };

describe('bedroomRatios', () => {
  it('normalizes every present bedroom count against the 2BR base', () => {
    const r = bedroomRatios(FMR);
    expect(r[2]).toBe(1);
    // Hand-checked: 1250/1500, 2100/1500, 2450/1500, 1160/1500.
    expect(r[1]).toBeCloseTo(0.8333333, 6);
    expect(r[3]).toBeCloseTo(1.4, 6);
    expect(r[4]).toBeCloseTo(1.6333333, 6);
    expect(r[0]).toBeCloseTo(0.7733333, 6);
  });

  it('accepts a different base bedroom count', () => {
    const r = bedroomRatios(FMR, 1);
    expect(r[1]).toBe(1);
    expect(r[2]).toBeCloseTo(1500 / 1250, 6);
  });

  it('omits bedroom counts with no figure rather than inventing one', () => {
    const r = bedroomRatios({ two: 1500, three: null, four: 0 });
    expect(r[2]).toBe(1);
    expect(r[3]).toBeUndefined();
    expect(r[4]).toBeUndefined();
  });

  it('returns nothing when the base bedroom count is missing', () => {
    // Without the base there is no anchor, so no ratio is meaningful.
    expect(bedroomRatios({ one: 1250, three: 2100 })).toEqual({});
  });
});

describe('adjustRentForBedrooms', () => {
  const ratios = bedroomRatios(FMR);

  it('reshapes a blended zip rent to a bedroom count', () => {
    // 1600 blended at the 2BR position × (2100/1500) = 2240 for a 3BR.
    expect(adjustRentForBedrooms({ blended_rent: 1600, bedrooms: 3, ratios })).toBeCloseTo(2240, 6);
    // ...and down for a 1BR: 1600 × (1250/1500).
    expect(adjustRentForBedrooms({ blended_rent: 1600, bedrooms: 1, ratios })).toBeCloseTo(1333.3333, 4);
  });

  it('is a no-op at the blend position', () => {
    expect(adjustRentForBedrooms({ blended_rent: 1600, bedrooms: 2, ratios })).toBeCloseTo(1600, 6);
  });

  it('honors a blend assumed to sit at a different bedroom count', () => {
    // Same target, blend assumed to be a 1BR: 1600 × (2100/1250).
    const out = adjustRentForBedrooms({ blended_rent: 1600, bedrooms: 3, ratios, blend_bedrooms: 1 });
    expect(out).toBeCloseTo(1600 * (2100 / 1250), 6);
  });

  it('returns null rather than guessing when a piece is missing', () => {
    expect(adjustRentForBedrooms({ blended_rent: null, bedrooms: 3, ratios })).toBeNull();
    expect(adjustRentForBedrooms({ blended_rent: 1600, bedrooms: null, ratios })).toBeNull();
    // No ratio for 5BR — fall back to the blend, don't extrapolate.
    expect(adjustRentForBedrooms({ blended_rent: 1600, bedrooms: 5, ratios })).toBeNull();
    // No ratios at all (zip outside SAFMR coverage).
    expect(adjustRentForBedrooms({ blended_rent: 1600, bedrooms: 3, ratios: {} })).toBeNull();
  });
});

describe('bedroomsFromLabel', () => {
  it('reads the unit-type labels this app uses', () => {
    expect(bedroomsFromLabel('2BR/1BA')).toBe(2);
    expect(bedroomsFromLabel('3 bed / 2 bath')).toBe(3);
    expect(bedroomsFromLabel('1br')).toBe(1);
    expect(bedroomsFromLabel('4 Bedroom')).toBe(4);
    expect(bedroomsFromLabel('Studio')).toBe(0);
    expect(bedroomsFromLabel('efficiency unit')).toBe(0);
  });

  it('returns null rather than defaulting when the label says nothing', () => {
    expect(bedroomsFromLabel('avg unit')).toBeNull();
    expect(bedroomsFromLabel('')).toBeNull();
    expect(bedroomsFromLabel(null)).toBeNull();
    // Implausible counts are not bedroom counts.
    expect(bedroomsFromLabel('120BR')).toBeNull();
  });
});

describe('pickRent', () => {
  it('prefers the most specific source available', () => {
    const picked = pickRent([
      { rent: 1500, source: 'zori_blended' },
      { rent: 1750, source: 'api_address', detail: 'RentCast 3bd/2ba' },
      { rent: 1600, source: 'safmr_adjusted' },
    ]);
    expect(picked?.rent).toBe(1750);
    expect(picked?.source).toBe('api_address');
    expect(picked?.detail).toBe('RentCast 3bd/2ba');
    // The others survive as alternates, in precedence order.
    expect(picked?.alternates.map((a) => a.source)).toEqual(['safmr_adjusted', 'zori_blended']);
  });

  it('lets a real rent roll beat every estimate', () => {
    const picked = pickRent([
      { rent: 2000, source: 'api_address' },
      { rent: 1400, source: 'actual' },
    ]);
    expect(picked?.source).toBe('actual');
    expect(picked?.rent).toBe(1400);
  });

  it('drops empty candidates instead of ranking them', () => {
    // A configured-but-empty API must not outrank a real zip band.
    const picked = pickRent([
      { rent: null, source: 'api_address' },
      { rent: 0, source: 'safmr_adjusted' },
      { rent: 1500, source: 'zori_blended' },
    ]);
    expect(picked?.source).toBe('zori_blended');
    expect(picked?.alternates).toEqual([]);
  });

  it('returns null when nothing is usable', () => {
    expect(pickRent([])).toBeNull();
    expect(pickRent([{ rent: null, source: 'zori_blended' }])).toBeNull();
  });

  it('ranks in the documented order', () => {
    expect(RENT_SOURCE_ORDER).toEqual(['actual', 'api_address', 'safmr_adjusted', 'zori_blended', 'fmr']);
  });
});

describe('version', () => {
  it('is at least the version that introduced rent estimation', () => {
    expect(CALC_VERSION >= '1.13.0').toBe(true);
  });
});
