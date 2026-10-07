/**
 * Core financial primitives. Pure functions, no side effects.
 * These are the atoms every higher-level model composes.
 */

/** Round to `dp` decimal places (half away from zero). Used only
 * at reporting boundaries — internal math stays full-precision. */
export function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  const value=Math.sign(x)*Math.round((Math.abs(x)+Number.EPSILON)*f)/f;
  return Object.is(value,-0) ? 0 : value;
}

/**
 * Fully-amortizing level monthly payment.
 * P = principal, annualRate decimal, years term.
 * Handles the 0% edge case (straight principal / n).
 */
export function monthlyMortgagePayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0) return 0;
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  const i = annualRate / 12;
  if (i === 0) return principal / n;
  // expm1 avoids cancellation at tiny rates and overflow at long terms.
  return principal * i / -Math.expm1(-n * Math.log1p(i));
}

/** Annual debt service (12 monthly payments). If interestOnly, pay interest only. */
export function annualDebtService(
  principal: number,
  annualRate: number,
  years: number,
  interestOnly = false,
): number {
  if (principal <= 0) return 0;
  if (interestOnly) return principal * annualRate;
  return monthlyMortgagePayment(principal, annualRate, years) * 12;
}

/**
 * Remaining loan balance after `monthsPaid` monthly payments of a fully
 * amortizing loan. B_k = P(1+i)^k - PMT * ((1+i)^k - 1)/i
 */
export function remainingBalance(
  principal: number,
  annualRate: number,
  years: number,
  monthsPaid: number,
  interestOnly = false,
): number {
  if (principal <= 0) return 0;
  if (interestOnly) return principal; // IO never amortizes principal
  const n = Math.round(years * 12);
  const k = Math.max(0, Math.min(Math.round(monthsPaid), n));
  if(k===0) return principal;
  if (k >= n) return 0;
  const i = annualRate / 12;
  if (i === 0) {
    const pmt = principal / n;
    return Math.max(0, principal - pmt * k);
  }
  const pmt = monthlyMortgagePayment(principal, annualRate, years);
  // PV of the payments still owed avoids subtracting large nearly equal sums.
  const bal = pmt * -Math.expm1(-(n-k) * Math.log1p(i)) / i;
  return Math.max(0, bal);
}

/** Interest paid over the first `months` months of the loan. */
export function interestPaidOverMonths(
  principal: number,
  annualRate: number,
  years: number,
  months: number,
  interestOnly = false,
): number {
  if (principal <= 0) return 0;
  if (interestOnly) return principal * annualRate * (months / 12);
  const pmt = monthlyMortgagePayment(principal, annualRate, years);
  const endBal = remainingBalance(principal, annualRate, years, months);
  const principalPaid = principal - endBal;
  const totalPaid = pmt * Math.max(0, Math.min(months, Math.round(years * 12)));
  return Math.max(0, totalPaid - principalPaid);
}

/**
 * Net Operating Income.
 * GPR (gross potential rent) - vacancy loss + other income - operating expenses.
 * Vacancy is applied to GPR only (not to other income), the standard convention.
 */
export interface NoiInputs {
  gross_potential_rent: number; // annual
  other_income: number; // annual
  vacancy_rate: number; // decimal
  operating_expenses: number; // annual total
  concessions?: number; // annual dollars, additional to vacancy
  bad_debt?: number; // annual dollars, additional to vacancy
}

export function effectiveGrossIncome(inp: NoiInputs): number {
  const vacancyLoss = inp.gross_potential_rent * inp.vacancy_rate;
  return inp.gross_potential_rent - vacancyLoss - (inp.concessions ?? 0) - (inp.bad_debt ?? 0) + inp.other_income;
}

export function noi(inp: NoiInputs): number {
  return effectiveGrossIncome(inp) - inp.operating_expenses;
}

/** Cap rate = NOI / value. */
export function capRate(noiValue: number, value: number): number {
  if (value <= 0) return 0;
  return noiValue / value;
}

/** Debt Service Coverage Ratio = NOI / annual debt service. */
export function dscr(noiValue: number, annualDebt: number): number {
  if (annualDebt <= 0) return Infinity;
  return noiValue / annualDebt;
}

/** Cash flow before tax = NOI - annual debt service. */
export function cashFlowBeforeTax(noiValue: number, annualDebt: number): number {
  return noiValue - annualDebt;
}

/** Cash-on-cash return = CFBT / total cash invested. */
export function cashOnCash(cfbt: number, cashInvested: number): number {
  if (cashInvested <= 0) return 0;
  return cfbt / cashInvested;
}

/** Gross Rent Multiplier = price / annual gross rent. */
export function grossRentMultiplier(price: number, annualGrossRent: number): number {
  if (annualGrossRent <= 0) return 0;
  return price / annualGrossRent;
}

/**
 * Economic break-even occupancy: the physical occupancy at which collected
 * income exactly covers operating expenses + debt service.
 * Fixed other income is independent of rent occupancy, as in EGI.
 * = max(0, OpEx + Debt Service + concessions + bad debt − other income) / GPR.
 * Returns a decimal; > 1 means the deal cannot break even even at 100% occupancy.
 */
export function breakEvenOccupancy(
  operatingExpenses: number,
  annualDebt: number,
  grossPotentialRent: number,
  otherIncome = 0,
  incomeLosses = 0,
): number {
  if (grossPotentialRent <= 0) return NaN;
  return Math.max(0, operatingExpenses + annualDebt + incomeLosses - otherIncome) / grossPotentialRent;
}

/** Net present value of a cash flow series at a given periodic rate.
 * flows[0] is period 0 (undiscounted). */
export function npv(rate: number, flows: number[]): number {
  let acc = 0;
  for (let t = 0; t < flows.length; t++) {
    acc += flows[t]! / Math.pow(1 + rate, t);
  }
  return acc;
}

/**
 * Internal Rate of Return of a cash flow series (period 0 is the investment).
 * Legacy numeric facade; explicit validity/status is available from timedIrr.
 * Returns NaN internally if invalid; application boundaries use nullable status.
 */
export interface TimedCashFlow { time: number; amount: number }
export interface IrrResult {
  value: number | null;
  status: 'ok' | 'invalid_input' | 'no_sign_change' | 'zero_investment' | 'near_zero_investment' | 'non_conventional' | 'out_of_range' | 'non_convergence';
}

/** Conservative uniqueness policy: one sign change only. Multiple sign
 * changes can have several roots; do not select one using an arbitrary guess.
 * Solve in log(1+r), scaled by the largest flow. Annual rates, timed in years. */
export function timedIrr(flows: TimedCashFlow[], maxIterations = 256): IrrResult {
  const unavailable=(status:IrrResult['status']):IrrResult=>({value:null,status});
  if(flows.length<2 || flows.some(f=>!Number.isFinite(f.amount)||!Number.isFinite(f.time)||f.time<0)) return unavailable('invalid_input');
  const byTime=new Map<number,number>();
  for(const f of flows) byTime.set(f.time,(byTime.get(f.time) ?? 0)+f.amount);
  const series=[...byTime].sort((a,b)=>a[0]-b[0]);
  if(series.some(([,a])=>!Number.isFinite(a))) return unavailable('invalid_input');
  const scale=Math.max(...series.map(([,a])=>Math.abs(a)));
  const first=series[0];
  if(!first || first[0]!==0 || first[1]>=0) return unavailable(first?.[1]===0 ? 'zero_investment' : 'no_sign_change');
  if(Math.abs(first[1])<1e-8 || Math.abs(first[1])/scale<1e-12) return unavailable('near_zero_investment');
  const nonzero=series.filter(([,a])=>a!==0);
  let changes=0;
  for(let i=1;i<nonzero.length;i++) if(Math.sign(nonzero[i]![1])!==Math.sign(nonzero[i-1]![1])) changes++;
  if(changes===0) return unavailable('no_sign_change');
  if(changes>1) return unavailable('non_conventional');
  // log-sum scaling avoids overflow near -100% and on extreme magnitudes.
  const residual=(x:number)=>{
    const exps=series.map(([t,a])=>a===0 ? -Infinity : Math.log(Math.abs(a)/scale)-t*x);
    const shift=Math.max(...exps);
    return series.reduce((sum,[,a],i)=>sum+Math.sign(a)*Math.exp(exps[i]!-shift),0);
  };
  let lo=-30,hi=30,flo=residual(lo),fhi=residual(hi);
  if(!Number.isFinite(flo)||!Number.isFinite(fhi)||flo*fhi>0) return unavailable('out_of_range');
  for(let i=0;i<maxIterations;i++){
    const mid=(lo+hi)/2,f=residual(mid);
    if(!Number.isFinite(f)) return unavailable('non_convergence');
    if(Math.abs(f)<1e-12){
      const value=Math.expm1(mid);
      return Number.isFinite(value) && value>-1 ? {value,status:'ok'} : unavailable('out_of_range');
    }
    if(flo*f<=0){hi=mid;fhi=f;}else{lo=mid;flo=f;}
  }
  return unavailable('non_convergence');
}

/** Legacy numeric primitive: unavailable is NaN; user-facing models use status. */
export function irr(flows: number[], _guess = 0.1): number {
  return timedIrr(flows.map((amount,time)=>({amount,time}))).value ?? NaN;
}

/**
 * Equity multiple = total cash returned to the investor / equity invested.
 * distributions are the periodic positive cash flows; saleProceeds is net at exit.
 */
export function equityMultiple(
  equityInvested: number,
  distributions: number[],
  saleProceeds: number,
): number {
  if (equityInvested <= 0) return 0;
  const all=[...distributions,saleProceeds];
  const contributed=equityInvested+all.reduce((a,b)=>a+Math.max(0,-b),0);
  const returned=all.reduce((a,b)=>a+Math.max(0,b),0);
  return returned / contributed;
}
