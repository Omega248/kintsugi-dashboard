#!/usr/bin/env node
// =====================================================================
// Kintsugi Discord Bot — Invoice Flow Simulation Test
//
// Simulates the full "Generate Bill → Department → Month Ending" flow
// to verify the bot NEVER shows a mechanic list when the invoice panel
// button is pressed.
//
// Run:
//   node discord-bot/test-invoice-flow.mjs
// =====================================================================

// ── Fake sheet CSV (mirrors the real Google Sheet column headers) ────────
const FAKE_JOBS_CSV = [
  'Timestamp,Mechanic,How Many Across,Department,Month Ending,Week Ending,Officer/Cop,License Plate,Engine Replacement',
  '01/03/2026,John Smith,3,BCSO,31/03/2026,07/03/2026,Officer Jones,ABC123,',
  '05/03/2026,Jane Doe,5,BCSO,31/03/2026,07/03/2026,Officer Brown,XYZ789,1',
  '10/03/2026,Bob Lee,2,LSPD,31/03/2026,14/03/2026,Officer White,DEF456,',
].join('\n');

const FAKE_STATE_CSV = [
  'Mechanic,State ID',
  'John Smith,12345',
  'Jane Doe,67890',
  'Bob Lee,11111',
].join('\n');

// ── Spy state ─────────────────────────────────────────────────────────
let capturedPatch = null;   // last PATCH @original payload (or FormData for file uploads)
let capturedPatchIsFile = false;

// ── Mock global crypto (bypass Ed25519 signature verification) ─────────
// Node 24 makes globalThis.crypto a getter-only property, so we must use
// Object.defineProperty on the globalThis.crypto object itself instead
// of replacing the top-level `crypto` binding.
Object.defineProperty(globalThis.crypto, 'subtle', {
  value: {
    importKey: async () => ({}),
    verify:    async () => true,   // always valid — test-only bypass
  },
  configurable: true,
  writable:     true,
});

// ── Mock global fetch ─────────────────────────────────────────────────
globalThis.fetch = async (url, opts = {}) => {
  // Google Sheets requests
  if (typeof url === 'string' && url.includes('docs.google.com')) {
    const isState = url.includes(encodeURIComponent("State ID's"));
    const csv = isState ? FAKE_STATE_CSV : FAKE_JOBS_CSV;
    return {
      ok:   true,
      text: async () => csv,
      json: async () => ({}),
    };
  }

  // Discord webhook PATCH @original (editOriginalMessage / editOriginalMessageWithFile)
  if (typeof url === 'string' && url.includes('webhooks') && opts.method === 'PATCH') {
    if (opts.body instanceof FormData) {
      // File upload (multipart) — used by editOriginalMessageWithFile
      const payloadJson = opts.body.get('payload_json');
      capturedPatch = payloadJson ? JSON.parse(payloadJson) : {};
      capturedPatchIsFile = true;
    } else {
      capturedPatch = JSON.parse(opts.body || '{}');
      capturedPatchIsFile = false;
    }
    return { ok: true, json: async () => ({}), text: async () => '' };
  }

  throw new Error(`Unexpected fetch in test: ${url} [${opts.method || 'GET'}]`);
};

// ── Import worker AFTER mocks are installed ──────────────────────────
const { default: worker } = await import('./worker.js');

// ── Helpers ────────────────────────────────────────────────────────────
const FAKE_ENV = {
  DISCORD_PUBLIC_KEY: '0'.repeat(64),
  DISCORD_BOT_TOKEN:  'Bot.fake-token-for-testing',
};

/** ctx whose waitUntil collects background promises so tests can await them. */
function makeCtx() {
  const pending = [];
  return {
    ctx: { waitUntil(p) { pending.push(p); } },
    flush() { return Promise.all(pending.splice(0)); },
  };
}

/** Build a fake Discord MESSAGE_COMPONENT interaction request. */
function makeRequest(customId, values = []) {
  const interaction = {
    type: 3,   // MESSAGE_COMPONENT
    application_id: 'TEST_APP_ID',
    token:          'FAKE_INTERACTION_TOKEN',
    data: { custom_id: customId, values },
  };
  const body = JSON.stringify(interaction);
  return new Request('https://bot.example.com/', {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Signature-Ed25519':   'aabbccdd',
      'X-Signature-Timestamp': '1234567890',
    },
    body,
  });
}

/** Simple assertion helper. */
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✅  ${message}`);
}

// ── Tests ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  capturedPatch     = null;
  capturedPatchIsFile = false;
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`\n❌ ${name}\n   ${err.message}\n`);
    failed++;
  }
}

// ── Test 1: "Generate Monthly Invoice" button → department select ────────
await runTest('Step 1 — billing_generate_invoice → department select (NOT mechanic list)', async () => {
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest('billing_generate_invoice'), FAKE_ENV, ctx);
  const data = await res.json();

  // Immediate response must be a deferred ephemeral (type 5, flags 64)
  assert(data.type === 5, 'Response type is DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (5)');
  assert(data.data?.flags === 64, 'Response is ephemeral (flags=64)');

  // Wait for the background edit to fire
  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called after defer');

  // Must NOT show a mechanic list
  const content = capturedPatch.content || '';
  assert(!content.toLowerCase().includes('mechanic'), 'Response does NOT mention "mechanic"');
  assert(!content.toLowerCase().includes('payout'),   'Response does NOT mention "payout"');

  // Must show a department selector
  const components = capturedPatch.components ?? [];
  assert(components.length > 0, 'Response includes at least one component row');
  const selects = components.flatMap(row => row.components ?? []).filter(c => c.type === 3);
  assert(selects.length > 0, 'At least one select menu is present');
  const deptSelect = selects.find(s => s.custom_id === 'billing_dept_select');
  assert(deptSelect !== undefined, 'Select menu custom_id is "billing_dept_select"');

  const optionValues = (deptSelect.options ?? []).map(o => o.value);
  assert(optionValues.includes('BCSO'), 'BCSO option is present');
  assert(optionValues.includes('LSPD'), 'LSPD option is present');
  assert(optionValues.length === 2,     'Exactly two department options (BCSO + LSPD)');
});

// ── Test 2: Department selected → month ending select ─────────────────────
await runTest('Step 2 — billing_dept_select (BCSO) → month ending select', async () => {
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest('billing_dept_select', ['BCSO']), FAKE_ENV, ctx);
  const data = await res.json();

  // Must acknowledge the component interaction without creating a new message
  assert(data.type === 6, 'Response type is DEFERRED_UPDATE_MESSAGE (6)');

  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called');

  const content = capturedPatch.content || '';
  assert(content.includes('BCSO'), 'Response content references selected department "BCSO"');
  assert(!content.toLowerCase().includes('mechanic'), 'Response does NOT mention "mechanic"');

  const selects = (capturedPatch.components ?? [])
    .flatMap(row => row.components ?? [])
    .filter(c => c.type === 3);
  assert(selects.length > 0, 'A select menu is present for month ending');

  const monthSelect = selects[0];
  assert(
    monthSelect.custom_id.startsWith('billing_month_select:BCSO'),
    `Select menu custom_id starts with "billing_month_select:BCSO" (got "${monthSelect.custom_id}")`
  );
  assert((monthSelect.options ?? []).length > 0, 'At least one month-ending option is available');

  // Record the first available month value for step 3
  globalThis._testMonthValue = monthSelect.options[0].value;
  console.log(`     ℹ️  Month value for step 3: ${globalThis._testMonthValue}`);
});

// ── Test 3: Month selected → invoice embed + CSV file ─────────────────────
await runTest('Step 3 — billing_month_select:BCSO → invoice embed + CSV (no mechanic dropdown)', async () => {
  const monthValue = globalThis._testMonthValue ?? '2026-03-31';

  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(
    makeRequest(`billing_month_select:BCSO`, [monthValue]),
    FAKE_ENV,
    ctx
  );
  const data = await res.json();

  assert(data.type === 6, 'Response type is DEFERRED_UPDATE_MESSAGE (6)');

  await flush();

  assert(capturedPatch !== null, 'editOriginalMessageWithFile was called');
  assert(capturedPatchIsFile, 'Response is a multipart file upload (CSV attached)');

  const content = capturedPatch.content || '';
  assert(content.includes('BCSO'), 'Invoice content references "BCSO"');
  assert(content.includes('Invoice') || content.includes('invoice'), 'Content labels result as an invoice');

  const embeds = capturedPatch.embeds ?? [];
  assert(embeds.length > 0, 'At least one embed is included in the invoice');

  const hasAttachment = (capturedPatch.attachments ?? []).some(
    a => (a.filename ?? '').endsWith('.csv')
  );
  assert(hasAttachment, 'A CSV attachment is declared in the payload');

  // Confirm there is NO mechanic-select component in the final response
  const components = capturedPatch.components ?? [];
  const mechanicSelects = components
    .flatMap(row => row.components ?? [])
    .filter(c => c.type === 3 && (
      c.custom_id === 'joblogs_mech_select' ||
      c.custom_id?.startsWith('payouts_week_mech:') ||
      c.custom_id === 'billing_dept_select' ||
      c.custom_id?.startsWith('billing_month_select:')
    ));
  assert(mechanicSelects.length === 0, 'No mechanic-select or billing-flow dropdown in the final invoice response');
});

// ── Guard test: joblogs_start still shows mechanic select (unchanged) ───────
await runTest('Guard — joblogs_start still routes to mechanic selector (unchanged)', async () => {
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest('joblogs_start'), FAKE_ENV, ctx);
  const data = await res.json();

  assert(data.type === 5, 'joblogs_start responds with DEFERRED (type 5)');

  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called for joblogs_start');
  const selects = (capturedPatch.components ?? [])
    .flatMap(row => row.components ?? [])
    .filter(c => c.type === 3);
  const hasMechSelect = selects.some(s => s.custom_id === 'joblogs_mech_select');
  assert(hasMechSelect, 'joblogs_start correctly shows the mechanic select menu');
});

// ── Summary ────────────────────────────────────────────────────────────
console.log('');
console.log('─────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌  Some tests failed — see errors above.');
  process.exitCode = 1;
} else {
  console.log('✅  All tests passed — Generate Bill → Department → Month Ending flow is correct.');
}
