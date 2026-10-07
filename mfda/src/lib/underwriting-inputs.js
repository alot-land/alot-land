/** Keep unknown property facts out of unattended assumptions. */
export function unitsForProperty(deal, units = []) {
  if (units.length) return units.map(u => ({ ...u, count:Number(u.count),
    sqft:u.sqft == null ? null : Number(u.sqft),
    actual_rent:u.actual_rent == null ? null : Number(u.actual_rent),
    market_rent:u.market_rent == null ? null : Number(u.market_rent) }));
  if (deal.units_count > 0) return [{type:'Unknown mix',count:Number(deal.units_count),sqft:null,actual_rent:null,market_rent:null,provenance:'property count; rents/mix unknown'}];
  return [];
}

export function hydrateUnderwritingForm(blank, deal, units, scenario) {
  // A resolved immutable snapshot owns its assumptions and unit mix. Mutable
  // sourced property facts are shown separately and reconciled on next save.
  const base=scenario?.inputs || {};
  return { ...blank,...base,id:deal.id,units_count:deal.units_count,
    address:base.address ?? deal.address ?? '',city:base.city ?? deal.city ?? '',
    state:base.state ?? deal.state ?? '',zip:base.zip ?? deal.zip ?? '',
    apn:base.apn ?? deal.apn ?? '',county_fips:base.county_fips ?? deal.county_fips ?? '',
    year_built:base.year_built ?? deal.year_built,price:base.price ?? (deal.price == null ? null : Number(deal.price)),
    status:deal.status,units:unitsForProperty(deal,base.units ?? units),
    financing:{...blank.financing,...base.financing},tax:{...blank.tax,...base.tax},
    expenses:{...blank.expenses,...base.expenses},str:{...blank.str,...base.str},
    prescreen:{...blank.prescreen,...base.prescreen} };
}

export function assertFiniteInputs(value, path='inputs') {
  if(typeof value==='number' && !Number.isFinite(value)) throw new RangeError(`${path} must be finite`);
  if(value && typeof value==='object') for(const [key,v] of Object.entries(value)) assertFiniteInputs(v,`${path}.${key}`);
}

export function validateUnderwriting(d) {
  assertFiniteInputs(d);
  const amount=(v,name,positive=false)=>{
    if(typeof v!=='number'||!Number.isFinite(v)||v<0||(positive&&v===0)) throw new RangeError(`${name} is incomplete or invalid`);
  };
  const rate=(v,name)=>{amount(v,name);if(v>1) throw new RangeError(`${name} must be a decimal from 0 to 1`);};
  amount(d.price,'Purchase price',true);
  for(const key of ['vacancy_rate','closing_cost_rate','selling_cost_rate','exit_cap_rate','property_tax_rate']) rate(d[key],key);
  if(d.exit_cap_rate===0) throw new RangeError('Exit cap rate must be positive');
  if(d.noi_growth_rate<=-1 || d.noi_growth_rate>1) throw new RangeError('NOI growth rate is invalid');
  if(!d.units?.length) throw new RangeError('Unit data is incomplete');
  const count=d.units.reduce((a,u)=>a+Number(u.count),0);
  if(d.units_count != null && Number(d.units_count)!==count && !d.unit_count_override_reason)
    throw new RangeError('Unit mix does not match the sourced property count; enter an override reason');
  for(const u of d.units){
    amount(u.count,'Unit count',true);
    if(!Number.isInteger(u.count)) throw new RangeError('Unit count must be an integer');
    amount(d.rent_basis==='actual' ? u.actual_rent : u.market_rent,'Selected unit rent');
    for(const key of ['sqft','actual_rent','market_rent']) if(u[key]!=null) amount(u[key],`Unit ${key}`);
  }
  for(const v of Object.values(d.expenses)) amount(v,'Operating expense');
  for(const key of ['other_income','rehab','furnishing','financing_fees','lender_costs','initial_reserves','seller_credits','concessions','bad_debt','land_value']) amount(d[key] ?? 0,key);
  if(d.land_value>d.price) throw new RangeError('Land value exceeds purchase price');
  rate(d.assessment_ratio,'Assessment ratio');
  amount(d.targets.min_dscr,'Minimum DSCR',true);amount(d.targets.target_coc,'Target CoC');
  if(d.str){
    for(const key of ['occupancy_rate','management_rate','platform_fee_rate']) if(d.str[key]!=null) rate(d.str[key],`STR ${key}`);
    for(const key of ['adr','cost_per_turn','cleaning_fee_per_stay']) if(d.str[key]!=null) amount(d.str[key],`STR ${key}`);
    if(d.str.avg_stay_days!=null) amount(d.str.avg_stay_days,'STR average stay',true);
  }
  for(const key of ['dscr','agency']){
    const t=d.financing[key];rate(t.ltv,`${key} LTV`);rate(t.rate,`${key} rate`);amount(t.amort_years,`${key} amortization`,true);
  }
  const seller=d.financing.seller;
  amount(seller.balloon_years,'Seller balloon',true);
  for(const key of ['low_rate','mid_rate','cash_discount','down_fraction']) rate(seller[key],`Seller ${key}`);
  for(const key of ['cost_seg_pct','bonus_rate','marginal_rate','recapture_rate','ltcg_rate']) rate(d.tax[key],`Tax ${key}`);
  rate(d.tax.section1245_fraction ?? 0,'Tax asset fraction');
  amount(d.tax.capitalized_acquisition_costs ?? 0,'Capitalized acquisition costs');
  amount(d.tax.passive_income_available ?? 0,'Passive income available');
  if((d.tax.capitalized_acquisition_costs ?? 0)>d.price*d.closing_cost_rate) throw new RangeError('Capitalized acquisition costs exceed property closing costs');
}

/** Explicit unavailable values survive JSON. Record the paths for review. */
export function financialSnapshot(value) {
  const unavailable=[];
  function visit(v,p){
    if(typeof v==='number' && !Number.isFinite(v)){unavailable.push(p);return null;}
    if(typeof v==='number' && Object.is(v,-0)) return 0;
    if(Array.isArray(v)) return v.map((x,i)=>visit(x,`${p}.${i}`));
    if(v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,p?`${p}.${k}`:k)]));
    return v;
  }
  const out=visit(value,'');
  return {...out,unavailable_metrics:unavailable};
}
