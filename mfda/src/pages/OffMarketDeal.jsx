import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import {
  getParcel,
  setParcelRating,
  listAllRentBands,
  listMarkets,
  upsertDeal,
  replaceUnits,
  findDealByDedupeKey,
  dedupeKey,
} from '../lib/queries';
import { buildZipRents, presetForState, parcelDealInput, streetViewUrl } from '../lib/parcelscreen';
import RatingControl from '../components/RatingControl';
import NotesCard from '../components/NotesCard';
import { underwrite } from '../lib/underwrite';
import { usd, pct, num } from '../lib/format';
import { Tip } from '../components/fields';

const VERDICT_STYLES = {
  pursue: 'bg-green/15 text-green-deep',
  consider: 'bg-gold/20 text-warn',
  pass: 'bg-surface-2 text-muted',
};

function holdYears(d) {
  if (!d) return null;
  const y = (Date.now() - new Date(d).getTime()) / (365.25 * 86400e3);
  return y > 0 ? Math.floor(y) : null;
}

export default function OffMarketDeal() {
  const { id } = useParams();
  const { org } = useOrg();
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const parcel = useQuery({ queryKey: ['parcel', id], queryFn: () => getParcel(id) });
  const bands = useQuery({
    queryKey: ['rent-bands-all', org?.id],
    queryFn: () => listAllRentBands(org.id),
    enabled: !!org,
    staleTime: 30 * 60 * 1000,
  });
  const markets = useQuery({
    queryKey: ['markets', org?.id],
    queryFn: () => listMarkets(org.id),
    enabled: !!org,
  });

  const zipRents = useMemo(() => buildZipRents(bands.data), [bands.data]);
  const p = parcel.data;
  const zipRent = p?.situs_zip ? zipRents.get(String(p.situs_zip).slice(0, 5)) ?? null : null;

  // Editable assumptions, seeded from data. Empty string = not yet known.
  const [unitsIn, setUnitsIn] = useState(null);
  const [rentIn, setRentIn] = useState(null);
  const [anchorIn, setAnchorIn] = useState(null);
  const units = unitsIn ?? p?.units ?? '';
  const rent = rentIn ?? (zipRent != null ? Math.round(zipRent) : '');
  const anchor = anchorIn ?? (p?.assessed_value != null ? Number(p.assessed_value) : '');

  const preset = useMemo(() => presetForState(markets.data, p?.state), [markets.data, p?.state]);

  const out = useMemo(() => {
    if (!(Number(units) > 0 && Number(rent) > 0 && Number(anchor) > 0)) return null;
    try {
      return underwrite(
        parcelDealInput(p, {
          units: Number(units),
          rentPerUnit: Number(rent),
          anchor: Number(anchor),
          preset,
        }),
      );
    } catch (e) {
      console.error('parcel underwrite', e);
      return null;
    }
  }, [p, units, rent, anchor, preset]);

  async function rate(rating) {
    qc.setQueryData(['parcel', id], { ...p, rating });
    try {
      await setParcelRating(id, rating);
      qc.invalidateQueries({ queryKey: ['parcels'] });
    } catch {
      qc.invalidateQueries({ queryKey: ['parcel', id] });
    }
  }

  // Promote to a real deal (prefilled) for the full manual workflow + PDF.
  async function analyzeAsDeal() {
    setCreating(true);
    setCreateError(null);
    try {
      // Already promoted (or matches an existing scraped listing)? Go there —
      // a second insert would violate the unique deal key and die silently.
      const existing = await findDealByDedupeKey(
        org.id,
        dedupeKey({ apn: p.apn, county_fips: p.county_fips, address: p.situs_address, city: p.situs_city, state: p.state, zip: p.situs_zip }),
      );
      if (existing) {
        nav(`/deals/${existing.id}/edit`);
        return;
      }
      const deal = await upsertDeal(org.id, user.id, {
        apn: p.apn,
        county_fips: p.county_fips,
        address: p.situs_address,
        city: p.situs_city,
        state: p.state,
        zip: p.situs_zip,
        status: 'analyzing',
        units_count: Number(units) || p.units,
        year_built: p.year_built,
        price: Number(anchor) || null,
        source: 'offmarket',
        notes: `Off-market parcel APN ${p.apn}. Owner: ${p.owner_name || 'unknown'}${p.absentee ? ' (absentee)' : ''}. Mailing: ${[p.mailing_address, p.mailing_city, p.mailing_state, p.mailing_zip].filter(Boolean).join(', ')}`,
      });
      if (Number(units) > 0 && Number(rent) > 0) {
        await replaceUnits(org.id, deal.id, [
          { type: 'avg unit', count: Number(units), sqft: null, actual_rent: null, market_rent: Number(rent) },
        ]);
      }
      qc.invalidateQueries({ queryKey: ['deals', org.id] });
      nav(`/deals/${deal.id}/edit`);
    } catch (e) {
      console.error('analyzeAsDeal', e);
      setCreateError(e.message || 'Could not create the deal.');
    } finally {
      setCreating(false);
    }
  }

  if (parcel.isLoading) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (parcel.error || !p) return <div className="p-10 text-center text-danger">Parcel not found.</div>;

  const held = holdYears(p.last_sale_date);
  const score = out?.score;
  const verdict = out ? (score?.pursue ? 'pursue' : score?.score >= 50 ? 'consider' : 'pass') : null;
  const mo = out?.solvers?.max_offer;
  const dscrFin = out?.financing?.dscr;
  const pf = out?.proforma;
  const lastYear = pf?.years?.[pf.years.length - 1];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/off-market" className="text-sm text-muted hover:underline">← Off-Market</Link>
          <h1 className="font-display text-2xl font-semibold">{p.situs_address || `APN ${p.apn}`}</h1>
          <p className="text-muted text-sm">
            {[p.situs_city, p.state, p.situs_zip].filter(Boolean).join(', ')} · APN {p.apn}
            {p.property_class && <> · {p.property_class}</>}
            {streetViewUrl(p) && (
              <>
                {' · '}
                <a href={streetViewUrl(p)} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                  Street View ↗
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RatingControl value={p.rating} onChange={rate} size="text-2xl" />
          <button type="button" onClick={analyzeAsDeal} disabled={creating} className="btn-primary text-sm disabled:opacity-50">
            {creating ? 'Creating…' : 'Analyze as deal →'}
          </button>
        </div>
      </div>
      {createError && <div className="text-danger text-sm mt-2">Analyze as deal failed: {createError}</div>}

      {/* Owner card — this is who gets the mail/call */}
      <div className="card p-4 mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{p.owner_name || 'Owner unknown'}</span>
          {p.owner_is_entity && <span className="pill bg-blue/15 text-blue">entity</span>}
          {p.absentee && <span className="pill bg-gold/20 text-warn">absentee</span>}
          {held != null && (
            <span className="pill bg-surface-2 text-ink-2">
              held {held} yr{held === 1 ? '' : 's'}
            </span>
          )}
          {p.last_sale_price && (
            <span className="text-xs text-muted">
              bought {usd(Number(p.last_sale_price))} {p.last_sale_date && `(${p.last_sale_date.slice(0, 4)})`}
            </span>
          )}
        </div>
        <div className="text-sm text-ink-2 mt-1">
          Mails to: {[p.mailing_address, p.mailing_city, p.mailing_state, p.mailing_zip].filter(Boolean).join(', ') || '—'}
        </div>
      </div>

      {/* Assumptions — editable, provenance-labeled */}
      <div className="card p-4 mt-4">
        <div className="text-sm font-medium mb-2">
          Screening assumptions
          <Tip text="Off-market properties have no asking price or rent roll, so this screen runs on estimates: rent from the Zillow zip band, value from the county's appraisal, expenses at standard rates. Edit any number — everything below recalculates instantly through the same tested engine as regular deals." />
        </div>
        <div className="flex flex-wrap gap-4">
          {[
            ['Units', units, (v) => setUnitsIn(v), p.units != null ? 'from county class' : 'unknown — enter it', 'Real unit count. Duplex/triplex classes fill this automatically; apartments need you to enter it (check the listing photos, a call, or the county card).'],
            ['Rent / unit / mo', rent, (v) => setRentIn(v), zipRent != null ? `ZORI zip ${p.situs_zip}` : 'no zip band — enter it', 'Estimated market rent per unit. Seeded from the Zillow rent index for this ZIP (blended across sizes); refine with local knowledge.'],
            ['Value anchor', anchor, (v) => setAnchorIn(v), 'county appraisal', 'The county\'s appraised value — the starting guess at worth, NOT a sale price. The max-offer solver works independently of it.'],
          ].map(([label, value, set, prov, tip]) => (
            <label key={label} className="flex flex-col gap-0.5 text-xs text-muted">
              <span className="flex items-center">{label}<Tip text={tip} /></span>
              <input
                className="input w-36 text-sm"
                type="number"
                value={value}
                onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <span className="text-[10px]">{prov}</span>
            </label>
          ))}
        </div>
      </div>

      {!out && (
        <div className="card p-8 mt-4 text-center">
          <p className="font-medium">Enter the missing assumptions above to run the numbers</p>
          <p className="text-muted text-sm mt-1">
            The screen needs a unit count, a rent estimate, and a value anchor. Apartment parcels
            often need the unit count typed in — the county class doesn’t state it.
          </p>
        </div>
      )}

      {out && (
        <>
          {/* Verdict */}
          <div className="card p-4 mt-4 flex flex-wrap items-center gap-4">
            <div className="stat">{Math.round(score.score)}</div>
            <span className={`pill ${VERDICT_STYLES[verdict]} text-sm px-3 py-1 capitalize`}>{verdict}</span>
            <div className="text-sm text-ink-2">
              {verdict === 'pursue' && 'Clears your buy box at the anchor value — flag it and get in touch.'}
              {verdict === 'consider' && 'Close to the buy box — likely works at the max offer below. Worth a conversation.'}
              {verdict === 'pass' && 'Doesn’t pencil at these estimates — only worth it well below the max offer.'}
            </div>
            <div className="ml-auto text-xs text-muted">calc v{out.calc_version}</div>
          </div>

          {/* The three headline numbers David asked for */}
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            <div className="card p-4">
              <div className="text-xs text-muted flex items-center">
                Max allowable offer
                <Tip text="The highest price at which this property still meets your targets (DSCR ≥ 1.2 and 8% cash-on-cash at 75% LTV), with property tax re-assessed at each price tested. Your negotiating ceiling — offers should start well below it." />
              </div>
              <div className="stat text-green-deep">{mo ? usd(mo.max_offer) : '—'}</div>
              {mo && Number(anchor) > 0 && (
                <div className="text-xs text-muted mt-1">
                  {mo.max_offer >= Number(anchor)
                    ? `${pct((mo.max_offer - anchor) / anchor, 0)} above the county value — room to pay up`
                    : `${pct((anchor - mo.max_offer) / anchor, 0)} below county value — needs a motivated seller`}
                </div>
              )}
            </div>
            <div className="card p-4">
              <div className="text-xs text-muted flex items-center">
                Est. NOI today
                <Tip text="What the property likely earns per year at market rents: income minus vacancy and standard operating expenses (insurance, management, repairs, utilities, reserves, re-assessed taxes). The owner's actual books may differ — this is the market-rent estimate." />
              </div>
              <div className="stat">{usd(out.derived.noi)}</div>
              <div className="text-xs text-muted mt-1">
                {usd(out.derived.gpr_market)} gross · cap {pct(out.derived.cap_rate_on_price, 1)} on anchor
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-muted flex items-center">
                What it could make
                <Tip text="Year-by-year projection at the anchor price with 75% financing: annual cash flow after debt service in year 1, growing with rents, plus the projected equity check at a year-5 sale (exit at cap rate, loan paid down)." />
              </div>
              <div className="stat">{dscrFin ? `${usd(dscrFin.cfbt)}/yr` : '—'}</div>
              {lastYear && (
                <div className="text-xs text-muted mt-1">
                  → {usd(lastYear.cfbt)}/yr by year {pf.years.length}
                  {pf.exit && <> · {usd(pf.exit.net_sale_proceeds)} exit equity</>}
                </div>
              )}
            </div>
          </div>

          {/* Financing snapshot */}
          <div className="card p-4 mt-4">
            <div className="text-sm font-medium mb-2">
              At the anchor price with a 75% loan
              <Tip text="A quick reality check at the county's value. If these numbers already work at full county value, anything you negotiate below it is upside." />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {[
                ['DSCR', dscrFin ? dscrFin.dscr.toFixed(2) : '—', 'Net income ÷ loan payments. Lenders want ≥ 1.20–1.25.'],
                ['Cash-on-cash', dscrFin ? pct(dscrFin.cash_on_cash, 1) : '—', 'Year-1 cash flow ÷ cash invested.'],
                ['5-yr IRR', dscrFin ? pct(dscrFin.irr, 1) : '—', 'Annualized total return including cash flows and the year-5 sale.'],
                ['Break-even occupancy', dscrFin ? pct(dscrFin.break_even_occupancy, 0) : '—', 'The occupancy where cash flow hits zero — lower is safer.'],
              ].map(([label, value, tip]) => (
                <div key={label}>
                  <div className="text-xs text-muted flex items-center">{label}<Tip text={tip} /></div>
                  <div className="font-medium tabular-nums">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Seller finance — the off-market superpower */}
          {out.financing.seller_offers && (
            <div className="card p-4 mt-4">
              <div className="text-sm font-medium mb-2">
                Seller-finance openers
                <Tip text="Off-market owners with big equity (long holds) can often carry financing — great for them (spread income, taxes) and you (low rate, low down). Three ready-to-discuss structures, computed from the anchor value." />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="th">Structure</th>
                      <th className="th text-right">Price</th>
                      <th className="th text-right">Down</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">Monthly P&I</th>
                    </tr>
                  </thead>
                  <tbody>
                    {out.financing.seller_offers.map((o) => (
                      <tr key={o.label}>
                        <td className="td">{o.label}</td>
                        <td className="td text-right">{usd(o.price)}</td>
                        <td className="td text-right">{usd(o.down_payment)}</td>
                        <td className="td text-right">{pct(o.rate, 1)}</td>
                        <td className="td text-right">{usd(o.monthly_payment)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-muted mt-4">
            Estimates, honestly labeled: rents from the Zillow zip index, value from the county
            appraisal ({p.assessed_value ? usd(Number(p.assessed_value)) : '—'}), expenses at
            standard rates ({num(Number(units))} units). For a full underwrite with real rents,
            comps, tax layers, and a printable report, hit <b>Analyze as deal</b>.
          </p>
        </>
      )}

      <NotesCard entityType="parcel" entityId={id} />
    </div>
  );
}
