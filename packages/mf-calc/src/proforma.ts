/** Monthly operating/equity ledger, aggregated into annual report rows.
 * One growth rate applies to income and expenses. Partial years are prorated.
 * Exit uses the forward annual NOI at sale (year N+1 for integer holds).
 * Pretax returns. Taxes remain a separate, explicitly simplified estimate. */
import { effectiveGrossIncome, equityMultiple, type TimedCashFlow } from './finance.js';
import { debtSchedule, aggregateDebt, monthsIn, type DebtTerms, type DebtMonth, type Refinance } from './debt.js';

export interface ProformaInput extends DebtTerms {
  gross_potential_rent: number;
  other_income: number;
  vacancy_rate: number;
  concessions?: number;
  bad_debt?: number;
  operating_expenses: number;
  growth_rate: number;
  hold_years: number;
  exit_cap_rate: number;
  selling_cost_rate: number;
  cash_invested: number;
  refinance?: Refinance;
  initial_reserves?: number;
}
export interface ProformaYear {
  year: number;
  months: number;
  gpr: number;
  vacancy_loss: number;
  concessions: number;
  bad_debt: number;
  other_income: number;
  egi: number;
  operating_expenses: number;
  noi: number;
  debt_service: number;
  interest: number;
  principal: number;
  refinance_proceeds: number;
  financing_costs: number;
  cfbt: number;
  cumulative_cfbt: number;
  loan_balance_end: number;
  cash_on_cash: number | null;
}
export interface ProformaExit {
  exit_noi: number;
  exit_value: number;
  selling_costs: number;
  loan_payoff: number;
  reserve_return: number;
  net_sale_proceeds: number;
  total_profit: number;
  equity_multiple: number | null;
}
export interface Proforma {
  years: ProformaYear[];
  exit: ProformaExit;
  debt_schedule: DebtMonth[];
  equity_cash_flows: TimedCashFlow[];
}

export function buildProforma(inp: ProformaInput): Proforma {
  const hold=monthsIn(inp.hold_years,'hold_years');
  if(hold<1) throw new RangeError('Hold must be at least one month');
  if(![inp.gross_potential_rent,inp.other_income,inp.vacancy_rate,inp.operating_expenses,inp.growth_rate,
    inp.exit_cap_rate,inp.selling_cost_rate,inp.cash_invested,inp.concessions ?? 0,inp.bad_debt ?? 0,inp.initial_reserves ?? 0].every(Number.isFinite))
    throw new RangeError('Non-finite projection input');
  if(inp.exit_cap_rate<=0 || inp.growth_rate<=-1 || inp.vacancy_rate<0 || inp.vacancy_rate>1 || inp.selling_cost_rate<0 || inp.selling_cost_rate>1 || inp.cash_invested<0)
    throw new RangeError('Invalid projection rate/equity');
  const debt=debtSchedule(inp,hold,inp.refinance);
  const baseEgi=effectiveGrossIncome(inp);
  const year1Noi=baseEgi-inp.operating_expenses;
  const exitNoi=year1Noi*Math.pow(1+inp.growth_rate,inp.hold_years);
  const exitValue=Math.max(0,exitNoi/inp.exit_cap_rate);
  const sellingCosts=exitValue*inp.selling_cost_rate;
  const loanPayoff=debt.at(-1)!.closing_balance;
  const reserveReturn=inp.initial_reserves ?? 0;
  const netSale=exitValue-sellingCosts-loanPayoff+reserveReturn;
  const flows:TimedCashFlow[]=[{time:0,amount:-inp.cash_invested}];
  const dists:number[]=[];
  for(const row of debt){
    const growth=Math.pow(1+inp.growth_rate,Math.floor((row.month-1)/12));
    const equityCf=year1Noi*growth/12-row.debt_service+row.refinance_proceeds-row.financing_costs;
    const total=equityCf+(row.month===hold ? netSale : 0);
    dists.push(total);
    flows.push({time:row.month/12,amount:total});
  }
  const years:ProformaYear[]=[];
  let cumulative=0;
  for(let start=0;start<hold;start+=12){
    const rows=debt.slice(start,start+12),year=Math.floor(start/12)+1;
    const f=Math.pow(1+inp.growth_rate,year-1)*rows.length/12;
    const gpr=inp.gross_potential_rent*f, vacancy=gpr*inp.vacancy_rate;
    const other=inp.other_income*f,concessions=(inp.concessions ?? 0)*f,badDebt=(inp.bad_debt ?? 0)*f;
    const egi=gpr-vacancy+other-concessions-badDebt,opex=inp.operating_expenses*f;
    const totals=aggregateDebt(rows),noi=egi-opex,cfbt=noi-totals.debt_service;
    cumulative+=cfbt;
    years.push({year,months:rows.length,gpr,vacancy_loss:vacancy,other_income:other,concessions,bad_debt:badDebt,egi,
      operating_expenses:opex,noi,...totals,cfbt,cumulative_cfbt:cumulative,
      loan_balance_end:rows.at(-1)!.closing_balance,cash_on_cash:inp.cash_invested>1e-8 ? cfbt/inp.cash_invested : null});
  }
  if(!flows.every(f=>Number.isFinite(f.amount))) throw new RangeError('Projection overflow');
  const totalProfit=dists.reduce((a,b)=>a+b,0)-inp.cash_invested;
  return {years,debt_schedule:debt,equity_cash_flows:flows,exit:{exit_noi:exitNoi,exit_value:exitValue,
    selling_costs:sellingCosts,loan_payoff:loanPayoff,reserve_return:reserveReturn,net_sale_proceeds:netSale,
    total_profit:totalProfit,equity_multiple:inp.cash_invested>1e-8 ? equityMultiple(inp.cash_invested,dists,0) : null}};
}
