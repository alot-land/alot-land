/**
 * Tax layer. EVERY output here is an ESTIMATE — reports must print
 * "estimate — verify with CPA". This module computes, it does not advise.
 *
 * Models:
 *  - Cost-seg: reclassify a % of depreciable basis into short-life property.
 *  - Bonus depreciation: 100% first-year on the reclassified portion
 *    (OBBBA made 100% bonus permanent).
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
  /** Fraction of depreciable basis reclassified to 5/15-yr property via cost seg.
   * Default 0.30 (conservative). */
  cost_seg_pct: number;
  /** Bonus depreciation rate on the reclassified portion. 1.0 under OBBBA. */
  bonus_rate: number;
  /** Residential MF straight-line recovery period. 27.5 years. */
  recovery_years?: number;
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
}

export function depreciation(inp: DepreciationInput): DepreciationResult {
  const recovery = inp.recovery_years ?? 27.5;
  const basis = Math.max(0, inp.purchase_price - inp.land_value);
  const reclassified = basis * inp.cost_seg_pct;
  const remaining = basis - reclassified;
  const bonus = reclassified * inp.bonus_rate;
  const sl = remaining / recovery;
  return {
    depreciable_basis: basis,
    reclassified_basis: reclassified,
    remaining_basis: remaining,
    first_year_bonus: bonus,
    annual_straight_line: sl,
    first_year_total: bonus + sl,
  };
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
  const interest = interestPaidOverMonths(
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
    );

  const taxable = inp.noi - interest - inp.depreciation_this_year;

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
  const adjustedBasis = inp.purchase_price - inp.accumulated_depreciation;
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
