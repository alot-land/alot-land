/**
 * Stress panel — applied to every deal.
 * Shocks: rents −10%, vacancy +5pp, rate +150bps, insurance +30%, each showing
 * the resulting DSCR / CoC and the break-even line. Plus a combined worst-case.
 */
import {
  noi as computeNoi,
  annualDebtService,
  cashFlowBeforeTax,
  cashOnCash,
  dscr,
  breakEvenOccupancy,
} from './finance.js';
import { debtSchedule,aggregateDebt,type DebtTerms,type Refinance } from './debt.js';

export interface StressBaseInput extends DebtTerms {
  gross_potential_rent: number; // annual
  other_income: number;
  vacancy_rate: number; // decimal
  /** Operating expenses broken out enough to shock insurance separately. */
  insurance: number;
  other_operating_expenses: number; // everything except insurance
  loan_amount: number;
  annual_rate: number;
  amort_years: number;
  cash_invested: number;
  interest_only?: boolean;
  hold_months?: number;
  refinance?: Refinance;
  concessions?: number;
  bad_debt?: number;
}

export interface StressScenario {
  label: string;
  dscr: number;
  cash_on_cash: number;
  break_even_occupancy: number;
  noi: number;
  cfbt: number;
}

interface Shocks {
  rentMult?: number; // e.g. 0.90 for −10%
  vacancyAdd?: number; // e.g. 0.05
  rateAdd?: number; // e.g. 0.015
  insuranceMult?: number; // e.g. 1.30
}

function scenario(base: StressBaseInput, label: string, s: Shocks): StressScenario {
  const gpr = base.gross_potential_rent * (s.rentMult ?? 1);
  const vac = Math.min(1,base.vacancy_rate + (s.vacancyAdd ?? 0));
  const insurance = base.insurance * (s.insuranceMult ?? 1);
  const opex = insurance + base.other_operating_expenses;
  const rate = base.annual_rate + (s.rateAdd ?? 0);

  const noiVal = computeNoi({
    gross_potential_rent: gpr,
    other_income: base.other_income,
    vacancy_rate: vac,
    operating_expenses: opex,
    concessions:base.concessions,bad_debt:base.bad_debt,
  });
  const rows=debtSchedule({...base,annual_rate:rate},base.hold_months ?? 12,base.refinance);
  const first=rows.slice(0,12);
  const ads=aggregateDebt(first).debt_service*12/first.length;
  const cfbt = cashFlowBeforeTax(noiVal, ads);

  return {
    label,
    dscr: dscr(noiVal, ads),
    cash_on_cash: cashOnCash(cfbt, base.cash_invested),
    break_even_occupancy: breakEvenOccupancy(opex, ads, gpr, base.other_income,(base.concessions ?? 0)+(base.bad_debt ?? 0)),
    noi: noiVal,
    cfbt,
  };
}

export function stressPanel(base: StressBaseInput): StressScenario[] {
  return [
    scenario(base, 'Base', {}),
    scenario(base, 'Rents −10%', { rentMult: 0.9 }),
    scenario(base, 'Vacancy +5pp', { vacancyAdd: 0.05 }),
    scenario(base, 'Rate +150bps', { rateAdd: 0.015 }),
    scenario(base, 'Insurance +30%', { insuranceMult: 1.3 }),
    scenario(base, 'Combined worst case', {
      rentMult: 0.9,
      vacancyAdd: 0.05,
      rateAdd: 0.015,
      insuranceMult: 1.3,
    }),
  ];
}
