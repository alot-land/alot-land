/** End-of-month debt ledger. Refinance/payoff follows that month's payment;
 * the replacement loan starts paying the following month. No rounded cents
 * enter calculation. Fractional years must represent whole months. */
import { monthlyMortgagePayment } from './finance.js';

export function monthsIn(years: number, name = 'years'): number {
  const months = years * 12;
  if (!Number.isFinite(months) || months < 0 || Math.abs(months - Math.round(months)) > 1e-8 || months > 1200)
    throw new RangeError(`${name} must represent whole months within 100 years`);
  return Math.round(months);
}
export interface DebtTerms {
  loan_amount: number;
  annual_rate: number;
  amort_years: number;
  interest_only?: boolean;
  /** IO months before a full amortization period (not included in amort_years). */
  interest_only_months?: number;
  balloon_years?: number;
  payoff_month?: number;
}
export interface Refinance extends DebtTerms {
  month: number;
  financing_costs?: number;
  /** If loan_amount is not supplied by the UI, it sizes using valuation × LTV. */
  valuation?: number;
  ltv?: number;
}
export interface DebtMonth {
  month: number;
  opening_balance: number;
  payment: number;
  interest: number;
  principal: number;
  payoff: number;
  debt_service: number;
  refinance_proceeds: number;
  financing_costs: number;
  closing_balance: number;
}

function validTerms(t: DebtTerms) {
  if (![t.loan_amount,t.annual_rate,t.amort_years].every(Number.isFinite) || t.loan_amount < 0 || t.annual_rate < 0 || t.annual_rate > 1)
    throw new RangeError('Invalid debt amount/rate');
  if (monthsIn(t.amort_years,'amort_years') < 1) throw new RangeError('amort_years must be positive');
  for(const n of [t.interest_only_months,t.payoff_month])
    if(n != null && (!Number.isInteger(n) || n < 0 || n > 1200)) throw new RangeError('Invalid debt event month');
  if(t.payoff_month===0) throw new RangeError('Payoff must be after origination');
  if(t.balloon_years != null && monthsIn(t.balloon_years,'balloon_years') < 1) throw new RangeError('Balloon must be after origination');
}

export function debtSchedule(terms: DebtTerms, holdMonths: number, refi?: Refinance): DebtMonth[] {
  validTerms(terms);
  if(!Number.isInteger(holdMonths) || holdMonths < 1 || holdMonths > 1200) throw new RangeError('Invalid hold months');
  if(refi){
    validTerms(refi);
    if(!Number.isInteger(refi.month) || refi.month < 1 || refi.month >= holdMonths) throw new RangeError('Refinance must precede sale');
    if(!Number.isFinite(refi.financing_costs ?? 0) || (refi.financing_costs ?? 0) < 0) throw new RangeError('Invalid refinance costs');
  }
  let active=terms, origin=0, balance=terms.loan_amount;
  const rows: DebtMonth[]=[];
  for(let month=1; month<=holdMonths; month++){
    const age=month-origin, opening=balance;
    const ioMonths=active.interest_only_months ?? 0;
    const interest=balance * active.annual_rate / 12;
    const io=active.interest_only || age<=ioMonths;
    const contractual=io ? interest : monthlyMortgagePayment(active.loan_amount,active.annual_rate,active.amort_years);
    const principal=balance > 0 && !io ? Math.min(balance,Math.max(0,contractual-interest)) : 0;
    const payment=interest+principal;
    balance=Math.max(0,balance-principal);
    if(balance < Math.max(1,active.loan_amount)*1e-12) balance=0;
    let payoff=0, proceeds=0, costs=0;
    if(refi && month===refi.month){
      payoff=balance; proceeds=refi.loan_amount; costs=refi.financing_costs ?? 0;
      active=refi; origin=month; balance=refi.loan_amount;
    }else{
      const maturity=active.balloon_years != null ? monthsIn(active.balloon_years) :
        monthsIn(active.amort_years)+(active.interest_only ? 0 : ioMonths);
      if(age===maturity || (active.payoff_month != null && age===active.payoff_month)){
        payoff=balance; balance=0;
      }
    }
    const row={month,opening_balance:opening,payment,interest,principal,payoff,
      debt_service:payment+payoff,refinance_proceeds:proceeds,financing_costs:costs,closing_balance:balance};
    if(!Object.values(row).every(Number.isFinite)) throw new RangeError('Debt schedule overflow');
    rows.push(row);
  }
  return rows;
}

export function aggregateDebt(rows: DebtMonth[]) {
  return rows.reduce((a,r)=>({debt_service:a.debt_service+r.debt_service, interest:a.interest+r.interest,
    principal:a.principal+r.principal+r.payoff, refinance_proceeds:a.refinance_proceeds+r.refinance_proceeds,
    financing_costs:a.financing_costs+r.financing_costs}),
    {debt_service:0,interest:0,principal:0,refinance_proceeds:0,financing_costs:0});
}

/** Annualized first-period coverage: includes any payoff within that period.
 * Inverse price/down solvers do not assume an uncommitted refinance. */
export function firstPeriodDebtService(terms: DebtTerms, holdMonths = 12): number {
  const months=Math.min(12,holdMonths);
  return aggregateDebt(debtSchedule(terms,months)).debt_service*12/months;
}
