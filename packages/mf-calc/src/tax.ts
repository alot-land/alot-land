/**
 * Tax layer. EVERY output here is an ESTIMATE — reports must print
 * "estimate — verify with CPA". This module computes, it does not advise.
 *
 * Models:
 *  - Cost-seg: reclassify a % of depreciable basis into short-life property.
 *  - Optional user-assumed bonus; this engine does not determine eligibility.
 *  - REP-on vs REP-off: computed BOTH ways always. REP-on lets rental losses
 *    offset active income; REP-off suspends passive losses (no active offset).
 *  - STR material-participation path: avg stay ≤ 7 days escapes passive rules
 *    even without REP, so losses offset active income.
 *  - Depreciation recapture at exit: unrecaptured §1250 at 25% + LTCG on the rest.
 */
import { interestPaidOverMonths } from './finance.js';

export interface DepreciationInput {
  purchase_price: number;
  /** Non-depreciable land value. */
  land_value: number;
  /** User-assumed fraction allocated to the simplified short-life pool. */
  cost_seg_pct: number;
  /** User-assumed bonus rate. This model does not determine eligibility. */
  bonus_rate: number;
  /** Residential MF straight-line recovery period. 27.5 years. */
  recovery_years?: number;
  improvements?: number;
  capitalized_costs?: number;
  placed_in_service_month?: number;
  short_life_years?: number;
}

export interface DepreciationResult {
  depreciable_basis: number;
  reclassified_basis: number;
  remaining_basis: number;
  /** First-year bonus taken on the reclassified portion. */
  first_year_bonus: number;
  /** Straight-line on the remaining (long-life) basis, per year. */
  annual_straight_line: number;
  /** Total first-year depreciation = bonus + one year straight-line. */
  first_year_total: number;
  annual_short_life: number;
  unbonused_short_basis: number;
}

export function depreciation(inp: DepreciationInput): DepreciationResult {
  const recovery = inp.recovery_years ?? 27.5;
  if(![inp.purchase_price,inp.land_value,inp.cost_seg_pct,inp.bonus_rate,recovery,inp.improvements ?? 0,inp.capitalized_costs ?? 0].every(Number.isFinite) ||
    inp.purchase_price<0 || (inp.improvements ?? 0)<0 || (inp.capitalized_costs ?? 0)<0 || inp.land_value<0 || inp.land_value>inp.purchase_price || recovery<=0 || inp.cost_seg_pct<0 || inp.cost_seg_pct>1 || inp.bonus_rate<0 || inp.bonus_rate>1)
    throw new RangeError('Invalid simplified depreciation assumptions');
  const service=inp.placed_in_service_month ?? 1,shortLife=inp.short_life_years ?? 5;
  if(!Number.isInteger(service)||service<1 || service>1200 || !Number.isFinite(shortLife)||shortLife<=0) throw new RangeError('Invalid depreciation timing');
  const basis = Math.max(0, inp.purchase_price - inp.land_value + (inp.improvements ?? 0)+(inp.capitalized_costs ?? 0));
  const reclassified = basis * inp.cost_seg_pct;
  const remaining = basis - reclassified;
  const bonus = reclassified * inp.bonus_rate;
  const sl = remaining / recovery;
  const shortBasis=reclassified-bonus;
  const shortAnnual=shortBasis/shortLife;
  const fraction=Math.max(0,13-service)/12;
  return {
    depreciable_basis: basis,
    reclassified_basis: reclassified,
    remaining_basis: remaining,
    first_year_bonus: bonus,
    annual_straight_line: sl,
    first_year_total: service<=12 ? bonus+Math.min(remaining,sl*fraction)+Math.min(shortBasis,shortAnnual*fraction) : 0,
    annual_short_life:shortAnnual,
    unbonused_short_basis:shortBasis,
  };
}

/** Optional simplified straight-line asset pools, NOT MACRS/mid-month tax advice.
 * Acquisition improvements assumed ready on the supplied service month. */
export function depreciationOverHold(inp: DepreciationInput, months: number) {
  if(!Number.isInteger(months)||months<0||months>1200) throw new RangeError('Invalid depreciation hold months');
  const d=depreciation(inp),service=inp.placed_in_service_month ?? 1;
  const active=Math.max(0,months-service+1);
  const bonus=active>0 ? d.first_year_bonus : 0;
  const building=Math.min(d.remaining_basis,d.annual_straight_line*active/12);
  const short=Math.min(d.unbonused_short_basis,d.annual_short_life*active/12);
  return {total:bonus+building+short,building,short_life:bonus+short};
}

export interface TaxYearInput {
  noi: number;
  loan_amount: number;
  annual_rate: number;
  amort_years: number;
  /** Which year of the hold (1-based) — determines interest portion. */
  year: number;
  depreciation_this_year: number;
  interest_only?: boolean;
  /** Marginal ordinary income tax rate (fed + state blended), decimal. */
  marginal_rate: number;
  /** Passive income available to absorb losses when REP is off (usually 0). */
  passive_income_available?: number;
  /** Actual projection interest, including IO/refinance/early payoff. */
  interest_this_year?: number;
  reserve_addback?: number;
}

export interface TaxYearResult {
  interest: number;
  depreciation: number;
  /** NOI − interest − depreciation. Negative = paper loss. */
  taxable_income: number;
  /** Tax benefit (positive) or liability (negative) with REP ON:
   * full loss offsets active income at the marginal rate. */
  benefit_rep_on: number;
  /** Tax benefit with REP OFF: passive losses limited to passive income;
   * excess is suspended (carried forward), so no current active offset. */
  benefit_rep_off: number;
}

/**
 * Compute one year's tax result both ways (REP on and off).
 * Positive benefit = reduces tax bill; negative = adds to it.
 */
export function taxYear(inp: TaxYearInput): TaxYearResult {
  const interest = inp.interest_this_year ?? (interestPaidOverMonths(
    inp.loan_amount,
    inp.annual_rate,
    inp.amort_years,
    // interest during year `year`: total through end of year − total through prior year
    inp.year * 12,
    inp.interest_only,
  ) -
    interestPaidOverMonths(
      inp.loan_amount,
      inp.annual_rate,
      inp.amort_years,
      (inp.year - 1) * 12,
      inp.interest_only,
    ));

  const taxable = inp.noi + (inp.reserve_addback ?? 0) - interest - inp.depreciation_this_year;

  // REP ON: whole loss (or income) hits active at marginal rate.
  const benefitRepOn = -taxable * inp.marginal_rate;

  // REP OFF: if profit, taxed; if loss, only offset up to passive income.
  const passive = inp.passive_income_available ?? 0;
  let benefitRepOff: number;
  if (taxable >= 0) {
    benefitRepOff = -taxable * inp.marginal_rate; // a tax liability
  } else {
    const usableLoss = Math.min(-taxable, passive); // rest suspended
    benefitRepOff = usableLoss * inp.marginal_rate;
  }

  return {
    interest,
    depreciation: inp.depreciation_this_year,
    taxable_income: taxable,
    benefit_rep_on: benefitRepOn,
    benefit_rep_off: benefitRepOff,
  };
}

// ---------------------------------------------------------------------------
// Depreciation recapture + capital gains at exit.
// ---------------------------------------------------------------------------
export interface ExitTaxInput {
  sale_price: number;
  selling_costs: number;
  purchase_price: number;
  /** Total depreciation taken over the hold. */
  accumulated_depreciation: number;
  /** Portion of accumulated depreciation that is §1245 personal property
   * (the cost-seg reclass, typically 100%-bonused). Recaptured at ORDINARY
   * rates, not the 25% §1250 cap — v1.12.0; earlier versions understated
   * exit tax on cost-seg deals by taxing everything at 25%. Default 0. */
  section1245_depreciation?: number;
  /** Ordinary income rate applied to §1245 recapture. Default 0.37. */
  ordinary_rate?: number;
  /** Unrecaptured §1250 rate (straight-line real property). Default 0.25. */
  recapture_rate?: number;
  /** Long-term capital gains rate on appreciation. Default 0.20. */
  ltcg_rate?: number;
  capital_improvements?: number;
  capitalized_costs?: number;
}

export interface ExitTaxResult {
  adjusted_basis: number;
  total_gain: number;
  recapture_portion: number;
  /** §1245 slice of the recapture, taxed at ordinary rates. */
  recapture_1245_portion: number;
  /** §1250 slice of the recapture, taxed at the 25% cap. */
  recapture_1250_portion: number;
  capital_gain_portion: number;
  recapture_tax: number;
  capital_gains_tax: number;
  total_exit_tax: number;
}

export function exitTax(inp: ExitTaxInput): ExitTaxResult {
  const recRate = inp.recapture_rate ?? 0.25;
  const ordRate = inp.ordinary_rate ?? 0.37;
  const ltcgRate = inp.ltcg_rate ?? 0.2;
  const s1245 = Math.min(inp.section1245_depreciation ?? 0, inp.accumulated_depreciation);
  const netProceeds = inp.sale_price - inp.selling_costs;
  const adjustedBasis = Math.max(0,inp.purchase_price+(inp.capital_improvements ?? 0)+(inp.capitalized_costs ?? 0)-inp.accumulated_depreciation);
  const totalGain = Math.max(0, netProceeds - adjustedBasis);
  // Recapture applies to the portion of gain up to accumulated depreciation.
  // §1245 (cost-seg personal property) recaptures first, at ordinary rates;
  // the remaining straight-line §1250 slice at the 25% cap.
  const recapturePortion = Math.min(totalGain, inp.accumulated_depreciation);
  const rec1245 = Math.min(recapturePortion, s1245);
  const rec1250 = recapturePortion - rec1245;
  const capitalGainPortion = totalGain - recapturePortion;
  const recaptureTax = rec1245 * ordRate + rec1250 * recRate;
  const capitalGainsTax = capitalGainPortion * ltcgRate;
  return {
    adjusted_basis: adjustedBasis,
    total_gain: totalGain,
    recapture_portion: recapturePortion,
    recapture_1245_portion: rec1245,
    recapture_1250_portion: rec1250,
    capital_gain_portion: capitalGainPortion,
    recapture_tax: recaptureTax,
    capital_gains_tax: capitalGainsTax,
    total_exit_tax: recaptureTax + capitalGainsTax,
  };
}

/** STR material-participation eligibility: average guest stay ≤ 7 days AND
 * material participation. When true, losses may offset active income without
 * REP status. This is a gate, not a calculation — CPA verification required. */
export function strMaterialParticipationEligible(
  avgStayDays: number,
  materiallyParticipates: boolean,
): boolean {
  return avgStayDays <= 7 && materiallyParticipates;
}
