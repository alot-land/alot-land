/**
 * @alot/mf-calc — MFDA underwriting calc engine.
 *
 * The ONLY place financial arithmetic is allowed to live. Pure functions,
 * fully unit-tested, frozen once green (bump CALC_VERSION + add tests first to
 * change any formula). LLMs populate inputs and write narrative — never math.
 */
export * from './types.js';
export * from './finance.js';
export * from './unitMix.js';
export * from './property.js';
export * from './valuation.js';
export * from './financing.js';
export * from './tax.js';
export * from './stress.js';
export * from './prescreen.js';
export * from './scoring.js';
export * from './comps.js';
export * from './proforma.js';
export * from './markets.js';
export * from './offmarket.js';
export * from './goals.js';
