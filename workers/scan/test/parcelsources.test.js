import { describe, it, expect } from 'vitest';
import {
  extractLinks,
  pickMaricopaFiles,
  socrataPickDataset,
  socrataCsvUrl,
  hubDownloadUrl,
  NASHVILLE_HUB_DATASETS,
  mergeOwnership,
} from '../lib/parcelsources.js';
import { looksLikeEntity, isAbsentee } from '../lib/assessor.js';

describe('extractLinks', () => {
  it('resolves relative and absolute hrefs against the page URL', () => {
    const html = `
      <a href="/data-sales/Apartment_Master.zip">Apartments</a>
      <a href='https://ftp.mcassessor.maricopa.gov/data-sales/Ownership.zip'>Own</a>
      <a href="../other/page.html">x</a>`;
    const links = extractLinks(html, 'https://www.mcassessor.maricopa.gov/page/data_sales/');
    expect(links).toContain('https://www.mcassessor.maricopa.gov/data-sales/Apartment_Master.zip');
    expect(links).toContain('https://ftp.mcassessor.maricopa.gov/data-sales/Ownership.zip');
  });

  it('dedupes and skips malformed hrefs', () => {
    const html = '<a href="a.zip"></a><a href="a.zip"></a><a href="http://[bad">x</a>';
    expect(extractLinks(html, 'https://x.test/')).toEqual(['https://x.test/a.zip']);
  });
});

describe('pickMaricopaFiles', () => {
  const links = [
    'https://ftp.test/data-sales/Sales_Master.zip',
    'https://ftp.test/data-sales/Apartment_Master.zip',
    'https://ftp.test/data-sales/Parcel_Ownership.zip',
    'https://ftp.test/page/help.html',
  ];

  it('finds the apartment and ownership files, ignores pages', () => {
    const f = pickMaricopaFiles(links);
    expect(f.apartment).toBe('https://ftp.test/data-sales/Apartment_Master.zip');
    expect(f.ownership).toBe('https://ftp.test/data-sales/Parcel_Ownership.zip');
    expect(f.all).toHaveLength(3);
  });

  it('returns nulls when nothing matches', () => {
    const f = pickMaricopaFiles(['https://x.test/readme.html']);
    expect(f.apartment).toBeNull();
    expect(f.ownership).toBeNull();
  });
});

describe('socrataPickDataset', () => {
  it('picks the dataset whose columns cover the assessor fields', () => {
    const catalog = {
      results: [
        { resource: { id: 'aaaa-1111', name: 'Zoning Map Layers', type: 'dataset', columns_field_name: ['zone', 'geom', 'area', 'label', 'id'] } },
        {
          resource: {
            id: 'bbbb-2222',
            name: 'Property Assessor Parcel Data',
            type: 'dataset',
            columns_field_name: ['apn', 'owner_name', 'mailing_address', 'mailing_city', 'land_use_description', 'units', 'property_address'],
          },
        },
        { resource: { id: 'cccc-3333', name: 'Assessor Lookup Codes', type: 'dataset', columns_field_name: ['code', 'description'] } },
      ],
    };
    const ds = socrataPickDataset(catalog);
    expect(ds.id).toBe('bbbb-2222');
  });

  it('returns null when no result is assessor-shaped', () => {
    const catalog = {
      results: [{ resource: { id: 'x', name: 'Bike Lanes', type: 'dataset', columns_field_name: ['route', 'miles', 'surface', 'year', 'district'] } }],
    };
    expect(socrataPickDataset(catalog)).toBeNull();
    expect(socrataPickDataset({ results: [] })).toBeNull();
  });
});

describe('hubDownloadUrl', () => {
  it('builds the ArcGIS Hub CSV download URL for the known Nashville dataset', () => {
    expect(NASHVILLE_HUB_DATASETS.length).toBeGreaterThan(0);
    expect(hubDownloadUrl('abc123_0')).toBe(
      'https://hub.arcgis.com/api/v3/datasets/abc123_0/downloads/data?format=csv&spatialRefId=4326',
    );
  });
});

describe('socrataCsvUrl', () => {
  it('builds a paged CSV export URL', () => {
    expect(socrataCsvUrl('data.nashville.gov', 'bbbb-2222', { limit: 1000, offset: 2000 })).toBe(
      'https://data.nashville.gov/resource/bbbb-2222.csv?$limit=1000&$offset=2000&$order=:id',
    );
  });
});

describe('mergeOwnership', () => {
  it('backfills owner/mailing by normalized APN and recomputes flags', () => {
    const parcels = [
      { apn: '111-22-333', situs_address: '123 E MAIN ST', situs_zip: '85004', owner_name: null, mailing_address: null, owner_is_entity: false, absentee: false },
      { apn: '111-22-334', situs_address: '456 W OAK AVE', situs_zip: '85007', owner_name: null, mailing_address: null, owner_is_entity: false, absentee: false },
      { apn: '999-99-999', situs_address: '1 NOWHERE RD', situs_zip: '85000', owner_name: null, mailing_address: null, owner_is_entity: false, absentee: false },
    ];
    const ownership = [
      { apn: '11122333', owner_name: 'SMITH JOHN', mailing_address: '123 E MAIN STREET', mailing_city: 'PHOENIX', mailing_state: 'AZ', mailing_zip: '85004' },
      { apn: '111 22 334', owner_name: 'DESERT HOLDINGS LLC', mailing_address: 'PO BOX 99', mailing_city: 'SCOTTSDALE', mailing_state: 'AZ', mailing_zip: '85251' },
    ];
    const { merged } = mergeOwnership(parcels, ownership, { looksLikeEntity, isAbsentee });
    expect(merged).toBe(2);
    expect(parcels[0].owner_name).toBe('SMITH JOHN');
    expect(parcels[0].absentee).toBe(false); // same street, suffix normalized
    expect(parcels[1].owner_is_entity).toBe(true);
    expect(parcels[1].absentee).toBe(true); // PO box elsewhere
    expect(parcels[2].owner_name).toBeNull(); // no ownership row → untouched
  });

  it('never overwrites data the primary file already had', () => {
    const parcels = [{ apn: '1', situs_address: 'X', situs_zip: '1', owner_name: 'KEEP ME', mailing_address: null, owner_is_entity: false, absentee: false }];
    const ownership = [{ apn: '1', owner_name: 'CLOBBER', mailing_address: 'PO BOX 1', mailing_zip: '2' }];
    mergeOwnership(parcels, ownership, { looksLikeEntity, isAbsentee });
    expect(parcels[0].owner_name).toBe('KEEP ME');
    expect(parcels[0].mailing_address).toBe('PO BOX 1');
  });
});
