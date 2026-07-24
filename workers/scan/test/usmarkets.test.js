import { describe, it, expect } from 'vitest';
import { zillowSnapshots, acsMap, nriMap, gazetteerMap, buildMarketStats } from '../lib/usmarkets.js';

// 61 monthly columns so the 60-months-back snapshot has a real home.
const months = [];
for (let i = 0; i <= 60; i++) {
  const y = 2021 + Math.floor(i / 12);
  const m = (i % 12) + 1;
  months.push(`${y}-${String(m).padStart(2, '0')}-28`);
}

function zillowCsv(rows) {
  const head = `RegionID,SizeRank,RegionName,RegionType,StateName,State,Metro,StateCodeFIPS,MunicipalCodeFIPS,${months.join(',')}`;
  return [head, ...rows].join('\n');
}

describe('zillowSnapshots', () => {
  const series = Array.from({ length: 61 }, (_, i) => 300000 + i * 1000); // start 300k → 360k
  const csv = zillowCsv([
    `102001,1,"Maricopa County",county,Arizona,AZ,"Phoenix, AZ",4,13,${series.join(',')}`,
    `102002,2,"Davidson County",county,Tennessee,TN,"Nashville, TN",47,37,${series.map((v) => v + 50000).join(',')}`,
  ]);
  const snap = zillowSnapshots(csv);

  it('keys by zero-padded 5-digit FIPS', () => {
    expect([...snap.keys()].sort()).toEqual(['04013', '47037']);
  });

  it('captures now / 12mo / 60mo snapshots', () => {
    const m = snap.get('04013');
    expect(m.now).toBe(360000);
    expect(m.y1).toBe(348000); // 12 columns back
    expect(m.y5).toBe(300000); // 60 columns back (series start)
    expect(m.state).toBe('AZ');
  });

  it('walks back past trailing blanks for the latest value', () => {
    const s2 = [...series];
    s2[60] = '';
    const snap2 = zillowSnapshots(zillowCsv([`1,1,"X",county,Arizona,AZ,"M",4,13,${s2.join(',')}`]));
    expect(snap2.get('04013').now).toBe(359000);
  });
});

describe('acsMap', () => {
  const json = [
    ['NAME', 'B01003_001E', 'B25077_001E', 'state', 'county'],
    ['Maricopa County, Arizona', '4500000', '480000', '04', '013'],
    ['Perry County, Tennessee', '8500', '-666666666', '47', '135'],
  ];
  const m = acsMap(json, { population: 'B01003_001E', median_home_value: 'B25077_001E' });

  it('maps FIPS to named fields', () => {
    expect(m.get('04013')).toEqual({ population: 4500000, median_home_value: 480000 });
  });

  it('turns ACS sentinel values into null', () => {
    expect(m.get('47135').median_home_value).toBeNull();
    expect(m.get('47135').population).toBe(8500);
  });
});

describe('nriMap', () => {
  const csv = ['STCOFIPS,RISK_SCORE,RISK_RATNG,OTHER', '04013,22.5,Relatively Moderate,x', '47037,15.1,Relatively Low,y'].join('\n');
  it('extracts score and rating by FIPS', () => {
    const m = nriMap(csv);
    expect(m.get('04013')).toEqual({ nri_score: 22.5, nri_rating: 'Relatively Moderate' });
  });
});

describe('gazetteerMap', () => {
  const txt = [
    'USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG',
    'AZ\t04013\t00025806\tMaricopa County\t23890000000\t65000000\t9224.27\t25.1\t33.348359\t-112.491815',
  ].join('\n');
  it('extracts centroid and land area', () => {
    const g = gazetteerMap(txt).get('04013');
    expect(g.lat).toBeCloseTo(33.348359);
    expect(g.lng).toBeCloseTo(-112.491815);
    expect(g.land_sqmi).toBeCloseTo(9224.27);
    expect(g.state).toBe('AZ');
  });
});

describe('buildMarketStats', () => {
  it('joins all sources on FIPS with ZHVI as the base set', () => {
    const zhvi = new Map([['04013', { now: 480000, y1: 460000, y5: 330000, name: 'Maricopa County', state: 'AZ' }]]);
    const zori = new Map([['04013', { now: 2100, y1: 2020, y5: 1500 }]]);
    const acsNow = new Map([['04013', { population: 4500000, median_home_value: 420000, median_re_tax: 2016, renters: 590000, occupied_units: 1640000, vacant_for_rent: 40000 }]]);
    const acsOld = new Map([['04013', { population: 4200000 }]]);
    const nri = new Map([['04013', { nri_score: 22.5, nri_rating: 'Relatively Moderate' }]]);
    const gaz = new Map([['04013', { name: 'Maricopa County', state: 'AZ', lat: 33.35, lng: -112.49, land_sqmi: 9224 }]]);

    const rows = buildMarketStats({ zhvi, zori, acsNow, acsOld, nri, gaz });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.geo_id).toBe('04013');
    expect(r.zhvi_now).toBe(480000);
    expect(r.zori_5y).toBe(1500);
    expect(r.pop_5y_ago).toBe(4200000);
    expect(r.median_re_tax).toBe(2016);
    expect(r.nri_rating).toBe('Relatively Moderate');
    expect(r.lat).toBeCloseTo(33.35);
    expect(r.land_sqmi).toBe(9224);
  });

  it('missing joins leave nulls, and non-ZHVI counties are excluded', () => {
    const zhvi = new Map([['04013', { now: 480000, y1: null, y5: null, name: 'Maricopa', state: 'AZ' }]]);
    const nri = new Map([['99999', { nri_score: 1, nri_rating: 'x' }]]);
    const rows = buildMarketStats({ zhvi, nri });
    expect(rows).toHaveLength(1);
    expect(rows[0].zori_now).toBeNull();
    expect(rows[0].nri_score).toBeNull();
  });
});
