// =====================================================================
// Payment rates — single source of truth for anything money-related.
// ---------------------------------------------------------------------
// Imported by worker.js (the bot + API) and by scripts/*.js (the payday
// embed and the analytics embed).
//
// constants.js holds a copy for the browser, because the dashboard pages
// load plain <script> tags and cannot import an ES module. That copy is
// kept honest by test-rates.mjs, which fails if the two ever disagree.
//
// WHY THIS FILE EXISTS
// PAY_PER_REPAIR used to be written out in four separate files, and the
// engine bonus rule in three. On 2026-06-09, commit a2be3ee added the
// SASM department to worker.js and the very next commit (f24d684)
// removed it again, most likely by pasting an older copy of the file
// over the top. Nothing caught it: the dashboard kept showing SASM
// engine replacements at $13,500 while the bot paid $12,000.
//
// If you change a rate, change it HERE. Then run `npm test`.
// =====================================================================

export const PAYMENT_RATES = {
  // ----- What Kintsugi pays the mechanic -----
  PAY_PER_REPAIR: 700,
  HARNESS_RATE: 500,
  ADVANCED_REPAIR_KIT_RATE: 500,

  // Reimbursement when the mechanic bought the engine themselves
  ENGINE_REIMBURSEMENT: 12000,

  // Extra paid on top of the reimbursement for government departments
  // that use the higher engine rate. See DEPARTMENT_ENGINE_BONUS below.
  ENGINE_BONUS_LSPD: 1500,

  // ----- What Kintsugi charges the customer -----
  REPAIR_RATE: 2500,
  ENGINE_REPLACEMENT_RATE: 15000,
  ENGINE_REPLACEMENT_RATE_BCSO: 12500,
  HARNESS_BILLING_RATE: 5000,
  ADVANCED_REPAIR_KIT_BILLING_RATE: 2500,

  // ----- BET and bins -----
  BET_RATE: 230,
  BINS_PER_15: 10,
};

/**
 * Extra engine pay per replacement, by department.
 *
 * This is the money rule and it lives on its own, deliberately separate
 * from any table that also carries colours and emoji. The SASM bug
 * happened because the bonus was a field on a presentation table, so
 * losing the display entry silently changed what a mechanic was paid.
 */
export const DEPARTMENT_ENGINE_BONUS = {
  CIV:  0,
  EMS:  0,
  BCSO: 0,
  LSPD: PAYMENT_RATES.ENGINE_BONUS_LSPD,
  ODPD: PAYMENT_RATES.ENGINE_BONUS_LSPD,
  SASM: PAYMENT_RATES.ENGINE_BONUS_LSPD,
};

/** Departments the dashboard offers as filters, in display order. */
export const DEFAULT_DEPARTMENTS = ['CIV', 'EMS', 'LSPD', 'BCSO', 'ODPD', 'SASM'];

/**
 * Engine bonus for a department name, case- and whitespace-insensitive.
 * Unknown departments get 0, which matches previous behaviour.
 *
 * @param {string} dept
 * @returns {number}
 */
export function departmentEngineBonus(dept) {
  return DEPARTMENT_ENGINE_BONUS[String(dept || '').trim().toUpperCase()] || 0;
}

/**
 * Total engine pay owed to a mechanic for one job.
 *
 * Government/PD engines earn the department bonus; who paid for the
 * engine decides whether the reimbursement applies on top.
 * CIV engines are reimbursed at the flat rate with no bonus.
 *
 * @param {number} pdEngineCount   Government/PD engine replacements
 * @param {string} dept            Department for the PD engines
 * @param {string} enginePayer     'mechanic' | 'kintsugi' | '' (old data)
 * @param {number} civEngineCount  CIV engine replacements
 * @returns {number}
 */
export function computeEnginePayShared(pdEngineCount, dept, enginePayer, civEngineCount) {
  const bonus = departmentEngineBonus(dept);
  const { ENGINE_REIMBURSEMENT } = PAYMENT_RATES;
  let pay = 0;

  if (pdEngineCount > 0) {
    if (enginePayer === 'kintsugi') {
      // Kintsugi bought the engine, so only the bonus is owed
      pay += pdEngineCount * bonus;
    } else {
      // 'mechanic', or old rows with no payer recorded
      pay += pdEngineCount * (ENGINE_REIMBURSEMENT + bonus);
    }
  }

  if ((civEngineCount || 0) > 0 && enginePayer !== 'kintsugi') {
    pay += civEngineCount * ENGINE_REIMBURSEMENT;
  }

  return pay;
}
