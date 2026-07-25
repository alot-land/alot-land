import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as mf from '@alot/mf-calc';
import { listAllRentBands, getRentEstimate, saveRentEstimate, fetchRentEstimate } from '../lib/queries';
import { buildZipRents, buildZipBedroomRatios, zipRentForUnit, addrKey } from '../lib/parcelscreen';
import { usd } from '../lib/format';
import { Tip } from './fields';

/**
 * Market-rent assistant for the unit mix.
 *
 * Two ladders, cheapest first:
 *  1. FREE — the blended ZORI zip rent, reshaped to each unit type's bedroom
 *     count using HUD Small Area FMR ratios. Costs nothing, runs offline.
 *  2. PAID — an address-level RentCast estimate via the serverless proxy.
 *     Only on an explicit click, cached forever after, because the free tier
 *     is 50 requests a month.
 *
 * Nothing is written into the unit mix without pressing Apply — rents stay
 * operator-owned, the way the rent-bands card has always worked.
 */
export default function RentEstimator({ orgId, userId, zip, address, city, state, units, onApply }) {
  const [busy, setBusy] = useState(false);
  const [apiResult, setApiResult] = useState(null);
  const [apiError, setApiError] = useState(null);

  const bands = useQuery({
    queryKey: ['rent-bands-all', orgId],
    queryFn: () => listAllRentBands(orgId),
    enabled: !!orgId,
    staleTime: 30 * 60 * 1000,
  });

  const { zipRents, ratios } = useMemo(
    () => ({ zipRents: buildZipRents(bands.data), ratios: buildZipBedroomRatios(bands.data) }),
    [bands.data],
  );

  // One suggestion per unit TYPE, at that type's bedroom count.
  const suggestions = useMemo(() => {
    if (!zip) return [];
    return (units || []).map((u) => {
      const bedrooms = mf.bedroomsFromLabel(u.type);
      const got = zipRentForUnit(zip, { zipRents, bedroomRatios: ratios, bedrooms });
      return { type: u.type, bedrooms, ...got };
    });
  }, [units, zip, zipRents, ratios]);

  const usable = suggestions.filter((s) => s.rent != null);
  const anyAdjusted = usable.some((s) => s.basis === 'safmr_adjusted');
  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');

  function applyZip() {
    const next = (units || []).map((u, i) => {
      const s = suggestions[i];
      return s?.rent != null ? { ...u, market_rent: Math.round(s.rent) } : u;
    });
    onApply(next);
  }

  function applyApi(rent) {
    // Apply to the unit type whose bedroom count the estimate was priced at,
    // or to everything when the mix is a single type.
    const beds = apiResult?.bedrooms ?? null;
    const next = (units || []).map((u) => {
      const b = mf.bedroomsFromLabel(u.type);
      if (units.length === 1 || beds == null || b === beds) return { ...u, market_rent: Math.round(rent) };
      return u;
    });
    onApply(next);
  }

  async function fetchApi() {
    setBusy(true);
    setApiError(null);
    try {
      const first = (units || [])[0] || {};
      const bedrooms = mf.bedroomsFromLabel(first.type);
      const key = addrKey(address, zip);
      // Cache first — a repeat click must never spend a request.
      if (key) {
        const cached = await getRentEstimate(orgId, key, bedrooms);
        if (cached) {
          setApiResult({ ...cached, bedrooms, cached: true });
          return;
        }
      }
      const got = await fetchRentEstimate({
        address: fullAddress,
        bedrooms,
        squareFootage: first.sqft || null,
      });
      setApiResult({ ...got, bedrooms, cached: false });
      if (key) {
        await saveRentEstimate(orgId, userId, {
          addr_key: key,
          address: fullAddress,
          bedrooms: bedrooms ?? null,
          rent: got.rent,
          rent_low: got.rent_low,
          rent_high: got.rent_high,
          comp_count: got.comp_count,
          source: got.source || 'rentcast',
          fetched_at: got.fetched_at || new Date().toISOString(),
        }).catch(() => {}); // caching is best-effort; never block the estimate
      }
    } catch (e) {
      setApiError(e.code === 'not_configured'
        ? 'No RentCast key configured — the free ZIP estimate above is what you have. See the Guide to add one.'
        : e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!zip || String(zip).length < 5) return null;

  return (
    <div className="bg-surface-2 rounded-xl p-3 text-sm">
      <div className="flex items-center flex-wrap gap-2 mb-2">
        <span className="font-medium">Market rent estimate</span>
        <Tip text="Free path: the blended ZIP rent from Zillow ZORI, reshaped to each unit type's bedroom count using HUD Small Area FMR ratios (SAFMR levels are policy figures, so only the RATIOS between bedroom counts are used — never the level itself). Paid path: an address-level RentCast estimate, fetched only when you click and cached forever after. Nothing changes your unit mix until you press Apply." />
        {anyAdjusted && (
          <span className="pill bg-green/15 text-green-deep text-xs">bedroom-adjusted</span>
        )}
      </div>

      {usable.length === 0 ? (
        <p className="text-muted">
          No rent band for ZIP {zip} yet — run <code className="text-xs">node bin/rents.mjs</code> in{' '}
          <code className="text-xs">workers/scan</code>.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {usable.map((s, i) => (
              <span key={i} className="tabular-nums">
                <span className="text-muted">{s.type}</span>{' '}
                <span className="font-medium">{usd(s.rent)}</span>
                <span className="text-xs text-muted">
                  /mo · {s.basis === 'safmr_adjusted' ? `${s.bedrooms}bd-adjusted` : 'ZIP blend'}
                </span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" onClick={applyZip} className="btn-ghost text-sm py-1">
              Apply to unit mix
            </button>
            <button type="button" onClick={fetchApi} disabled={busy || !address} className="btn-ghost text-sm py-1">
              {busy ? 'Fetching…' : '↻ Address-level (RentCast)'}
            </button>
            {!anyAdjusted && (
              <span className="text-xs text-muted">
                blended only — run <code>node bin/hudfmr.mjs</code> for bedroom adjustment
              </span>
            )}
          </div>
        </>
      )}

      {apiError && <p className="text-xs text-warn mt-2">{apiError}</p>}

      {apiResult && (
        <div className="mt-3 pt-2 border-t border-border">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium tabular-nums">{usd(apiResult.rent)}/mo</span>
            {apiResult.rent_low != null && apiResult.rent_high != null && (
              <span className="text-xs text-muted tabular-nums">
                range {usd(apiResult.rent_low)}–{usd(apiResult.rent_high)}
              </span>
            )}
            {apiResult.comp_count != null && (
              <span className="text-xs text-muted">{apiResult.comp_count} comps</span>
            )}
            <span className="pill bg-blue/15 text-blue text-xs">
              RentCast{apiResult.bedrooms != null ? ` · ${apiResult.bedrooms}bd` : ''}
              {apiResult.cached ? ' · cached' : ''}
            </span>
            <button type="button" onClick={() => applyApi(apiResult.rent)} className="btn-ghost text-sm py-1">
              Apply
            </button>
          </div>
          {apiResult.fetched_at && (
            <div className="text-xs text-muted mt-1">
              fetched {new Date(apiResult.fetched_at).toLocaleDateString()}
              {apiResult.cached && ' — no new request was spent'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
