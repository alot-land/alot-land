import { describe, it, expect } from 'vitest';
import {
  sniffDelimiter,
  parseDSV,
  resolveColumns,
  looksLikeEntity,
  isAbsentee,
  unitsFromClass,
  assessorToParcels,
  PRESETS,
} from '../lib/assessor.js';

// ---------------------------------------------------------------------------
// Fixtures: a Maricopa-ish pipe file and a TN-CAMA-ish CSV. Headers are
// deliberately NOT the canonical candidate names everywhere — they exercise
// the normalized matching (spaces/case/punctuation).
// ---------------------------------------------------------------------------

const MARICOPA_FIXTURE = [
  'APN|Owner Name|Mail Address|Mail City|Mail State|Mail Zip|Situs Address|Situs City|Situs Zip|PUC|Year Built|Sale Date|Sale Price|Full Cash Value|Living Area|Land Area',
  '111-22-333|SMITH JOHN|123 E MAIN ST|PHOENIX|AZ|85004|123 E MAIN ST|PHOENIX|85004|0324|1975|20190315|500000|450000|3200|8000',
  '111-22-334|DESERT HOLDINGS LLC|PO BOX 99|SCOTTSDALE|AZ|85251|456 W OAK AVE|PHOENIX|85007|0318|1968|20150601|380000|400000|2800|7500',
  '111-22-335|JONES MARY|456 W OAK AVENUE|PHOENIX|AZ|85007|999 N ELM DR|PHOENIX|85008|0101|1990|20200101|300000|280000|1600|6000',
  '|NO APN ROW|X|Y|AZ|00000|Z|PHOENIX|85000|0322|1950|20100101|100000|90000|1000|5000',
].join('\n');

const TN_FIXTURE = [
  'PARID,OWNER,MAIL_ADDR,MAIL_CITY,MAIL_STATE,MAIL_ZIPCODE,PROPERTY_LOCATION,CITY,ZIP_CODE,CLASSIFICATION,LIVING_UNITS,YR_BUILT,DEED_DATE,SALE_AMOUNT,TOTAL_APPRAISAL',
  '001-002.00,"NASHVILLE RENTALS, LP",100 BROADWAY,NASHVILLE,TN,37201,200 CHURCH ST,NASHVILLE,37219,APARTMENT,6,1962,05/12/2018,750000,820000',
  '001-003.00,DOE JANE,200 CHURCH ST,NASHVILLE,TN,37219,200 CHURCH ST,NASHVILLE,37219,DUPLEX,2,1940,01/02/2021,410000,395000',
  '001-004.00,SOLO SFR OWNER,300 PINE ST,MEMPHIS,TN,38103,300 PINE ST,MEMPHIS,38103,RESIDENTIAL,1,1985,,,240000',
].join('\n');

describe('sniffDelimiter', () => {
  it('detects pipe, tab, and comma from the header line', () => {
    expect(sniffDelimiter('A|B|C\n1|2|3')).toBe('|');
    expect(sniffDelimiter('A\tB\tC\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('A,B,C\n1,2,3')).toBe(',');
  });

  it('defaults to comma when nothing matches', () => {
    expect(sniffDelimiter('justoneheader\nvalue')).toBe(',');
  });

  it('picks the majority delimiter when several appear', () => {
    // A CSV whose header cells contain a stray pipe should still be comma.
    expect(sniffDelimiter('A,B (x|y),C,D\n1,2,3,4')).toBe(',');
  });
});

describe('parseDSV', () => {
  it('routes commas through the quoted-cell CSV parser', () => {
    const rows = parseDSV('a,b\n"1,5",2', ',');
    expect(rows[1]).toEqual(['1,5', '2']);
  });

  it('splits pipe files directly and strips wrapping quotes', () => {
    const rows = parseDSV('a|b\n"x"|y', '|');
    expect(rows[1]).toEqual(['x', 'y']);
  });
});

describe('resolveColumns', () => {
  it('matches headers case-insensitively with punctuation normalized', () => {
    const idx = resolveColumns(['APN', 'Owner Name', 'Mail Zip', 'Full Cash Value', 'PUC']);
    expect(idx.apn).toBe(0);
    expect(idx.owner_name).toBe(1);
    // 'Mail Zip' → mail_zip candidate
    expect(idx.mailing_zip).toBe(2);
    expect(idx.assessed_value).toBe(3);
    expect(idx.property_class).toBe(4);
  });

  it('returns -1 for fields with no matching header', () => {
    const idx = resolveColumns(['APN', 'Owner Name']);
    expect(idx.units).toBe(-1);
    expect(idx.situs_address).toBe(-1);
  });

  it('takes the first candidate in priority order', () => {
    // Both 'units' and 'living_units' present — 'units' wins (listed first).
    const idx = resolveColumns(['Living Units', 'Units']);
    expect(idx.units).toBe(1);
  });

  it('matches camelCase API headers with no separators', () => {
    // ArcGIS layers hand back "PropertyUseDescription" / "PhysicalAddress",
    // which normalize to one word and missed every underscored synonym.
    const idx = resolveColumns([
      'APN', 'Ownership', 'PhysicalAddress', 'PropertyUseDescription', 'SaleDate', 'FullCashValue',
    ]);
    expect(idx.apn).toBe(0);
    expect(idx.owner_name).toBe(1);
    expect(idx.situs_address).toBe(2);
    expect(idx.property_class).toBe(3);
    expect(idx.last_sale_date).toBe(4);
    expect(idx.assessed_value).toBe(5);
  });

  it('prefers an exact header match over a separator-insensitive one', () => {
    // 'Units' is exact for the first candidate; 'DwellingUnits' only squashes.
    const idx = resolveColumns(['DwellingUnits', 'Units']);
    expect(idx.units).toBe(1);
  });
});

describe('looksLikeEntity', () => {
  it('flags common entity forms', () => {
    for (const n of [
      'DESERT HOLDINGS LLC',
      'ACME PROPERTIES',
      'SMITH FAMILY TRUST',
      'NASHVILLE RENTALS, LP',
      'BIG CORP',
      'MAIN ST PARTNERS',
      'ABC INVESTMENTS INC',
    ]) {
      expect(looksLikeEntity(n), n).toBe(true);
    }
  });

  it('passes ordinary personal names', () => {
    for (const n of ['SMITH JOHN', 'DOE JANE A', 'GARCIA-LOPEZ MARIA', '']) {
      expect(looksLikeEntity(n), n || '(empty)').toBe(false);
    }
  });
});

describe('isAbsentee', () => {
  it('false when mailing matches situs (suffix/case/punct variations)', () => {
    expect(isAbsentee('123 E Main St', '85004', '123 E MAIN STREET', '85004')).toBe(false);
    expect(isAbsentee('456 W Oak Ave.', '85007', '456 W OAK AVENUE', '85007')).toBe(false);
  });

  it('true when the owner mails elsewhere', () => {
    expect(isAbsentee('456 W Oak Ave', '85007', 'PO BOX 99', '85251')).toBe(true);
    expect(isAbsentee('123 E Main St', '85004', '900 N 5th Ave', '85004')).toBe(true);
  });

  it('same street number + same zip counts as owner-occupied-ish', () => {
    // e.g. "123 Main St" vs "123 Main St Unit B" style mismatches
    expect(isAbsentee('123 Main St', '85004', '123 Main St Apt 2', '85004')).toBe(false);
  });

  it('unknowable when either side is missing', () => {
    expect(isAbsentee('', '85004', 'PO BOX 99', '85251')).toBe(false);
    expect(isAbsentee('123 Main St', '85004', '', '')).toBe(false);
  });
});

describe('assessorToParcels — Maricopa preset', () => {
  const res = assessorToParcels(MARICOPA_FIXTURE, PRESETS.maricopa);

  it('sniffs the pipe delimiter and counts rows honestly', () => {
    expect(res.delimiter).toBe('|');
    expect(res.total).toBe(4);
    expect(res.dropped).toBe(1); // the no-APN row
  });

  it('keeps only 03xx multifamily PUC rows', () => {
    // 0324 + 0318 kept; 0101 (SFR) filtered; no-APN dropped
    expect(res.kept).toBe(2);
    expect(res.parcels.map((p) => p.apn)).toEqual(['111-22-333', '111-22-334']);
  });

  it('stamps state and county fips from the preset', () => {
    for (const p of res.parcels) {
      expect(p.state).toBe('AZ');
      expect(p.county_fips).toBe('04013');
    }
  });

  it('parses YYYYMMDD sale dates and $-free numbers', () => {
    const p = res.parcels[0];
    expect(p.last_sale_date).toBe('2019-03-15');
    expect(p.last_sale_price).toBe(500000);
    expect(p.assessed_value).toBe(450000);
    expect(p.building_sqft).toBe(3200);
    expect(p.year_built).toBe(1975);
  });

  it('marks entity + absentee on the LLC with a PO box', () => {
    const llc = res.parcels[1];
    expect(llc.owner_is_entity).toBe(true);
    expect(llc.absentee).toBe(true);
    const owner = res.parcels[0];
    expect(owner.owner_is_entity).toBe(false);
    expect(owner.absentee).toBe(false);
  });

  it('reports units as null when the file has no unit column', () => {
    expect(res.parcels[0].units).toBeNull();
    expect(res.unresolved).toContain('units');
  });
});

describe('assessorToParcels — Nashville ArcGIS Hub export shape', () => {
  // Header names verbatim from the field parse report (2026-07-24).
  const NASH_HUB = [
    'OBJECTID,ParID,Owner,OwnDate,SalePrice,OwnAddr1,OwnCity,OwnState,OwnZip,PropAddr,PropCity,PropZip,Acres,LUDesc,TotlAppr,Lat,Lon',
    '1,001-002.00,"NASHVILLE RENTALS, LP",2018-05-12,750000,100 BROADWAY,NASHVILLE,TN,37201,200 CHURCH ST,NASHVILLE,37219,0.5,DUPLEX,820000,36.16781,-86.77775',
    '2,001-003.00,DOE JANE,2021-01-02,410000,300 PINE ST,NASHVILLE,TN,37203,300 PINE ST,NASHVILLE,37203,0.25,SINGLE FAMILY,395000,36.15,-86.79',
    '3,001-004.00,MUSIC CITY LLC,2015-06-30,2100000,PO BOX 5,FRANKLIN,TN,37064,400 OAK AVE,NASHVILLE,37210,1.2,APARTMENT: LOW RISE,2400000,36.14,-86.72',
  ].join('\n');
  const res = assessorToParcels(NASH_HUB, PRESETS.tn, { countyFips: '47037' });

  it('resolves the Own*/Prop*/LUDesc column family', () => {
    expect(res.unresolved).not.toContain('mailing_address');
    expect(res.unresolved).not.toContain('situs_address');
    expect(res.unresolved).not.toContain('property_class');
    expect(res.unresolved).not.toContain('last_sale_price');
    expect(res.unresolved).not.toContain('assessed_value');
  });

  it('keeps DUPLEX and APARTMENT via LUDesc, drops single-family', () => {
    expect(res.kept).toBe(2);
    expect(res.parcels.map((p) => p.apn)).toEqual(['001-002.00', '001-004.00']);
  });

  it('maps ownership, sale, and appraisal fields', () => {
    const p = res.parcels[0];
    expect(p.owner_name).toBe('NASHVILLE RENTALS, LP');
    expect(p.mailing_address).toBe('100 BROADWAY');
    expect(p.situs_address).toBe('200 CHURCH ST');
    expect(p.last_sale_date).toBe('2018-05-12');
    expect(p.last_sale_price).toBe(750000);
    expect(p.assessed_value).toBe(820000);
    expect(p.absentee).toBe(true);
  });

  it('converts an Acres lot column to square feet', () => {
    expect(res.parcels[0].lot_sqft).toBe(Math.round(0.5 * 43560));
    expect(res.parcels[1].lot_sqft).toBe(Math.round(1.2 * 43560));
  });

  it('infers unit counts from the class text when no units column exists', () => {
    expect(res.parcels[0].units).toBe(2); // DUPLEX
    expect(res.parcels[1].units).toBeNull(); // APARTMENT: LOW RISE — count unknown
  });

  it('captures coordinates for Street View links', () => {
    expect(res.parcels[0].lat).toBeCloseTo(36.16781);
    expect(res.parcels[0].lng).toBeCloseTo(-86.77775);
  });
});

describe('unitsFromClass', () => {
  it('reads plex sizes out of land-use descriptions', () => {
    expect(unitsFromClass('DUPLEX')).toBe(2);
    expect(unitsFromClass('Residential Triplex')).toBe(3);
    expect(unitsFromClass('QUADPLEX')).toBe(4);
    expect(unitsFromClass('FOURPLEX')).toBe(4);
    expect(unitsFromClass('TWO FAMILY')).toBe(2);
    expect(unitsFromClass('APARTMENT: HIGH RISE')).toBeNull();
    expect(unitsFromClass('')).toBeNull();
  });
});

describe('assessorToParcels — TN preset', () => {
  const res = assessorToParcels(TN_FIXTURE, PRESETS.tn, { countyFips: '47037' });

  it('keeps units>=2 and class-matched rows, drops the SFR', () => {
    expect(res.kept).toBe(2);
    expect(res.parcels.map((p) => p.apn)).toEqual(['001-002.00', '001-003.00']);
  });

  it('applies the CLI-passed county fips', () => {
    for (const p of res.parcels) expect(p.county_fips).toBe('47037');
  });

  it('handles quoted owner names with embedded commas', () => {
    expect(res.parcels[0].owner_name).toBe('NASHVILLE RENTALS, LP');
    expect(res.parcels[0].owner_is_entity).toBe(true);
  });

  it('parses ArcGIS-style timestamps down to the date', () => {
    const csv = [
      'ParID,Owner,OwnAddr1,OwnZip,PropAddr,PropZip,LUDesc,OwnDate',
      '1,X LLC,PO BOX 1,00001,1 A ST,00002,DUPLEX,2018/05/12 00:00:00+00',
      '2,Y LLC,PO BOX 2,00001,2 A ST,00002,DUPLEX,2021-03-04T05:06:07Z',
    ].join('\n');
    const r = assessorToParcels(csv, PRESETS.tn, { countyFips: '47037' });
    expect(r.parcels[0].last_sale_date).toBe('2018-05-12');
    expect(r.parcels[1].last_sale_date).toBe('2021-03-04');
  });

  it('parses MM/DD/YYYY dates and real unit counts', () => {
    expect(res.parcels[0].last_sale_date).toBe('2018-05-12');
    expect(res.parcels[0].units).toBe(6);
    expect(res.parcels[1].units).toBe(2);
  });

  it('flags the Broadway mailer as absentee, the owner-occupant not', () => {
    expect(res.parcels[0].absentee).toBe(true);
    expect(res.parcels[1].absentee).toBe(false);
  });

  it('returns empty results for a header-only file', () => {
    const empty = assessorToParcels('PARID,OWNER', PRESETS.tn, { countyFips: '47037' });
    expect(empty).toEqual({ parcels: [], total: 0, kept: 0, dropped: 0, unresolved: [] });
  });
});
