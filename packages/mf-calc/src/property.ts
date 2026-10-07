/**
 * Property-level helpers that depend on purchase price.
 */

/**
 * Re-assess property tax at the purchase price per county rules — NEVER use the
 * seller's in-place assessed value (rule from spec). Counties assess on a ratio
 * of market value, then apply a millage/effective rate.
 *
 *   assessed value = purchase_price × assessment_ratio
 *   annual tax     = assessed value × effective_tax_rate
 *
 * For counties quoted as a flat effective rate on market value, pass
 * assessment_ratio = 1 and effective_tax_rate = that rate.
 */
export function reassessedPropertyTax(
  purchasePrice: number,
  effectiveTaxRate: number,
  assessmentRatio = 1,
): number {
  return purchasePrice * assessmentRatio * effectiveTaxRate;
}

export interface CashInvestedInput {
  down_payment: number;
  closing_costs: number;
  rehab: number;
  /** STR furnishing capex, per-unit rolled up. 0 for LTR/MTR. */
  furnishing: number;
  financing_fees?: number;
  lender_costs?: number;
  initial_reserves?: number;
  seller_credits?: number;
}

export function totalCashInvested(inp: CashInvestedInput): number {
  return inp.down_payment + inp.closing_costs + inp.rehab + inp.furnishing +
    (inp.financing_fees ?? 0)+(inp.lender_costs ?? 0)+(inp.initial_reserves ?? 0)-(inp.seller_credits ?? 0);
}
