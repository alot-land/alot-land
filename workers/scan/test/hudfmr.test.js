import { describe, it, expect } from 'vitest';
import {
  hudDataUrl,
  hudCountiesUrl,
  hudAuthHeaders,
  fmrByBedroom,
  parseFmrResponse,
  parseCounties,
  toRentBandRows,
  normalizeZip,
  isRealZip,
} from '../lib/hudfmr.js';

describe('normalizeZip', () => {
  it('rejects HUD area-wide rows instead of truncating them into a ZIP', () => {
    // The real bug: "MSA level" was sliced to "MSA l" and stored as a place.
    expect(normalizeZip('MSA level')).toBeNull();
    expect(normalizeZip('MSA')).toBeNull();
    expect(normalizeZip('')).toBeNull();
    expect(normalizeZip(null)).toBeNull();
    expect(normalizeZip('8500A')).toBeNull();
  });

  it('keeps real ZIPs and restores lost leading zeros', () => {
    expect(normalizeZip('85003')).toBe('85003');
    expect(normalizeZip(' 37206 ')).toBe('37206');
    expect(normalizeZip('85003-1234')).toBe('85003');
    // JSON numbers drop leading zeros: 601 is Puerto Rico's 00601.
    expect(normalizeZip(601)).toBe('00601');
    expect(normalizeZip(2134)).toBe('02134');
    // Too short to disambiguate — junk, not a ZIP.
    expect(normalizeZip('60')).toBeNull();
  });

  it('isRealZip identifies stored rows worth keeping', () => {
    expect(isRealZip('85003')).toBe(true);
    expect(isRealZip('MSA l')).toBe(false);
    expect(isRealZip(null)).toBe(false);
  });
});

describe('HUD FMR urls and auth', () => {
  it('builds data and county urls', () => {
    expect(hudDataUrl('0401399999')).toBe('https://www.huduser.gov/hudapi/public/fmr/data/0401399999');
    expect(hudDataUrl('0401399999', 2026)).toContain('?year=2026');
    expect(hudCountiesUrl('AZ')).toBe('https://www.huduser.gov/hudapi/public/fmr/listCounties/AZ');
  });

  it('uses bearer auth', () => {
    expect(hudAuthHeaders('tok123').Authorization).toBe('Bearer tok123');
  });
});

describe('fmrByBedroom', () => {
  it('reads the hyphenated labels HUD returns', () => {
    const out = fmrByBedroom({
      'Efficiency': 1160, 'One-Bedroom': 1250, 'Two-Bedroom': 1500,
      'Three-Bedroom': 2100, 'Four-Bedroom': 2450,
    });
    expect(out).toEqual({ efficiency: 1160, one: 1250, two: 1500, three: 2100, four: 2450 });
  });

  it('also reads the older underscored labels', () => {
    const out = fmrByBedroom({ 'Two_Bedroom': '1,500', 'Three_Bedroom': '$2,100' });
    expect(out.two).toBe(1500);
    expect(out.three).toBe(2100);
    expect(out.one).toBeNull();
  });

  it('treats zero and blanks as missing rather than as rent', () => {
    const out = fmrByBedroom({ 'Two-Bedroom': 0, 'Three-Bedroom': '', 'Four-Bedroom': null });
    expect(out.two).toBeNull();
    expect(out.three).toBeNull();
    expect(out.four).toBeNull();
  });
});

describe('parseFmrResponse', () => {
  it('reads per-zip rows from a small-area response', () => {
    const rows = parseFmrResponse({
      data: {
        year: 2026,
        smallarea_status: '1',
        basicdata: [
          { zip_code: '85003', 'One-Bedroom': 1250, 'Two-Bedroom': 1500 },
          { zip_code: '85004', 'One-Bedroom': 1310, 'Two-Bedroom': 1580 },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].zip).toBe('85003');
    expect(rows[0].fmr.two).toBe(1500);
    expect(rows[0].small_area).toBe(true);
    expect(rows[0].year).toBe(2026);
  });

  it('handles the single-object (area-wide) shape', () => {
    const rows = parseFmrResponse({
      data: { year: 2026, smallarea_status: '0', basicdata: { 'Two-Bedroom': 1400 } },
    });
    expect(rows).toHaveLength(1);
    // No zip of its own — the importer skips these rather than inventing one.
    expect(rows[0].zip).toBeNull();
    expect(rows[0].small_area).toBe(false);
  });

  it('drops area-wide summary rows mixed into basicdata', () => {
    // HUD returns these alongside the real ZIP rows.
    const rows = parseFmrResponse({
      data: {
        year: 2026,
        smallarea_status: '1',
        basicdata: [
          { zip_code: 'MSA level', 'Two-Bedroom': 1839 },
          { zip_code: '85003', 'Two-Bedroom': 1500 },
        ],
      },
    });
    expect(rows).toHaveLength(2);
    // Parsed, but with no zip — toRentBandRows then refuses to store it.
    expect(rows[0].zip).toBeNull();
    expect(rows[1].zip).toBe('85003');
    const stored = toRentBandRows(rows, { orgId: 'org1' });
    expect(stored.every((r) => r.zip === '85003')).toBe(true);
  });

  it('drops rows with no usable figures, and copes with junk', () => {
    expect(parseFmrResponse({ data: { basicdata: [{ zip_code: '85003' }] } })).toEqual([]);
    expect(parseFmrResponse({})).toEqual([]);
    expect(parseFmrResponse(null)).toEqual([]);
  });
});

describe('parseCounties', () => {
  it('pulls fips codes out of listCounties', () => {
    const out = parseCounties({
      data: [
        { fips_code: '0401399999', county_name: 'Maricopa County', state_code: 'AZ' },
        { county_name: 'No Fips Here' },
      ],
    });
    expect(out).toEqual([{ fips: '0401399999', name: 'Maricopa County', state: 'AZ' }]);
  });
});

describe('toRentBandRows', () => {
  const parsed = [
    { zip: '85003', fmr: { efficiency: 1160, one: 1250, two: 1500, three: null, four: null }, year: 2026 },
    { zip: null, fmr: { two: 1400 }, year: 2026 },
  ];

  it('emits one row per present bedroom count, skipping zip-less rows', () => {
    const rows = toRentBandRows(parsed, { orgId: 'org1', state: 'AZ', now: '2026-07-25T00:00:00Z' });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.bedrooms)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.zip === '85003' && r.state === 'AZ')).toBe(true);
    // Period falls back to the response year so upserts stay idempotent.
    expect(rows[0].period).toBe('2026');
  });

  it('marks the source and flags the figures as low confidence', () => {
    const [row] = toRentBandRows(parsed, { orgId: 'org1' });
    // These are policy figures — the app uses their RATIOS, never their level.
    expect(row.source).toBe('hud-safmr');
    expect(row.confidence).toBe('low');
  });

  it('never emits a null period', () => {
    // period is part of the upsert conflict target, and NULL matches nothing —
    // a null would duplicate the whole set on every re-run instead of updating.
    const noYear = [{ zip: '85003', fmr: { two: 1500 }, year: null }];
    const [row] = toRentBandRows(noYear, { orgId: 'org1', now: '2026-07-25T00:00:00Z' });
    expect(row.period).toBe('2026');
    // An explicit period still wins over both the response year and the clock.
    const [pinned] = toRentBandRows(parsed, { orgId: 'org1', period: '2025' });
    expect(pinned.period).toBe('2025');
  });

  it('does not collide with the ZORI blended rows', () => {
    // ZORI writes bedrooms -1 with source 'zori'; SAFMR writes 0..4 with its
    // own source, so both live in rent_bands under the same unique index.
    const rows = toRentBandRows(parsed, { orgId: 'org1' });
    expect(rows.every((r) => r.bedrooms >= 0 && r.source !== 'zori')).toBe(true);
  });
});
