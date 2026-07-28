import { describe, it, expect } from 'vitest';
import { importParcels, essentialsOk, inspectReport } from '../lib/parcelimport.js';

/** Fake Supabase: rejects any row whose apn is in `bad`. */
function fakeDb(bad = new Set()) {
  const stored = [];
  const calls = [];
  return {
    stored,
    calls,
    supabase: {
      from: () => ({
        upsert: async (rows) => {
          calls.push(rows.length);
          const offender = rows.find((r) => bad.has(r.apn));
          if (offender) {
            return { error: { message: `invalid input syntax for type integer: "${offender.apn}"` } };
          }
          stored.push(...rows);
          return { error: null };
        },
      }),
    },
  };
}

const parcel = (apn) => ({ apn, county_fips: '04013', absentee: true, owner_is_entity: false, units: 4 });

describe('importParcels', () => {
  it('imports every row when the database is happy', async () => {
    const db = fakeDb();
    const stats = await importParcels(db, 'org1', [parcel('a'), parcel('b')]);
    expect(stats.imported).toBe(2);
    expect(stats.failed).toEqual([]);
    expect(db.stored.map((r) => r.dedupe_key)).toEqual(['apn:04013:a', 'apn:04013:b']);
  });

  it('isolates a bad row instead of losing its whole chunk', async () => {
    // The 2026-07-25 failure: one unrounded lot size took down 12k rows.
    const rows = Array.from({ length: 40 }, (_, i) => parcel(`p${i}`));
    const db = fakeDb(new Set(['p17']));
    const stats = await importParcels(db, 'org1', rows);

    expect(stats.imported).toBe(39);
    expect(stats.failed).toHaveLength(1);
    expect(stats.failed[0].apn).toBe('p17');
    expect(stats.failed[0].error).toContain('invalid input syntax');
    expect(db.stored.some((r) => r.apn === 'p17')).toBe(false);
    // Binary split, not row-by-row: far fewer calls than one per row.
    expect(db.calls.length).toBeLessThan(rows.length);
  });

  it('excludes rejected rows from the reported counts', async () => {
    const rows = [parcel('a'), parcel('b'), parcel('c'), parcel('d')];
    const stats = await importParcels(fakeDb(new Set(['c'])), 'org1', rows);
    // 'c' was absentee and had units, but it never landed — don't count it.
    expect(stats.imported).toBe(3);
    expect(stats.absentee).toBe(3);
    expect(stats.withUnits).toBe(3);
  });

  it('tolerates a few odd rows in a small batch', async () => {
    // One bad row in 20 is 5% — a ratio-only rule would abort the run here.
    const rows = Array.from({ length: 20 }, (_, i) => parcel(`p${i}`));
    const stats = await importParcels(fakeDb(new Set(['p3'])), 'org1', rows);
    expect(stats.imported).toBe(19);
    expect(stats.failed).toHaveLength(1);
  });

  it('throws when failures are broad, rather than leaving a plausible partial table', async () => {
    const rows = Array.from({ length: 600 }, (_, i) => parcel(`p${i}`));
    const bad = new Set(Array.from({ length: 40 }, (_, i) => `p${i}`)); // a bug, not bad data
    await expect(importParcels(fakeDb(bad), 'org1', rows)).rejects.toThrow(/rejected 40 of 600/);
  });
});

describe('inspectReport', () => {
  const base = { delimiter: '|', total: 10, kept: 9, dropped: 1, headers: ['APN'], parcels: [] };

  it('separates blocking unresolved fields from quality gaps', () => {
    const blocking = inspectReport({ ...base, unresolved: ['mailing_address', 'lot_sqft'] });
    expect(blocking).toContain('BLOCKING (import aborts): mailing_address');
    const fine = inspectReport({ ...base, unresolved: ['units', 'lot_sqft'] });
    expect(fine).toContain('none of these are essential');
    const noFilter = inspectReport({ ...base, unresolved: ['units', 'property_class'] });
    expect(noFilter).toContain('nothing to filter multifamily on');
    expect(essentialsOk({ unresolved: ['units', 'lot_sqft'] })).toBe(true);
    expect(essentialsOk({ unresolved: ['mailing_address'] })).toBe(false);
    // Units OR class is enough to filter multifamily; neither is not.
    expect(essentialsOk({ unresolved: ['property_class'] })).toBe(true);
    expect(essentialsOk({ unresolved: ['units', 'property_class'] })).toBe(false);
  });

  it('names the class descriptions it could not read a unit count from', () => {
    const out = inspectReport({
      ...base,
      unresolved: [],
      parcels: [
        { apn: '1', units: null, property_class: 'APARTMENTS 100+ UNITS 2 STORY' },
        { apn: '2', units: null, property_class: 'APARTMENTS 100+ UNITS 2 STORY' },
        { apn: '3', units: 4, property_class: 'FOURPLEX' },
      ],
    });
    expect(out).toContain('no unit count on 2 of 3');
    expect(out).toContain('2× APARTMENTS 100+ UNITS 2 STORY');
  });
});
