import { describe, it, expect } from 'vitest';
import {
  extractLinks,
  extractFileUrls,
  pickMaricopaFiles,
  socrataPickDataset,
  socrataCsvUrl,
  hubDownloadUrl,
  NASHVILLE_HUB_DATASETS,
  mergeOwnership,
} from '../lib/parcelsources.js';
import {
  restCatalogServices,
  rankParcelServices,
  arcgisLayerFromMeta,
  arcgisQueryUrl,
  pickClassField,
  pickMaricopaService,
  layerFieldNames,
  featuresToRows,
  rowsToCsv,
} from '../lib/parcelsources.js';
import { looksLikeEntity, isAbsentee, assessorToParcels, PRESETS } from '../lib/assessor.js';

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

describe('extractFileUrls', () => {
  it('finds file URLs embedded in scripts and JSON, not just hrefs', () => {
    const page = `
      <a href="/data-sales/Sales.zip">sales</a>
      <script>var files = {"apartment":"https:\\/\\/ftp.mcassessor.maricopa.gov\\/data-sales\\/Apartment_Master.zip",
        "own": "/file/data-sales/Ownership.zip"};</script>`;
    const urls = extractFileUrls(page, 'https://www.mcassessor.maricopa.gov/page/data_sales/');
    expect(urls).toContain('https://www.mcassessor.maricopa.gov/data-sales/Sales.zip');
    expect(urls).toContain('https://ftp.mcassessor.maricopa.gov/data-sales/Apartment_Master.zip');
    expect(urls).toContain('https://www.mcassessor.maricopa.gov/file/data-sales/Ownership.zip');
  });

  it('ignores non-data links', () => {
    expect(extractFileUrls('<a href="/help.html">x</a> see https://x.test/page', 'https://x.test/')).toEqual([]);
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

describe('county REST services directory (authoritative Maricopa route)', () => {
  it('restCatalogServices lists services with resolvable URLs', () => {
    const json = {
      folders: ['Assessor', 'Elections'],
      services: [
        { name: 'Parcels', type: 'MapServer' },
        { name: 'Assessor/TaxParcels', type: 'FeatureServer' },
      ],
    };
    const cat = restCatalogServices(json, 'https://gis.test/arcgis/rest/services');
    expect(cat.folders).toEqual(['Assessor', 'Elections']);
    expect(cat.services[0].url).toBe('https://gis.test/arcgis/rest/services/Parcels/MapServer');
    // folder-qualified names keep only the service segment against the base
    expect(cat.services[1].url).toBe('https://gis.test/arcgis/rest/services/TaxParcels/FeatureServer');
  });

  it('rankParcelServices puts parcel/assessor services first, drops noise', () => {
    const ranked = rankParcelServices([
      { name: 'ZipCodeGrid', type: 'MapServer' },
      { name: 'TaxParcels', type: 'FeatureServer' },
      { name: 'AssessorParcels', type: 'MapServer' },
      { name: 'ParcelLabels', type: 'MapServer' },
      { name: 'Roads', type: 'MapServer' },
    ]);
    expect(ranked[0].name).toBe('AssessorParcels');
    expect(ranked.map((s) => s.name)).not.toContain('Roads');
    expect(ranked.map((s) => s.name)).not.toContain('ZipCodeGrid');
    // "ParcelLabels" scores 4 - 3 = 1, still above zero but below the real ones
    expect(ranked[ranked.length - 1].name).toBe('ParcelLabels');
  });
});

describe('pickMaricopaService (runtime ArcGIS search)', () => {
  it('picks the county parcel service over unrelated or junk results', () => {
    const search = {
      results: [
        { id: 'j1', title: 'Maricopa Trails', owner: 'MaricopaCountyParks', type: 'Feature Service', snippet: 'hiking', url: 'https://x/1' },
        { id: 'p1', title: 'Parcels', owner: 'MaricopaCountyGIS', type: 'Feature Service', snippet: 'Assessor parcel boundaries with ownership', url: 'https://services.arcgis.com/M/arcgis/rest/services/Parcels/FeatureServer/' },
        { id: 'c1', title: 'Parcels COPY test', owner: 'someuser', type: 'Feature Service', snippet: 'maricopa test copy', url: 'https://x/2' },
        { id: 'm1', title: 'Parcel Map', owner: 'esri', type: 'Web Map', snippet: 'maricopa', url: 'https://x/3' },
      ],
    };
    const svc = pickMaricopaService(search);
    expect(svc.id).toBe('p1');
    expect(svc.url).toBe('https://services.arcgis.com/M/arcgis/rest/services/Parcels/FeatureServer');
  });

  it('returns null when nothing is maricopa-parcel-shaped', () => {
    expect(pickMaricopaService({ results: [{ id: 'x', title: 'Denver Zoning', owner: 'denver', type: 'Feature Service', url: 'https://x' }] })).toBeNull();
    expect(pickMaricopaService({ results: [] })).toBeNull();
  });
});

describe('layerFieldNames', () => {
  it('extracts field names from a layer descriptor', () => {
    expect(layerFieldNames({ fields: [{ name: 'APN' }, { name: 'PUC' }, {}] })).toEqual(['APN', 'PUC']);
    expect(layerFieldNames({})).toEqual([]);
  });
});

describe('ArcGIS helpers (Maricopa GIS route)', () => {
  it('arcgisLayerFromMeta pulls the layer URL and field names', () => {
    const meta = {
      data: {
        attributes: {
          url: 'https://services.arcgis.com/XXX/arcgis/rest/services/Parcels/FeatureServer/0/',
          fields: [{ name: 'APN' }, { name: 'OWNER_NAME' }, { name: 'PUC' }],
        },
      },
    };
    const l = arcgisLayerFromMeta(meta);
    expect(l.url).toBe('https://services.arcgis.com/XXX/arcgis/rest/services/Parcels/FeatureServer/0');
    expect(l.fields).toEqual(['APN', 'OWNER_NAME', 'PUC']);
    expect(arcgisLayerFromMeta({})).toBeNull();
  });

  it('pickClassField prefers PUC, falls back to use/class fields', () => {
    expect(pickClassField(['APN', 'PUC', 'LAND_USE'])).toBe('PUC');
    expect(pickClassField(['APN', 'LandUseCode'])).toBe('LandUseCode');
    expect(pickClassField(['APN', 'ACRES'])).toBeNull();
  });

  it('arcgisQueryUrl builds a paged, geometry-free query', () => {
    const u = arcgisQueryUrl('https://x.test/FeatureServer/0', { where: "PUC LIKE '03%'", offset: 4000 });
    expect(u).toContain('https://x.test/FeatureServer/0/query?');
    expect(u).toContain('where=PUC+LIKE+%2703%25%27');
    expect(u).toContain('returnGeometry=false');
    expect(u).toContain('resultOffset=4000');
  });

  it('featuresToRows → rowsToCsv → assessor parser round-trips API data', () => {
    const json = {
      features: [
        { attributes: { APN: '111-22-333', OWNER_NAME: 'SMITH JOHN', MAIL_ADDRESS: '1 ELSEWHERE RD', MAIL_ZIP: '85251', PHYSICAL_ADDRESS: '123 E MAIN ST', PHYSICAL_ZIP: '85004', PUC: '0324' } },
        { attributes: { APN: '111-22-334', OWNER_NAME: 'X, LLC', MAIL_ADDRESS: 'PO BOX 9', MAIL_ZIP: '85251', PHYSICAL_ADDRESS: '4 OAK AVE', PHYSICAL_ZIP: '85007', PUC: '0101' } },
      ],
    };
    const csv = rowsToCsv(featuresToRows(json));
    const res = assessorToParcels(csv, PRESETS.maricopa);
    expect(res.kept).toBe(1); // 0324 kept, 0101 filtered
    const p = res.parcels[0];
    expect(p.apn).toBe('111-22-333');
    expect(p.owner_name).toBe('SMITH JOHN');
    expect(p.situs_address).toBe('123 E MAIN ST');
    expect(p.mailing_address).toBe('1 ELSEWHERE RD');
    expect(p.absentee).toBe(true);
  });

  it('rowsToCsv quotes commas and unions keys across rows', () => {
    const csv = rowsToCsv([{ A: 'x,y' }, { A: 'z', B: 2 }]);
    expect(csv.split('\n')[0]).toBe('A,B');
    expect(csv).toContain('"x,y"');
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
