#!/usr/bin/env node
// Guards the money maths.
//
// The bug this exists to prevent: on 2026-06-09 commit a2be3ee added the
// SASM department to worker.js and commit f24d684 removed it again. For
// two months the dashboard showed SASM engine replacements at $13,500
// while the bot paid $12,000. Nothing failed, because nothing checked.
//
// Run: node test-rates.mjs

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PAYMENT_RATES,
  DEPARTMENT_ENGINE_BONUS,
  DEFAULT_DEPARTMENTS,
  departmentEngineBonus,
  computeEnginePayShared,
} from './rates.js';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;

function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

console.log('\nEngine bonus by department');

check('LSPD gets the government bonus', () =>
  assert.strictEqual(departmentEngineBonus('LSPD'), 1500));

check('ODPD gets the government bonus', () =>
  assert.strictEqual(departmentEngineBonus('ODPD'), 1500));

// The regression test. This is the one that was missing.
check('SASM gets the government bonus (regression: f24d684)', () =>
  assert.strictEqual(departmentEngineBonus('SASM'), 1500));

check('BCSO gets no bonus', () =>
  assert.strictEqual(departmentEngineBonus('BCSO'), 0));

check('CIV and EMS get no bonus', () => {
  assert.strictEqual(departmentEngineBonus('CIV'), 0);
  assert.strictEqual(departmentEngineBonus('EMS'), 0);
});

check('unknown department falls back to 0, not a crash', () =>
  assert.strictEqual(departmentEngineBonus('NOT_A_DEPT'), 0));

check('department lookup ignores case and whitespace', () => {
  assert.strictEqual(departmentEngineBonus(' sasm '), 1500);
  assert.strictEqual(departmentEngineBonus('LsPd'), 1500);
});

check('null and undefined are handled', () => {
  assert.strictEqual(departmentEngineBonus(null), 0);
  assert.strictEqual(departmentEngineBonus(undefined), 0);
});

check('every advertised department has an explicit bonus entry', () => {
  for (const d of DEFAULT_DEPARTMENTS) {
    assert.ok(d in DEPARTMENT_ENGINE_BONUS,
      `${d} is offered in the UI but has no engine-bonus entry`);
  }
});

console.log('\nEngine pay per job');

check('mechanic bought a SASM engine: 12000 + 1500', () =>
  assert.strictEqual(computeEnginePayShared(1, 'SASM', 'mechanic', 0), 13500));

check('mechanic bought a BCSO engine: 12000, no bonus', () =>
  assert.strictEqual(computeEnginePayShared(1, 'BCSO', 'mechanic', 0), 12000));

check('kintsugi bought a SASM engine: bonus only', () =>
  assert.strictEqual(computeEnginePayShared(1, 'SASM', 'kintsugi', 0), 1500));

check('kintsugi bought a BCSO engine: nothing owed', () =>
  assert.strictEqual(computeEnginePayShared(1, 'BCSO', 'kintsugi', 0), 0));

check('old rows with no payer default to full reimbursement + bonus', () =>
  assert.strictEqual(computeEnginePayShared(1, 'LSPD', '', 0), 13500));

check('CIV engines reimburse flat, with no department bonus', () =>
  assert.strictEqual(computeEnginePayShared(0, 'LSPD', 'mechanic', 1), 12000));

check('kintsugi-paid CIV engine owes nothing', () =>
  assert.strictEqual(computeEnginePayShared(0, 'CIV', 'kintsugi', 1), 0));

check('multiple engines scale linearly', () =>
  assert.strictEqual(computeEnginePayShared(3, 'ODPD', 'mechanic', 0), 40500));

check('mixed PD and CIV engines on one job', () =>
  assert.strictEqual(computeEnginePayShared(1, 'SASM', 'mechanic', 1), 25500));

check('no engines means no engine pay', () =>
  assert.strictEqual(computeEnginePayShared(0, 'LSPD', 'mechanic', 0), 0));

console.log('\nBrowser copy is in sync');

// constants.js cannot import this module (the dashboard loads plain
// <script> tags), so it keeps its own copy. This asserts it matches.
check('constants.js PAYMENT_RATES match rates.js', () => {
  const src = readFileSync(join(here, 'constants.js'), 'utf8');
  const body = src.match(/const PAYMENT_RATES = \{([\s\S]*?)\n\};/);
  assert.ok(body, 'could not find PAYMENT_RATES in constants.js');

  for (const [key, expected] of Object.entries(PAYMENT_RATES)) {
    const m = body[1].match(new RegExp(`\\b${key}\\s*:\\s*(-?\\d+)`));
    assert.ok(m, `constants.js is missing ${key}`);
    assert.strictEqual(Number(m[1]), expected,
      `constants.js ${key} is ${m[1]}, rates.js says ${expected}`);
  }
});

check('constants.js lists the same departments as rates.js', () => {
  const src = readFileSync(join(here, 'constants.js'), 'utf8');
  for (const d of DEFAULT_DEPARTMENTS) {
    assert.ok(new RegExp(`\\b${d}\\b`).test(src),
      `${d} is in rates.js but missing from constants.js`);
  }
});

check('worker.js no longer hardcodes rate numbers', () => {
  const src = readFileSync(join(here, 'worker.js'), 'utf8');
  assert.ok(!/const PAY_PER_REPAIR\s*=\s*\d/.test(src),
    'worker.js hardcodes PAY_PER_REPAIR again - it should read rates.js');
  assert.ok(!/const ENGINE_REIMBURSEMENT\s*=\s*\d/.test(src),
    'worker.js hardcodes ENGINE_REIMBURSEMENT again');
});

check('the payout scripts no longer hardcode the department list', () => {
  for (const p of ['scripts/post-payouts.js', 'scripts/update-analytics.js']) {
    const src = readFileSync(join(here, p), 'utf8');
    assert.ok(!/\['LSPD',\s*'ODPD'\]/.test(src),
      `${p} hardcodes a department list again - use departmentEngineBonus()`);
  }
});

console.log('\n' + '-'.repeat(53));
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
