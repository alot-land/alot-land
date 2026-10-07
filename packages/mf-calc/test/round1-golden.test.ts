import { describe, it, expect } from 'vitest';
import { debtSchedule, aggregateDebt, monthlyMortgagePayment, remainingBalance, interestPaidOverMonths,
  buildProforma, forward, timedIrr, irr, equityMultiple, breakEvenOccupancy, noi,
  depreciation, depreciationOverHold, exitTax, totalCashInvested, equityCapture,
  minDownForTargets,maxOfferForTargets,firstPeriodDebtService,dscrConstrainedValue,estimateOperatingExpenses,strComparison,screenParcel } from '../src/index.js';
// @ts-expect-error Production JS bridge intentionally has no TS declaration.
import { underwrite } from '../../../mfda/src/lib/underwrite.js';
// @ts-expect-error Production JS input helpers.
import { unitsForProperty, hydrateUnderwritingForm } from '../../../mfda/src/lib/underwriting-inputs.js';
// @ts-expect-error Production JS formatting boundary.
import { pct, ratio } from '../../../mfda/src/lib/format.js';

const terms={loan_amount:12000,annual_rate:0,amort_years:1};
const base={gross_potential_rent:60000,other_income:12000,vacancy_rate:.1,operating_expenses:24000,
  growth_rate:0,loan_amount:0,annual_rate:0,amort_years:30,hold_years:2,exit_cap_rate:.1,
  selling_cost_rate:.05,cash_invested:300000};
const property={price:300000,land_value:60000,property_tax_rate:0,vacancy_rate:.1,
  hold_years:2,exit_cap_rate:.1,selling_cost_rate:.05,noi_growth_rate:0,closing_cost_rate:0,
  units:[{type:'operator assumption',count:5,sqft:800,actual_rent:900,market_rent:1000}],
  other_income:12000,expenses:{insurance:24000},financing:{dscr:{ltv:0,rate:0}}};

/** Separate payment-by-payment oracle: binary search a payment by simulation
 * (does not call the mortgage formula), then update the loan each month. */
function oracle(principal:number,rate:number,n:number,k:number){
  const balance=(payment:number)=>{let b=principal;for(let m=0;m<n;m++)b=b*(1+rate/12)-payment;return b;};
  let lo=0,hi=principal*(1+rate/12);
  for(let j=0;j<150;j++){const p=(lo+hi)/2;if(balance(p)>0)lo=p;else hi=p;}
  const payment=(lo+hi)/2;
  let b=principal,totalInterest=0,totalPaid=0;
  for(let m=0;m<Math.min(k,n);m++){const interest=b*rate/12,p=Math.min(payment,b+interest);b=Math.max(0,b+interest-p);totalInterest+=interest;totalPaid+=p;}
  return {payment,balance:b,interest:totalInterest,paid:totalPaid};
}

describe('Round 1 independent debt ledger',()=>{
  for(const [principal,rate,years,hold] of [[375000,.07,30,5],[12000,0,1,3],[10000,.12,2,1],[10000,1e-12,1,2],[750000,.08,30,40]]){
    it(`payment ledger ${principal}/${rate}/${years}/${hold}`,()=>{
      const n=years!*12,k=hold!*12,o=oracle(principal!,rate!,n,k);
      const rows=debtSchedule({loan_amount:principal!,annual_rate:rate!,amort_years:years!},k);
      const a=aggregateDebt(rows);
      expect(monthlyMortgagePayment(principal!,rate!,years!)).toBeCloseTo(o.payment,7);
      expect(rows.at(-1)!.closing_balance).toBeCloseTo(o.balance,6);
      expect(a.interest).toBeCloseTo(o.interest,6);
      expect(a.debt_service).toBeCloseTo(o.paid,6);
      expect(remainingBalance(principal!,rate!,years!,k)).toBeCloseTo(o.balance,6);
      expect(interestPaidOverMonths(principal!,rate!,years!,k)).toBeCloseTo(o.interest,6);
      expect(rows.every(r=>r.closing_balance>=0&&r.interest>=0&&r.principal>=0)).toBe(true);
    });
  }
  it('partial IO then zero-rate amortization: 6 IO months + 12 principal payments',()=>{
    const rows=debtSchedule({...terms,interest_only_months:6},24);
    expect(rows.slice(0,6).every(r=>r.payment===0&&r.closing_balance===12000)).toBe(true);
    expect(rows[6]!.payment).toBe(1000);
    expect(rows[17]!.closing_balance).toBe(0);
    expect(rows.slice(18).every(r=>r.payment===0&&r.interest===0)).toBe(true);
    expect(aggregateDebt(rows).debt_service).toBe(12000);
  });
  it('IO at 12% then amortization has the correct reset payment',()=>{
    const rows=debtSchedule({...terms,annual_rate:.12,interest_only_months:12},30);
    const o=oracle(12000,.12,12,12);
    expect(rows[0]!.payment).toBe(120);
    expect(rows[12]!.payment).toBeCloseTo(o.payment,7);
    expect(rows.slice(24).every(r=>r.debt_service===0)).toBe(true);
  });
  it('fully IO maturity repays the principal and stops all later interest',()=>{
    const rows=debtSchedule({...terms,annual_rate:.12,interest_only:true},24);
    expect(rows[11]!.payoff).toBe(12000);
    expect(aggregateDebt(rows).debt_service).toBe(13440);
    expect(rows.slice(12).every(r=>r.interest===0&&r.debt_service===0)).toBe(true);
  });
  for(const event of [{payoff_month:6},{balloon_years:.5}]){
    it(`early repayment ${JSON.stringify(event)} after payment`,()=>{
      const rows=debtSchedule({...terms,...event},24);
      expect(rows[5]!.principal).toBe(1000);
      expect(rows[5]!.payoff).toBe(6000);
      expect(rows.slice(6).every(r=>r.debt_service===0)).toBe(true);
      expect(aggregateDebt(rows).principal).toBe(12000);
    });
  }
  it('sale before maturity leaves the balance for the exit waterfall',()=>{
    const p=buildProforma({...base,...terms,hold_years:.5});
    expect(p.years[0]!.months).toBe(6);
    expect(p.years[0]!.debt_service).toBe(6000);
    expect(p.exit.loan_payoff).toBe(6000);
    expect(p.exit.net_sale_proceeds).toBe(393000);
    expect(p.equity_cash_flows.at(-1)!.time).toBe(.5);
    expect(p.equity_cash_flows.at(-1)!.amount).toBe(395500);
  });
  it('refinance at maturity replaces the old loan once, new starts next month',()=>{
    const rows=debtSchedule({...terms,balloon_years:.5},24,{month:6,loan_amount:9000,annual_rate:0,amort_years:1,financing_costs:300});
    expect(rows[5]!.payoff).toBe(6000);
    expect(rows[5]!.refinance_proceeds).toBe(9000);
    expect(rows[5]!.financing_costs).toBe(300);
    expect(rows[5]!.closing_balance).toBe(9000);
    expect(rows[6]!.payment).toBe(750);
    expect(rows[17]!.closing_balance).toBe(0);
    expect(rows[18]!.payment).toBe(0);
  });
  it('rejects invalid periods and a refinance at/after sale',()=>{
    expect(()=>debtSchedule(terms,6,{month:6,...terms})).toThrow();
    expect(()=>buildProforma({...base,hold_years:.123})).toThrow(/month/);
    expect(()=>debtSchedule({...terms,annual_rate:NaN},12)).toThrow();
  });
});

describe('Golden deals A–J and cross-metric truth',()=>{
  it('A stabilized: literal rent roll/income/NOI/cap/exit/equity ledger',()=>{
    const out=underwrite(property);
    expect(out.derived.gpr_market).toBe(60000);
    expect(out.derived.gpr_actual).toBe(54000);
    expect(out.derived.loss_to_lease).toBe(.1);
    expect(out.derived.egi).toBe(66000);
    expect(out.derived.noi).toBe(42000);
    expect(out.derived.cap_rate_on_price).toBe(.14);
    expect(out.financing.dscr.cash_on_cash).toBe(.14);
    expect(out.financing.dscr.break_even_occupancy).toBe(.2);
    expect(out.financing.dscr.dscr).toBeNull();
    expect(out.proforma.exit.exit_value).toBe(420000);
    expect(out.proforma.exit.selling_costs).toBe(21000);
    expect(out.proforma.exit.net_sale_proceeds).toBe(399000);
    expect(out.proforma.exit.equity_multiple).toBeCloseTo(483000/300000,12);
    // Independent monthly PV residual in dollars, not engine npv.
    const r=out.financing.dscr.irr;
    expect(r).toBeGreaterThan(0);
    let pv=-300000;for(let m=1;m<=24;m++)pv+=(3500+(m===24?399000:0))/(1+r)**(m/12);
    expect(Math.abs(pv)).toBeLessThan(.0001);
  });
  it('B value-add: upfront rehab and financing fees reconcile sources/uses and basis',()=>{
    const out=underwrite({...property,rehab:40000,furnishing:10000,financing_fees:3000,lender_costs:2000,
      initial_reserves:5000,seller_credits:1000,financing:{dscr:{ltv:.5,rate:0,amort_years:30}}});
    const equity=209000; // 150k down +40k+10k+3k+2k+5k−1k
    expect(out.proforma.equity_cash_flows[0].amount).toBe(-equity);
    expect(out.tax.depreciation.depreciable_basis).toBe(280000);
    expect(out.proforma.exit.reserve_return).toBe(5000);
    expect(out.financing.dscr.cash_on_cash).toBeCloseTo(37000/equity,12);
    expect(out.financing.dscr.dscr).toBeCloseTo(42000/5000,12);
    expect(out.financing.dscr.debt_yield).toBe(.28);
    expect(out.financing.dscr.break_even_occupancy).toBeCloseTo(17000/60000,12);
  });
  it('C IO loan: interest, service, and remaining balance',()=>{
    const p=buildProforma({...base,loan_amount:100000,annual_rate:.06,interest_only:true});
    expect(p.years[0]!.interest).toBe(6000);
    expect(p.years[0]!.principal).toBe(0);
    expect(p.exit.loan_payoff).toBe(100000);
    expect(p.exit.net_sale_proceeds).toBe(299000);
  });
  it('D seller-financed balloons: literal timing, debt total and numeric IRR change',()=>{
    const input={...property,other_income:600000,hold_years:10,financing:{seller:{down_fraction:.9}}};
    const a=underwrite({...input,financing:{seller:{down_fraction:.9,balloon_years:3}}}).financing.seller_forward;
    const b=underwrite({...input,financing:{seller:{down_fraction:.9,balloon_years:9}}}).financing.seller_forward;
    expect(a.irr_status).toBe('ok');expect(b.irr_status).toBe('ok');
    expect(a.irr).not.toBe(b.irr);
    expect(a.proforma.debt_schedule[35].payoff).toBeGreaterThan(0);
    expect(a.proforma.debt_schedule[35].payoff).toBeCloseTo(oracle(30000,.06,360,36).balance,7);
    expect(a.proforma.debt_schedule[36].debt_service).toBe(0);
    expect(b.proforma.debt_schedule[107].payoff).toBeGreaterThan(0);
    expect(a.equity_multiple).not.toBe(b.equity_multiple);
    for(const f of [a,b]){
      const residual=f.proforma.equity_cash_flows.reduce((sum:number,flow:{time:number,amount:number})=>
        sum+flow.amount/(1+f.irr)**flow.time,0);
      expect(Math.abs(residual)).toBeLessThan(.001);
    }
  });
  it('E refinance: literal old payoff/cash-out/new balance/returns',()=>{
    const p=buildProforma({...base,...terms,refinance:{month:6,loan_amount:9000,annual_rate:0,amort_years:1,financing_costs:300}});
    expect(p.years[0]!.debt_service).toBe(16500);
    expect(p.years[0]!.refinance_proceeds).toBe(9000);
    expect(p.years[1]!.debt_service).toBe(4500);
    expect(p.exit.loan_payoff).toBe(0);
    expect(p.exit.total_profit).toBe(170700);
    expect(p.equity_cash_flows[6]!.amount).toBe(5200); // 3500−1000−6000+9000−300
  });
  it('F sale before maturity: sale proceeds include only the remaining payoff',()=>{
    const p=buildProforma({...base,...terms,hold_years:.5});
    expect(p.exit.loan_payoff).toBe(6000);
    expect(p.exit.total_profit).toBe(108000); // 21k NOI−6k debt+393k sale−300k
  });
  it('fractional hold includes a financially positive exit in timed IRR',()=>{
    const f=forward({price:100,noi:20,gross_potential_income:20,operating_expenses:0,
      loan_amount:0,annual_rate:0,amort_years:30,cash_invested:100,hold_years:.5,
      exit_cap_rate:.1,selling_cost_rate:0,noi_growth_rate:0});
    expect(f.irr_status).toBe('ok');expect(f.irr).toBeGreaterThan(3);
    expect(f.net_sale_proceeds).toBe(200);
    const residual=f.proforma.equity_cash_flows.reduce((sum,flow)=>sum+flow.amount/(1+f.irr!)**flow.time,0);
    expect(Math.abs(residual)).toBeLessThan(.000001);
  });
  it('G high other income: occupancy independently solves collections = costs',()=>{
    const occupancy=breakEvenOccupancy(36000,0,60000,12000);
    expect(occupancy).toBe(.4);
    expect(60000*occupancy+12000).toBe(36000);
    expect(breakEvenOccupancy(1000,0,60000,12000)).toBe(0);
    expect(breakEvenOccupancy(80000,12000,60000,12000)).toBeGreaterThan(1);
  });
  it('H negative/no IRR: no fabricated sale value or return',()=>{
    const p=forward({price:300000,noi:-12000,gross_potential_income:12000,operating_expenses:24000,
      loan_amount:0,annual_rate:0,amort_years:30,hold_years:2,exit_cap_rate:.1,cash_invested:300000});
    expect(p.irr).toBeNull();expect(p.irr_status).toBe('no_sign_change');
    expect(p.exit_value).toBe(0);
    expect(p.equity_multiple).toBe(0);
  });
  it('I zero/near-zero equity: explicit unavailability survives JSON',()=>{
    for(const invested of [0,1e-10]){
      const out=underwrite({...property,closing_cost_rate:0,rehab:invested,financing:{dscr:{ltv:1,rate:0,amort_years:30}}});
      // Zero initial equity is not a valid return denominator.
      expect(out.financing.dscr.irr).toBeNull();
    }
    expect(timedIrr([{time:0,amount:-1e-10},{time:1,amount:1}]).status).toBe('near_zero_investment');
  });
  it('J incomplete units: sourced count survives while actual rents/SF remain unknown',()=>{
    const mix=unitsForProperty({units_count:12},[]);
    expect(mix[0].count).toBe(12);expect(mix[0].actual_rent).toBeNull();expect(mix[0].sqft).toBeNull();
    expect(()=>underwrite({...property,units:mix,units_count:12})).toThrow(/rent/i);
    const market=underwrite({...property,units:mix.map((u:object)=>({...u,market_rent:1000})),units_count:12});
    expect(market.derived.gpr_actual).toBeNull();expect(market.derived.loss_to_lease).toBeNull();expect(market.derived.sqft_total).toBeNull();
  });
});

describe('Round 1 numerical, tax and scenario boundaries',()=>{
  it('inverse solvers and valuation use actual IO/balloon first-period coverage',()=>{
    const loan={annual_rate:.12,amort_years:30,interest_only_months:12,hold_months:6};
    expect(firstPeriodDebtService({...loan,loan_amount:100000},6)).toBe(12000);
    const a=minDownForTargets({...loan,price:100000,noi:24000,other_cash:10000,min_dscr:2,target_coc:.1});
    expect(a!.down_payment).toBe(0);expect(a!.dscr).toBe(2);expect(a!.cash_on_cash).toBe(1.2);
    const b=maxOfferForTargets({...loan,noiAtPrice:()=>24000,gross_potential_income:24000,
      ltv:1,closing_rate:0,flat_cash:10000,min_dscr:2,target_coc:.1,price_high:120000});
    expect(b!.max_offer).toBeCloseTo(100000,0);
    expect(dscrConstrainedValue({...loan,noi:24000,min_dscr:2,ltv:1})).toBeCloseTo(100000,7);
    expect(firstPeriodDebtService({...terms,balloon_years:.5})).toBe(12000);
    expect(()=>minDownForTargets({...loan,price:100000,noi:24000,other_cash:10000,min_dscr:2,target_coc:.1,step:0})).toThrow();
  });
  it('management estimate uses EGI including fixed other income and losses',()=>{
    expect(estimateOperatingExpenses({units:5,gross_potential_rent:60000,vacancy_rate:.1,
      other_income:12000,concessions:2000,bad_debt:1000}).management).toBe(63000*.08);
  });
  it('STR shares the LTR debt ledger and refi inverse solvers are explicitly withheld',()=>{
    const s=strComparison({units:1,adr:100,occupancy_rate:.5,avg_stay_days:1,cost_per_turn:0,
      str_management_rate:0,platform_fee_rate:0,base_operating_expenses:0,loan_amount:12000,
      annual_rate:.1,amort_years:30,annual_debt_service:12000,cash_invested:10000,ltr_noi:0,ltr_cfbt:0});
    expect(s!.cfbt).toBe(6250);
    const p=underwrite({...property,financing:{dscr:{ltv:.25,rate:0,refinance:{month:12,loan_amount:50000,annual_rate:0,amort_years:30}}}});
    expect(p.solvers.min_down).toBeNull();expect(p.solvers.max_offer).toBeNull();expect(p.solvers.unavailable_reason).toMatch(/refinance/);
  });
  for(const f of [[100,200],[-100,-200],[0,100],[-100,NaN,200],[-100,Infinity,200]]){
    it(`invalid/no-sign cash series ${String(f)}`,()=>expect(Number.isNaN(irr(f))).toBe(true));
  }
  it('two IRR roots (10%/20%) are explicitly unavailable',()=>{
    expect(timedIrr([-100,230,-132].map((amount,time)=>({amount,time})))).toEqual({value:null,status:'non_conventional'});
  });
  it('zero iterations cannot masquerade as a converged root',()=>expect(timedIrr([{time:0,amount:-100},{time:1,amount:200}],0).status).toBe('non_convergence'));
  it('extreme scaling has the same economically valid IRR',()=>{
    expect(irr([-1e200,2e200])).toBeCloseTo(1,9);
    expect(irr([-100,1])).toBeCloseTo(-.99,9);
    expect(irr([-100,1100])).toBeCloseTo(10,8); // legitimate 1000%, finite valid flows
  });
  it('income losses are above NOI; vacancy not applied again to fixed income',()=>{
    expect(noi({...base,concessions:2000,bad_debt:1000})).toBe(39000);
    const out=underwrite({...property,concessions:2000,bad_debt:1000});
    expect(out.derived.noi).toBe(39000);
    expect(out.financing.dscr.break_even_occupancy).toBe(.25);
    expect(out.proforma.years[0].noi).toBe(39000);
  });
  it('replacement reserve included in NOI but added back for taxable income',()=>{
    const out=underwrite({...property,expenses:{insurance:24000,capex_reserve:1200}});
    expect(out.derived.noi).toBe(40800);
    expect(out.tax.year1.taxable_income).toBeCloseTo(42000-240000/27.5,8);
  });
  it('simplified depreciation includes land exclusion, improvements and service timing',()=>{
    const input={purchase_price:100000,land_value:20000,improvements:30000,capitalized_costs:1000,
      cost_seg_pct:.2,bonus_rate:.5,recovery_years:10,short_life_years:5,placed_in_service_month:7};
    const d=depreciation(input);
    expect(d.depreciable_basis).toBe(111000);
    expect(d.first_year_bonus).toBe(11100);
    expect(d.first_year_total).toBe(16650); // 11100 + 4440 + 1110
    expect(depreciationOverHold(input,6).total).toBe(0);
    expect(depreciationOverHold(input,12).total).toBe(16650);
    expect(depreciationOverHold(input,1200).total).toBe(111000);
  });
  it('exit basis/tax retains capex and explicit asset class amounts',()=>{
    const t=exitTax({purchase_price:100000,capital_improvements:30000,sale_price:140000,selling_costs:10000,
      accumulated_depreciation:20000,section1245_depreciation:5000,ordinary_rate:.4,recapture_rate:.25,ltcg_rate:.2});
    expect(t.adjusted_basis).toBe(110000);expect(t.total_gain).toBe(20000);
    expect(t.total_exit_tax).toBe(5750);
    expect(exitTax({purchase_price:100000,sale_price:70000,selling_costs:0,accumulated_depreciation:20000}).total_exit_tax).toBe(0);
  });
  it('initial funding fees/reserves/credits are accounted once',()=>{
    expect(totalCashInvested({down_payment:25000,closing_costs:2000,rehab:3000,furnishing:1000,
      financing_fees:500,lender_costs:200,initial_reserves:1000,seller_credits:700})).toBe(32000);
    const allCash=underwrite({...property,financing_fees:1000,lender_costs:500}).financing.dscr;
    expect(allCash.cash_invested).toBe(300000);expect(allCash.cash_on_cash).toBe(42000/300000);
    const levered=underwrite({...property,financing_fees:1000,lender_costs:500,financing:{dscr:{ltv:.25,rate:0}}});
    expect(levered.financing.dscr.cash_invested).toBe(226500);
    expect(levered.proforma.exit.equity_multiple).toBe(levered.financing.dscr.equity_multiple);
  });
  it('goal refi pays amortized balance and uses full new-minus-old service',()=>{
    const o=oracle(75000,.06,120,24);
    const out=equityCapture({purchase_price:100000,market_value:100000,down_payment_rate:.25,closing_cost_rate:0,
      bank_rate:.06,purchase_amort_years:10,refi_months:24,refi_ltv:.5,refi_rate:.09,refi_amort_years:20,refi_costs:1000});
    expect(out.purchase_payoff).toBeCloseTo(o.balance,7);
    expect(out.cash_in_at_refi).toBeCloseTo(o.balance+1000-50000,7);
    expect(out.equity_after_refi).toBe(50000);
    expect(out.added_monthly_debt_service).toBeCloseTo(oracle(50000,.09,240,1).payment-o.payment,7);
  });
  it('stored resolved inputs replay identically and scenarios do not mutate base',()=>{
    const input=structuredClone(property),before=JSON.stringify(input),a=underwrite(input);
    const up=underwrite({...input,other_income:20000});
    const down=underwrite({...input,vacancy_rate:.2});
    expect(up.derived.noi).toBe(50000);expect(down.derived.noi).toBe(36000);
    expect(JSON.stringify(input)).toBe(before);
    expect(underwrite(JSON.parse(JSON.stringify(a.resolved_inputs)))).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  it('hydrate uses the chosen snapshot price/units and preserves known zero assumptions',()=>{
    const snapshot=underwrite({...property,expenses:{insurance:0}}).resolved_inputs;
    const f=hydrateUnderwritingForm(snapshot,{id:'synthetic',price:999999,units_count:5},[{count:4}],{inputs:snapshot});
    expect(f.price).toBe(300000);expect(f.units[0].count).toBe(5);expect(f.expenses.insurance).toBe(0);
  });
  for(const patch of [{vacancy_rate:1.5},{exit_cap_rate:0},{price:0},{other_income:NaN},{financing:{dscr:{ltv:1.2}}},
    {assessment_ratio:-1},{str:{management_rate:-.2}},{targets:{min_dscr:0}}]){
    it(`reject invalid underwriting ${JSON.stringify(patch)}`,()=>expect(()=>underwrite({...property,...patch})).toThrow());
  }
  it('front-end displays invalid values as unavailable',()=>{
    expect(pct(NaN)).toBe('—');expect(pct(null)).toBe('—');expect(ratio(NaN)).toBe('—');expect(ratio(Infinity)).toBe('—');
  });
  it('discovery financial screens also reject non-finite and invalid assumptions',()=>{
    const input={units:4,market_rent_monthly:1500,price_anchor:500000};
    expect(screenParcel({...input,price_anchor:Infinity}).ok).toBe(false);
    expect(screenParcel({...input,ltv:1.5}).ok).toBe(false);
    expect(screenParcel({...input,ltv:0}).dscr).toBeNull();
  });
  it('additional equity contributions belong in the multiple denominator',()=>{
    expect(equityMultiple(100,[-50,30],200)).toBeCloseTo(230/150,12);
  });
});
