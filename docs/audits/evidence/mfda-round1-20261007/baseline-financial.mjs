// Re-execute immutable starting-SHA financial sources, even after remediation.
// No dotenv, database or provider access. All fixture numbers are synthetic.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile),evidence=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(evidence,'../../../..');
const sha='ae5426a39e5a689a8eece17ae8f096edfd8924be',dir=await mkdtemp('/private/tmp/mfda-round1-financial-baseline-');
const {stdout}=await exec('git',['ls-tree','-r','--name-only',sha,'packages/mf-calc/src','mfda/src/lib/underwrite.js'],{cwd:repo});
for(const f of stdout.trim().split('\n')){
  await mkdir(path.dirname(path.join(dir,f)),{recursive:true});
  const {stdout:source}=await exec('git',['show',`${sha}:${f}`],{cwd:repo});await writeFile(path.join(dir,f),source);
}
const {build}=await import(path.join(repo,'mfda/node_modules/esbuild/lib/main.js'));
async function module(entry,name){
  const outfile=path.join(dir,name+'.mjs');
  await build({entryPoints:[path.join(dir,entry)],outfile,bundle:true,platform:'node',format:'esm',
    alias:{'@alot/mf-calc':path.join(dir,'packages/mf-calc/src/index.ts')}});
  return import(pathToFileURL(outfile));
}
const calc=await module('packages/mf-calc/src/index.ts','calc'),{underwrite}=await module('mfda/src/lib/underwrite.js','bridge');
const p={price:500000,land_value:100000,hold_years:10,
  units:[{type:'2BR',count:4,sqft:850,actual_rent:1200,market_rent:1500}],expenses:{insurance:3000,management:5000}};
const hold=calc.buildProforma({gross_potential_rent:24000,other_income:0,vacancy_rate:0,operating_expenses:0,growth_rate:0,
  loan_amount:12000,annual_rate:0,amort_years:1,hold_years:2,exit_cap_rate:.1,selling_cost_rate:0,cash_invested:100000});
const balloon=years=>underwrite({...p,financing:{seller:{balloon_years:years}}}).financing.seller_forward;
const other=underwrite({price:300000,property_tax_rate:0,vacancy_rate:0,other_income:12000,
  units:[{type:'synthetic',count:5,sqft:800,actual_rent:1000,market_rent:1000}],expenses:{insurance:36000},financing:{dscr:{ltv:0}}});
const short=calc.forward({price:100,noi:20,gross_potential_income:20,operating_expenses:0,loan_amount:0,
  annual_rate:0,amort_years:30,cash_invested:100,hold_years:.5,exit_cap_rate:.1,selling_cost_rate:0,noi_growth_rate:0});
const observations={starting_sha:sha,extracted:dir,calc_version:calc.CALC_VERSION,
  debt_after_payoff:hold.years[1],balloon_3_irr:balloon(3).irr,balloon_9_irr:balloon(9).irr,
  nan_flow_irr:calc.irr([-100,NaN,200]),
  high_other_income:{gpr:other.derived.gpr_market,other_income:12000,opex:other.derived.opex_total,displayed_beo:other.financing.dscr.break_even_occupancy,expected_beo:.4},
  rehab_basis:{without:underwrite(p).tax.depreciation.depreciable_basis,with:underwrite({...p,rehab:100000}).tax.depreciation.depreciable_basis},
  mismatched_known_count:{sourced:12,calculated:underwrite({...p,units_count:12}).derived.units_total},
  fractional_hold:{irr:String(short.irr),sale_value:short.exit_value,net_sale_proceeds:short.net_sale_proceeds},
  invalid_input_acceptance:{vacancy:underwrite({...p,vacancy_rate:1.5}).derived.noi,ltv:underwrite({...p,financing:{dscr:{ltv:1.2}}}).financing.dscr.cash_on_cash},
};
await writeFile(path.join(evidence,'immutable-starting-financial.json'),JSON.stringify(observations,null,2)+'\n');
console.log(JSON.stringify(observations,null,2));
