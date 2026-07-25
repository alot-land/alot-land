import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useOrg } from '../lib/org';
import { underwrite } from '../lib/underwrite';
import { suggestStrDefaults } from '@alot/mf-calc';
import { usd } from '../lib/format';
import {
  getDeal, getUnits, upsertDeal, replaceUnits, saveScenario, logCost, listMarkets, listScenarios,
  getListingContact,
} from '../lib/queries';
import { Field, TextInput, NumberInput, PercentInput, Section, Grid, Tip } from '../components/fields';
import UnitMixEditor from '../components/UnitMixEditor';
import CompsAssist from '../components/CompsAssist';
import RentBandsCard from '../components/RentBandsCard';

function blankForm() {
  return {
    // property
    address: '', city: '', state: 'AZ', zip: '', apn: '', county_fips: '', year_built: null,
    price: null, status: 'analyzing',
    lat: null, lng: null, beds_total: null, unit_bucket: null,
    market_id: '',
    units: [{ type: '2BR/1BA', count: 4, sqft: 850, actual_rent: 1200, market_rent: 1400 }],
    // income
    rent_basis: 'market', other_income: 0, vacancy_rate: 0.05,
    // expenses (annual $)
    expenses: { insurance: 0, management: 0, utilities: 0, repairs_maintenance: 0, capex_reserve: 0, payroll: 0, other: 0 },
    property_tax_rate: 0.01, assessment_ratio: 1, land_value: 0,
    closing_cost_rate: 0.02, rehab: 0, furnishing: 0,
    // financing
    financing: {
      dscr: { ltv: 0.75, rate: 0.075, amort_years: 30 },
      agency: { ltv: 0.75, rate: 0.07, amort_years: 30 },
      seller: { low_rate: 0.04, mid_rate: 0.06, cash_discount: 0.1, down_fraction: 0.1, amort_years: 30, balloon_years: 5 },
    },
    hold_years: 5, exit_cap_rate: 0.08, noi_growth_rate: 0.03, selling_cost_rate: 0.06,
    targets: { min_dscr: 1.2, target_coc: 0.08 },
    // tax
    tax: { cost_seg_pct: 0.3, bonus_rate: 1.0, marginal_rate: 0.37, recapture_rate: 0.25, ltcg_rate: 0.2 },
    // valuation comps
    valuation_comps: { price_per_unit: null, price_per_sqft: null, price_per_bed: null, market_grm: null, market_cap_rate: 0.08, replacement_cost_per_unit: null },
    // prescreen
    prescreen: { zoning_legal_nonconforming: false, master_metered: false, septic_or_well: false, rent_control_state: false, roof_age_years: null, hvac_age_years: null, str_permit_status: 'open' },
    // STR comparison (optional — panel appears in results when ADR + occupancy are set)
    str: { adr: null, occupancy_rate: null, avg_stay_days: 3, cost_per_turn: 120, management_rate: 0.22, platform_fee_rate: 0.03 },
  };
}

export default function DealNew() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { user } = useAuth();
  const { org } = useOrg();
  const nav = useNavigate();
  const [f, setF] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // For a new deal we're ready immediately; for edit, only after the deal's
  // real state loads — otherwise the market auto-picker fires on the default
  // 'AZ' state and locks in Phoenix before the true state arrives.
  const [hydrated, setHydrated] = useState(!editing);

  const markets = useQuery({ queryKey: ['markets', org?.id], queryFn: () => listMarkets(org.id), enabled: !!org });
  const agent = useQuery({ queryKey: ['listing-contact', id], queryFn: () => getListingContact(id), enabled: editing });

  // Load existing deal (edit mode): deal + units + latest scenario inputs.
  useEffect(() => {
    if (!editing) return;
    (async () => {
      const [deal, units, scenarios] = await Promise.all([getDeal(id), getUnits(id), listScenarios(id)]);
      const base = scenarios[0]?.inputs || {};
      setF((prev) => ({
        ...prev,
        ...base,
        address: deal.address || '', city: deal.city || '', state: deal.state || 'AZ',
        zip: deal.zip || '', apn: deal.apn || '', county_fips: deal.county_fips || '',
        year_built: deal.year_built, price: deal.price != null ? Number(deal.price) : null,
        status: deal.status,
        lat: deal.lat, lng: deal.lng, beds_total: deal.beds_total, unit_bucket: deal.unit_bucket,
        units: units.length ? units.map((u) => ({ type: u.type, count: u.count, sqft: u.sqft, actual_rent: Number(u.actual_rent), market_rent: Number(u.market_rent) })) : prev.units,
      }));
      setHydrated(true);
    })().catch((e) => setErr(e.message));
  }, [editing, id]);

  // Auto-select the market matching the deal's state (e.g. a scraped AZ deal
  // picks Phoenix/Maricopa) and apply its smart defaults — unless a market was
  // already chosen in a previous underwrite.
  useEffect(() => {
    if (!hydrated || !markets.data?.length || f.market_id || !f.state) return;
    const match = markets.data.find((m) => m.state === f.state);
    if (match) applyMarket(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, markets.data, f.state, f.market_id]);

  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const setNested = (key, patch) => setF((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  // Blended market rent per unit across the mix — the STR ADR seed.
  const avgMarketRent = useMemo(() => {
    const units = f.units || [];
    const count = units.reduce((a, u) => a + (Number(u.count) || 0), 0);
    if (!count) return null;
    const gross = units.reduce((a, u) => a + (Number(u.market_rent) || 0) * (Number(u.count) || 0), 0);
    return gross > 0 ? gross / count : null;
  }, [f.units]);
  const strSuggestion = useMemo(() => suggestStrDefaults(avgMarketRent), [avgMarketRent]);

  // Auto-seed the STR ADR + occupancy from the rent data so the LTR-vs-STR
  // panel appears without hunting — glance-level estimate, editable, flagged.
  useEffect(() => {
    if (!hydrated || !strSuggestion) return;
    setF((p) =>
      p.str.adr != null && p.str.adr !== ''
        ? p
        : { ...p, str: { ...p.str, adr: strSuggestion.adr, occupancy_rate: p.str.occupancy_rate ?? strSuggestion.occupancy_rate } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, strSuggestion]);

  // Apply market defaults when a market is picked.
  function applyMarket(marketId) {
    const m = (markets.data || []).find((x) => x.id === marketId);
    if (!m) { set({ market_id: marketId }); return; }
    const d = m.defaults || {};
    setF((p) => ({
      ...p,
      market_id: marketId,
      state: m.state || p.state,
      property_tax_rate: Number(m.property_tax_rate) || p.property_tax_rate,
      assessment_ratio: Number(m.assessment_ratio) || p.assessment_ratio,
      noi_growth_rate: Number(m.appreciation_rate) || p.noi_growth_rate,
      vacancy_rate: d.vacancy_rate ?? p.vacancy_rate,
      prescreen: { ...p.prescreen, str_permit_status: m.str_permit_status || p.prescreen.str_permit_status },
    }));
  }

  // Live preview so the operator sees the deal pencil as they type.
  const preview = useMemo(() => {
    try {
      if (!f.price || !f.units.length) return null;
      const market = (markets.data || []).find((x) => x.id === f.market_id);
      return underwrite({ ...f, market: market ? { str_permit_status: market.str_permit_status, appreciation_rate: Number(market.appreciation_rate) } : undefined });
    } catch {
      return null;
    }
  }, [f, markets.data]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const deal = await upsertDeal(org.id, user.id, {
        id: editing ? id : undefined,
        apn: f.apn, county_fips: f.county_fips, address: f.address, city: f.city, state: f.state, zip: f.zip,
        status: f.status, units_count: f.units.reduce((a, u) => a + (Number(u.count) || 0), 0),
        year_built: f.year_built, price: f.price, source: editing ? undefined : 'manual',
      });
      await replaceUnits(org.id, deal.id, f.units);
      const market = (markets.data || []).find((x) => x.id === f.market_id);
      const outputs = underwrite({ ...f, market: market ? { str_permit_status: market.str_permit_status, appreciation_rate: Number(market.appreciation_rate) } : undefined });
      await saveScenario(org.id, user.id, deal.id, {
        label: editing ? `Revision ${new Date().toLocaleString()}` : 'Base',
        inputs: f, outputs, calc_version: outputs.calc_version,
      });
      await logCost(org.id, user.id, { deal_id: deal.id, kind: 'model', provider: 'manual', description: 'Manual underwrite', amount_usd: 0 });
      nav(`/deals/${deal.id}`);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-4xl mx-auto px-4 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">{editing ? 'Edit deal' : 'New deal'}</h1>
          {agent.data && (
            <p className="text-sm mt-1">
              <span className="text-muted">Listed by</span> {agent.data.owner_name}
              {agent.data.brokerage && <span className="text-muted"> · {agent.data.brokerage}</span>}
              {agent.data.phone && (
                <a href={`tel:${agent.data.phone}`} className="ml-2 font-medium text-green-deep hover:underline">{agent.data.phone}</a>
              )}
            </p>
          )}
        </div>
        {preview && (
          <div className="text-sm text-right">
            <span className="text-muted">NOI </span><span className="font-medium tabular-nums">${Math.round(preview.derived.noi).toLocaleString()}</span>
            <span className="text-muted"> · DSCR </span><span className="font-medium tabular-nums">{preview.financing.dscr.dscr.toFixed(2)}</span>
            <span className="text-muted"> · Score </span><span className="font-medium tabular-nums">{Math.round(preview.score.score)}</span>
          </div>
        )}
      </div>

      <Section title="Property" subtitle="Where and what" tip="Identity of the deal. The market selection matters most — it pre-fills tax, vacancy, and growth defaults for the metro.">
        <Grid cols={2}>
          <Field label="Address" tip="Street address. Feeds the property's dedupe key, reports, and the map."><TextInput value={f.address} onChange={(v) => set({ address: v })} placeholder="123 Main St" /></Field>
          <Field label="Market" tip="A preset bundle for the metro: property-tax rate, assessment ratio, appreciation outlook, vacancy default, STR permit status. Picking one fills smart defaults — everything stays overridable.">
            <select className="input" value={f.market_id} onChange={(e) => applyMarket(e.target.value)}>
              <option value="">Select a market…</option>
              {(markets.data || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="City" tip="Used in reports and the dedupe key."><TextInput value={f.city} onChange={(v) => set({ city: v })} /></Field>
          <Field label="State" tip="Two-letter state. Determines which market auto-selects and which comps pool is searched."><TextInput value={f.state} onChange={(v) => set({ state: v })} /></Field>
          <Field label="ZIP" tip="Drives the market-rent reference card (Zillow ZORI is stored per ZIP)."><TextInput value={f.zip} onChange={(v) => set({ zip: v })} /></Field>
          <Field label="Year built" tip="Prescreen flags key off this: pre-1978 = lead-paint disclosure, pre-1980 = possible asbestos (which can be a value-add angle if you can remediate)."><NumberInput value={f.year_built} onChange={(v) => set({ year_built: v })} /></Field>
          <Field label="APN" tip="Assessor Parcel Number — the county's permanent ID for the parcel. With county FIPS it becomes the canonical key that prevents duplicate deals across data sources. Comes from assessor data in Phase 2." hint="APN + county FIPS is the canonical dedupe key"><TextInput value={f.apn} onChange={(v) => set({ apn: v })} /></Field>
          <Field label="County FIPS" tip="Federal code identifying the county (e.g. Maricopa = 04013). Pairs with APN for the canonical property key."><TextInput value={f.county_fips} onChange={(v) => set({ county_fips: v })} /></Field>
          <Field label="Asking price" tip="The price you're testing. Every ratio (cap rate, DSCR, cash-on-cash) is computed against it, and property tax is re-assessed at it. Try the solver's Max Offer as an alternative price."><NumberInput value={f.price} onChange={(v) => set({ price: v })} suffix="$" /></Field>
        </Grid>
      </Section>

      <Section title="Unit mix & rents" subtitle="Rents are per-unit — model the mix" tip="The income engine. List each unit TYPE (2BR/1BA etc.), how many, and both rents: actual (what the seller collects) and market (what they should fetch). Use the rent-reference card as your anchor. Total income = units × per-unit rent — never one blended number.">
        <div className="mb-4">
          <RentBandsCard orgId={org?.id} zip={f.zip} />
        </div>
        <UnitMixEditor units={f.units} onChange={(u) => set({ units: u })} />
        <Grid cols={3}>
          <Field label="Underwrite on" tip="Market rent = what units SHOULD rent for (pro forma — the upside case). Actual = what the seller collects today (conservative — the deal must survive on this). The gap between them is loss-to-lease, the value-add signal.">
            <select className="input" value={f.rent_basis} onChange={(e) => set({ rent_basis: e.target.value })}>
              <option value="market">Market rent (pro forma)</option>
              <option value="actual">Actual / in-place rent (conservative)</option>
            </select>
          </Field>
          <Field label="Other income" tip="Annual non-rent income: laundry, covered parking, storage, pet fees, RUBS (billing utilities back to tenants). Not reduced by vacancy." hint="annual (laundry, parking, RUBS)"><NumberInput value={f.other_income} onChange={(v) => set({ other_income: v })} suffix="$" /></Field>
          <Field label="Vacancy" tip="Percent of gross rent lost to empty units and turnover. 5% is roughly one month vacant per unit every 20 months. Stress panel tests +5 points automatically."><PercentInput value={f.vacancy_rate} onChange={(v) => set({ vacancy_rate: v })} /></Field>
        </Grid>
      </Section>

      <Section title="Operating expenses" subtitle="Annual $. Property tax is re-assessed at purchase price — never seller's" tip="Everything it costs to run the building yearly, BEFORE the mortgage. Income minus vacancy minus these = NOI, the number the whole valuation stands on. The #1 rookie error is copying the seller's (understated) numbers — these fields default conservative.">
        <Grid cols={3}>
          <Field label="Property tax rate" tip="County effective tax rate applied to YOUR purchase price — never the seller's old bill. Sales usually trigger reassessment, so the seller's current tax is misleadingly low." hint="effective rate applied to purchase price"><PercentInput value={f.property_tax_rate} onChange={(v) => set({ property_tax_rate: v })} /></Field>
          <Field label="Assessment ratio" tip="The fraction of market value the county actually taxes. AZ multifamily ≈ 10%, TN residential = 25%. Set 1 if your rate is already quoted on full value." hint="1 = rate on full market value"><NumberInput value={f.assessment_ratio} onChange={(v) => set({ assessment_ratio: v })} step="0.01" /></Field>
          <Field label="Land value" tip="The land portion of the price. Land can't be depreciated, so lower land value = bigger depreciation basis = bigger tax shelter. County assessor land values are a reasonable source." hint="excluded from depreciation basis"><NumberInput value={f.land_value} onChange={(v) => set({ land_value: v })} suffix="$" /></Field>
          <Field label="Insurance" tip="Annual property insurance. Get a real quote for older buildings — this line has been rising fast, and the stress panel tests +30% on it."><NumberInput value={f.expenses.insurance} onChange={(v) => setNested('expenses', { insurance: v })} suffix="$" /></Field>
          <Field label="Management" tip="Annual property-management cost. Budget 8–10% of collected income for long-term rentals even if you'll self-manage — your time isn't free, and lenders underwrite it in." hint="LTR 8–10% of EGI"><NumberInput value={f.expenses.management} onChange={(v) => setNested('expenses', { management: v })} suffix="$" /></Field>
          <Field label="Utilities" tip="Annual owner-paid utilities. Master-metered buildings (one meter) put this on you — check the prescreen box below if so, and consider RUBS to bill it back."><NumberInput value={f.expenses.utilities} onChange={(v) => setNested('expenses', { utilities: v })} suffix="$" /></Field>
          <Field label="Repairs & maintenance" tip="Annual routine upkeep: plumbing calls, appliances, turns, landscaping. Older buildings run higher. Rule of thumb: $500–$1,000/unit/yr depending on age."><NumberInput value={f.expenses.repairs_maintenance} onChange={(v) => setNested('expenses', { repairs_maintenance: v })} suffix="$" /></Field>
          <Field label="Capex reserve" tip="Savings for big-ticket items: roof, HVAC, repaves. We count it as an operating expense (reducing NOI) — the conservative treatment that keeps DSCR honest. $250–$350/unit/yr is typical." hint="annual total (per-unit × units)"><NumberInput value={f.expenses.capex_reserve} onChange={(v) => setNested('expenses', { capex_reserve: v })} suffix="$" /></Field>
          <Field label="Payroll" tip="On-site staff. Usually zero below ~20 units; larger buildings need a part-time manager." hint="if ≥ 20 units"><NumberInput value={f.expenses.payroll} onChange={(v) => setNested('expenses', { payroll: v })} suffix="$" /></Field>
        </Grid>
      </Section>

      <Section title="Financing & exit" subtitle="Terms for the comparator + solvers" tip="Loan terms for the four structures compared in results, your return targets for the solvers, and the exit assumptions (hold, exit cap, growth) that drive IRR and the proforma." defaultOpen={false}>
        <Grid cols={3}>
          <Field label="DSCR loan LTV" tip="Loan-to-value for a DSCR loan (qualifies on the PROPERTY's income, not your personal income). 70–80% typical. Higher LTV = less cash in but tighter coverage."><PercentInput value={f.financing.dscr.ltv} onChange={(v) => setNested('financing', { dscr: { ...f.financing.dscr, ltv: v } })} /></Field>
          <Field label="DSCR loan rate" tip="Interest rate on the DSCR loan. Usually 0.5–1% above agency rates. The stress panel automatically tests +1.5%."><PercentInput value={f.financing.dscr.rate} onChange={(v) => setNested('financing', { dscr: { ...f.financing.dscr, rate: v } })} /></Field>
          <Field label="DSCR amort (yrs)" tip="Amortization period. 30 years standard; shorter = higher payment but faster equity build."><NumberInput value={f.financing.dscr.amort_years} onChange={(v) => setNested('financing', { dscr: { ...f.financing.dscr, amort_years: v } })} /></Field>
          <Field label="Agency LTV" tip="Loan-to-value for conventional/agency financing (Fannie/Freddie — available on 2–4 unit properties, qualifies on YOUR income). Usually the cheapest debt if you qualify."><PercentInput value={f.financing.agency.ltv} onChange={(v) => setNested('financing', { agency: { ...f.financing.agency, ltv: v } })} /></Field>
          <Field label="Agency rate" tip="Conventional rate — typically the lowest available. Compare against the DSCR column in results to see what qualifying personally is worth."><PercentInput value={f.financing.agency.rate} onChange={(v) => setNested('financing', { agency: { ...f.financing.agency, rate: v } })} /></Field>
          <Field label="Agency amort (yrs)" tip="Amortization for the agency loan, usually 30 years."><NumberInput value={f.financing.agency.amort_years} onChange={(v) => setNested('financing', { agency: { ...f.financing.agency, amort_years: v } })} /></Field>
          <Field label="Closing cost" tip="Title, escrow, lender fees, inspections — as a percent of price. 2–3% typical. Counts toward your cash invested, so it lowers cash-on-cash."><PercentInput value={f.closing_cost_rate} onChange={(v) => set({ closing_cost_rate: v })} /></Field>
          <Field label="Rehab budget" tip="Upfront repair/renovation cash. Added to your total cash invested. For value-add deals this is how you buy the rent bump."><NumberInput value={f.rehab} onChange={(v) => set({ rehab: v })} suffix="$" /></Field>
          <Field label="Hold (yrs)" tip="How long you model owning before selling. Drives the proforma length, IRR, equity multiple, and exit tax math."><NumberInput value={f.hold_years} onChange={(v) => set({ hold_years: v })} /></Field>
          <Field label="Exit cap" tip="The cap rate you assume a buyer pays at sale: exit value = final NOI ÷ this. Higher = more conservative. Prudent practice: assume exit cap ≥ today's cap."><PercentInput value={f.exit_cap_rate} onChange={(v) => set({ exit_cap_rate: v })} /></Field>
          <Field label="NOI growth" tip="Annual growth applied to income AND expenses in projections. 2–3% is conservative; it compounds hard over a hold, so resist optimism here."><PercentInput value={f.noi_growth_rate} onChange={(v) => set({ noi_growth_rate: v })} /></Field>
          <Field label="Selling costs" tip="Broker commission + closing costs at exit, as a percent of sale price. 5–7% typical."><PercentInput value={f.selling_cost_rate} onChange={(v) => set({ selling_cost_rate: v })} /></Field>
          <Field label="Target min DSCR" tip="Your floor for debt coverage. 1.20 means NOI must exceed the mortgage by 20% — most lenders' minimum too. Both solvers honor this."><NumberInput value={f.targets.min_dscr} onChange={(v) => setNested('targets', { min_dscr: v })} step="0.01" /></Field>
          <Field label="Target CoC" tip="Your minimum cash-on-cash return (year-1 cash flow ÷ cash invested). The Max Offer solver finds the highest price still hitting this."><PercentInput value={f.targets.target_coc} onChange={(v) => setNested('targets', { target_coc: v })} /></Field>
        </Grid>
      </Section>

      <Section title="Valuation comps" subtitle="Feed the valuation panel" tip="Market evidence for what the building is WORTH (separate from what it earns). The auto-comps card pulls from your scanned sold comps; the fields accept manual comp research too. More methods filled = better triangulation." defaultOpen={false}>
        <div className="mb-4">
          <CompsAssist
            orgId={org?.id}
            state={f.state}
            lat={f.lat}
            lng={f.lng}
            unitBucket={f.unit_bucket}
            onUse={(patch) => setNested('valuation_comps', patch)}
          />
        </div>
        <Grid cols={3}>
          <Field label="Comp $/unit" tip="Median sold price per unit from comparable sales. The PRIMARY method for 2–4 unit buildings. Note: Redfin comps don't carry unit counts, so this one is usually manual — from your own comp research."><NumberInput value={f.valuation_comps.price_per_unit} onChange={(v) => setNested('valuation_comps', { price_per_unit: v })} suffix="$" /></Field>
          <Field label="Comp $/sqft" tip="Median sold price per square foot. Auto-fillable from scanned comps where sqft exists (thin in Phoenix ~9%, full in Nashville)."><NumberInput value={f.valuation_comps.price_per_sqft} onChange={(v) => setNested('valuation_comps', { price_per_sqft: v })} suffix="$" /></Field>
          <Field label="Comp $/bed" hint={f.beds_total ? `subject has ${f.beds_total} beds total` : 'needs subject total beds (scraped deals have it)'}><NumberInput value={f.valuation_comps.price_per_bed} onChange={(v) => setNested('valuation_comps', { price_per_bed: v })} suffix="$" /></Field>
          <Field label="Market GRM" tip="Gross Rent Multiplier from comps: sold price ÷ annual gross rent. A quick screen, not a primary method. Lower = cheaper relative to rents."><NumberInput value={f.valuation_comps.market_grm} onChange={(v) => setNested('valuation_comps', { market_grm: v })} step="0.1" /></Field>
          <Field label="Market cap rate" tip="What NOI yields sell for in this submarket. Value = NOI ÷ cap. The PRIMARY method for 5+ unit buildings. Ask brokers or derive from verified comps."><PercentInput value={f.valuation_comps.market_cap_rate} onChange={(v) => setNested('valuation_comps', { market_cap_rate: v })} /></Field>
          <Field label="Replacement $/unit" tip="What building one unit new would cost. Replacement cost is a CEILING sanity check — paying far above it means you could build cheaper than buy."><NumberInput value={f.valuation_comps.replacement_cost_per_unit} onChange={(v) => setNested('valuation_comps', { replacement_cost_per_unit: v })} suffix="$" /></Field>
        </Grid>
      </Section>

      <Section title="STR comparison" subtitle="Optional — see this building's short-term-rental case beside the LTR numbers" tip="Enter an average nightly rate and occupancy and the results page adds a side-by-side LTR vs STR panel: same building, same loan, STR income and expense stack (turn cleaning, platform fees, 22%-grade management). Leave ADR blank to skip. Check the market's STR permit status in the prescreen below — a great ADR means nothing where permits are closed." defaultOpen={false}>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field
            label="ADR ($/night)"
            tip="Average daily rate per unit. Auto-seeded from this deal's market rent (roughly rent ÷ 12 — a short-term night grosses about 2.5× the long-term nightly equivalent). That's a glance-level estimate: once a deal interests you, refine it from AirDNA or nearby Airbnb comps for the same bedroom count."
            hint={strSuggestion ? `≈ suggested from ${usd(Math.round(avgMarketRent))}/mo rent — refine with AirDNA` : undefined}
          >
            <NumberInput value={f.str.adr} onChange={(v) => setNested('str', { adr: v })} suffix="$" />
          </Field>
          <Field label="Occupancy" tip="Share of nights booked, yearly average. Seeded at a conservative 60%; Phoenix metro typically 55–70%, seasonal markets swing hard."><PercentInput value={f.str.occupancy_rate} onChange={(v) => setNested('str', { occupancy_rate: v })} /></Field>
          <Field label="Avg stay (nights)" tip="Typical booking length. 7 nights or less also opens the STR material-participation tax lane (see the tax panel)."><NumberInput value={f.str.avg_stay_days} onChange={(v) => setNested('str', { avg_stay_days: v })} /></Field>
          <Field label="Cost per turn" tip="Cleaning + restocking per checkout. Shorter stays = more turns = this matters a lot."><NumberInput value={f.str.cost_per_turn} onChange={(v) => setNested('str', { cost_per_turn: v })} suffix="$" /></Field>
          <Field label="STR management" tip="Full-service STR management runs 20–25% of revenue (vs 8–10% for LTR). Self-managing? Enter what your time is honestly worth."><PercentInput value={f.str.management_rate} onChange={(v) => setNested('str', { management_rate: v })} /></Field>
          <Field label="Platform fees" tip="Airbnb/VRBO host-side fees as a share of revenue, typically ~3%."><PercentInput value={f.str.platform_fee_rate} onChange={(v) => setNested('str', { platform_fee_rate: v })} /></Field>
        </div>
      </Section>

      <Section title="Prescreen & tax" subtitle="Deal-killers and tax assumptions" tip="Cheap red-flag checks that can kill a deal before you waste hours on it, plus the assumptions behind the cost-segregation and REP tax modeling." defaultOpen={false}>
        <Grid cols={3}>
          {[
            ['zoning_legal_nonconforming', 'Zoning non-conforming', 'The building predates current zoning and couldn\'t be rebuilt as-is after a fire. A DEAL-KILLER flag: lenders balk and rebuild rights are limited. Verify with the planning department.'],
            ['master_metered', 'Master-metered', 'One utility meter for the whole building — the owner pays all utilities. Not fatal, but budget for it and consider RUBS or submetering.'],
            ['septic_or_well', 'Septic / well', 'Not on city sewer/water. Needs its own inspection and a repair reserve; failures are expensive.'],
            ['rent_control_state', 'Rent-control state', 'Statutory limits on rent increases cap your growth assumptions. AZ and TN currently preempt local rent control.'],
          ].map(([key, label, tipText]) => (
            <label key={key} className="flex items-center gap-2 text-sm mt-6">
              <input type="checkbox" checked={f.prescreen[key]} onChange={(e) => setNested('prescreen', { [key]: e.target.checked })} />
              {label}<Tip text={tipText} />
            </label>
          ))}
          <Field label="Roof age (yrs)" tip="20+ years flags a near-term replacement — roughly $8–15k per building section. Ask the agent or check permits."><NumberInput value={f.prescreen.roof_age_years} onChange={(v) => setNested('prescreen', { roof_age_years: v })} /></Field>
          <Field label="HVAC age (yrs)" tip="15+ years flags replacements coming — $6–8k per unit in AZ where AC is life support."><NumberInput value={f.prescreen.hvac_age_years} onChange={(v) => setNested('prescreen', { hvac_age_years: v })} /></Field>
          <Field label="STR permit status" tip="Whether the market lets you short-term rent. 'Closed' forces the STR upside to $0 in modeling — never underwrite on banned income.">
            <select className="input" value={f.prescreen.str_permit_status} onChange={(e) => setNested('prescreen', { str_permit_status: e.target.value })}>
              <option value="open">open</option><option value="restricted">restricted</option><option value="closed">closed</option>
            </select>
          </Field>
          <Field label="Cost-seg reclass %" tip="Share of the building a cost-segregation study reclassifies into 5/15-year property (eligible for bonus depreciation). 30% is a conservative default; studies often find more."><PercentInput value={f.tax.cost_seg_pct} onChange={(v) => setNested('tax', { cost_seg_pct: v })} /></Field>
          <Field label="Bonus depreciation" tip="First-year write-off rate on reclassified property. 100% under current law (OBBBA made it permanent)."><PercentInput value={f.tax.bonus_rate} onChange={(v) => setNested('tax', { bonus_rate: v })} /></Field>
          <Field label="Marginal tax rate" tip="Your combined federal + state rate on the next dollar of income. Determines what each dollar of depreciation is worth to you. Estimate — verify with your CPA."><PercentInput value={f.tax.marginal_rate} onChange={(v) => setNested('tax', { marginal_rate: v })} /></Field>
        </Grid>
      </Section>

      {err && <div className="text-danger text-sm">{err}</div>}
      <div className="flex items-center gap-3">
        <button className="btn-gold" disabled={saving || !f.price}>
          {saving ? 'Underwriting…' : editing ? 'Save revision & underwrite' : 'Underwrite deal'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => nav(-1)}>Cancel</button>
      </div>
    </form>
  );
}
