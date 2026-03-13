#!/usr/bin/env node
// =====================================================================
// Kintsugi Discord Bot — Invoice Flow Simulation Test
//
// Simulates the full "Generate Bill → Department → Month Ending" flow
// to verify the bot NEVER shows a mechanic list when the invoice panel
// button is pressed.
//
// Run:
//   node test-invoice-flow.mjs
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
let capturedPatch = null;   // last PATCH @original payload
let capturedPatchIsFile = false;
let capturedFollowup = null;      // last POST (follow-up) payload — used by postFollowupWithFile
let capturedFollowupIsFile = false;

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

  // Discord webhook PATCH @original — used by editOriginalMessage (plain JSON PATCH).
  // The new invoice flow always uses plain JSON here; multipart file upload moved to POST.
  if (typeof url === 'string' && url.includes('webhooks') && opts.method === 'PATCH') {
    if (opts.body instanceof FormData) {
      const payloadJson = opts.body.get('payload_json');
      capturedPatch = payloadJson ? JSON.parse(payloadJson) : {};
      capturedPatchIsFile = true;
    } else {
      capturedPatch = JSON.parse(opts.body || '{}');
      capturedPatchIsFile = false;
    }
    return { ok: true, json: async () => ({}), text: async () => '' };
  }

  // Discord webhook POST — used by postFollowupWithFile (CSV as separate follow-up).
  // The URL does NOT end with "/messages/@original" for follow-ups.
  if (typeof url === 'string' && url.includes('webhooks') && opts.method === 'POST') {
    if (opts.body instanceof FormData) {
      const payloadJson = opts.body.get('payload_json');
      capturedFollowup = payloadJson ? JSON.parse(payloadJson) : {};
      capturedFollowupIsFile = true;
    } else {
      capturedFollowup = JSON.parse(opts.body || '{}');
      capturedFollowupIsFile = false;
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
  capturedPatch        = null;
  capturedPatchIsFile  = false;
  capturedFollowup     = null;
  capturedFollowupIsFile = false;
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`\n❌ ${name}\n   ${err.message}\n`);
    failed++;
  }
}

// ── Test 1: "Generate Monthly Invoice" button → department select ────────
// The handler now fetches the sheet (mirrors handleStartButton) to discover
// departments dynamically.  The fake sheet has BCSO + LSPD jobs, so both
// options will appear in the select menu.
await runTest('Step 1 — billing_generate_invoice → department select from sheet (NOT mechanic list)', async () => {
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest('billing_generate_invoice'), FAKE_ENV, ctx);
  const data = await res.json();

  // Immediate response must be a deferred ephemeral (type 5, flags 64)
  assert(data.type === 5, 'Response type is DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (5)');
  assert(data.data?.flags === 64, 'Response is ephemeral (flags=64)');

  // Wait for the background sheet fetch + edit to fire
  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called after defer');

  // Must NOT show a mechanic list
  const content = capturedPatch.content || '';
  assert(!content.toLowerCase().includes('mechanic'), 'Response does NOT mention "mechanic"');
  assert(!content.toLowerCase().includes('payout'),   'Response does NOT mention "payout"');

  // Must show a department selector sourced from the sheet
  const components = capturedPatch.components ?? [];
  assert(components.length > 0, 'Response includes at least one component row');
  const selects = components.flatMap(row => row.components ?? []).filter(c => c.type === 3);
  assert(selects.length > 0, 'At least one select menu is present');
  const deptSelect = selects.find(s => s.custom_id === 'billing_dept_select');
  assert(deptSelect !== undefined, 'Select menu custom_id is "billing_dept_select"');

  const optionValues = (deptSelect.options ?? []).map(o => o.value);
  assert(optionValues.includes('BCSO'), 'BCSO option is present (sourced from sheet)');
  assert(optionValues.includes('LSPD'), 'LSPD option is present (sourced from sheet)');
  // Departments come from the sheet — the fake sheet has exactly BCSO + LSPD
  assert(optionValues.length === 2, 'Exactly two department options from the fake sheet (BCSO + LSPD)');
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

// ── Test 3: Month selected → invoice embed + CSV file attachment ───────
// The handler delivers everything in a single multipart PATCH:
// an embed with the invoice summary and a CSV file attachment.
await runTest('Step 3 — billing_month_select:BCSO → invoice embed + CSV file attachment', async () => {
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

  // Multipart PATCH with CSV file attachment
  assert(capturedPatch !== null, 'editOriginalMessageWithFile (PATCH) was called');
  assert(capturedPatchIsFile, 'Response is a multipart upload (CSV file attached)');
  assert(capturedFollowup === null, 'No follow-up message — everything in the PATCH');

  const content = capturedPatch.content || '';
  assert(content.includes('BCSO'), 'Invoice content references "BCSO"');
  assert(content.includes('Invoice') || content.includes('invoice'), 'Content labels result as an invoice');

  const embeds = capturedPatch.embeds ?? [];
  assert(embeds.length > 0, 'At least one embed is included in the response');

  // Embed must have invoice summary fields (no description needed — CSV has all data)
  const fields = embeds[0].fields ?? [];
  assert(fields.length > 0, 'Embed has summary fields');
  assert(fields.some(f => f.name.includes('Total Owed')), 'Embed has "Total Owed" field');

  // Confirm there is NO mechanic-select component in the final response
  const components = capturedPatch.components ?? [];
  const billingSelects = components
    .flatMap(row => row.components ?? [])
    .filter(c => c.type === 3 && (
      c.custom_id === 'joblogs_mech_select' ||
      c.custom_id?.startsWith('payouts_week_mech:') ||
      c.custom_id === 'billing_dept_select' ||
      c.custom_id?.startsWith('billing_month_select:')
    ));
  assert(billingSelects.length === 0, 'No mechanic-select or billing-flow dropdown in the final invoice response');
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

// ── Test: payouts_week_view button → mechanic select ─────────────────────
await runTest('payouts_week_view:2026-03-07 → mechanic select (View My Payout flow)', async () => {
  const weekEndISO = '2026-03-07';
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest(`payouts_week_view:${weekEndISO}`), FAKE_ENV, ctx);
  const data = await res.json();

  // Immediate response must be a deferred ephemeral (type 5, flags 64)
  assert(data.type === 5, 'payouts_week_view responds with DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (5)');
  assert(data.data?.flags === 64, 'payouts_week_view response is ephemeral (flags=64)');

  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called after defer');

  // Must show a mechanic select dropdown
  const selects = (capturedPatch.components ?? [])
    .flatMap(row => row.components ?? [])
    .filter(c => c.type === 3);
  assert(selects.length > 0, 'At least one select menu is present');

  const mechSelect = selects.find(s => s.custom_id === `payouts_week_mech:${weekEndISO}`);
  assert(mechSelect !== undefined, `Select menu custom_id is "payouts_week_mech:${weekEndISO}"`);
  assert((mechSelect.options ?? []).length > 0, 'At least one mechanic option is present');
});

// ── Test: payouts_week_mech → individual payout embed ───────────────────
await runTest('payouts_week_mech:2026-03-07 → individual payout embed', async () => {
  const weekEndISO = '2026-03-07';
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(
    makeRequest(`payouts_week_mech:${weekEndISO}`, ['John Smith']),
    FAKE_ENV,
    ctx
  );
  const data = await res.json();

  assert(data.type === 6, 'payouts_week_mech responds with DEFERRED_UPDATE_MESSAGE (6)');

  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called');

  const embeds = capturedPatch.embeds ?? [];
  assert(embeds.length > 0, 'At least one embed in the response');
  assert(
    embeds[0].title?.includes('John Smith'),
    `Embed title includes mechanic name "John Smith" (got "${embeds[0].title}")`
  );

  // Must NOT include any follow-up selects
  const components = capturedPatch.components ?? [];
  assert(components.length === 0, 'No components in final payout embed (no follow-up dropdowns)');
});

// ── Backward-compat tests: old custom_ids still work ──────────────────
await runTest('Backward compat — payouts_panel_start routes to department select (old panel)', async () => {
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest('payouts_panel_start'), FAKE_ENV, ctx);
  const data = await res.json();

  // Must defer as an ephemeral (same as billing_generate_invoice)
  assert(data.type === 5, 'payouts_panel_start responds with DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (5)');
  assert(data.data?.flags === 64, 'payouts_panel_start response is ephemeral (flags=64)');

  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called');
  const selects = (capturedPatch.components ?? [])
    .flatMap(row => row.components ?? [])
    .filter(c => c.type === 3);
  const deptSelect = selects.find(s => s.custom_id === 'billing_dept_select');
  assert(deptSelect !== undefined, 'Response contains billing_dept_select (NOT a mechanic list)');
  assert(!capturedPatch.content?.toLowerCase().includes('mechanic'), 'Response does NOT mention "mechanic"');
});

await runTest('Backward compat — invoice_dept_select routes to month-ending select', async () => {
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest('invoice_dept_select', ['BCSO']), FAKE_ENV, ctx);
  const data = await res.json();

  assert(data.type === 6, 'invoice_dept_select responds with DEFERRED_UPDATE_MESSAGE (6)');

  await flush();

  assert(capturedPatch !== null, 'editOriginalMessage was called');
  const selects = (capturedPatch.components ?? [])
    .flatMap(row => row.components ?? [])
    .filter(c => c.type === 3);
  assert(selects.length > 0, 'A month-ending select is present');
});

await runTest('Backward compat — invoice_month_select:BCSO routes to invoice generation (embed + CSV file)', async () => {
  const monthValue = globalThis._testMonthValue ?? '2026-03-31';
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(
    makeRequest(`invoice_month_select:BCSO`, [monthValue]),
    FAKE_ENV,
    ctx
  );
  const data = await res.json();

  assert(data.type === 6, 'invoice_month_select:BCSO responds with DEFERRED_UPDATE_MESSAGE (6)');

  await flush();

  // Multipart PATCH with CSV file attachment
  assert(capturedPatch !== null, 'editOriginalMessageWithFile (PATCH) was called');
  assert(capturedPatchIsFile, 'Primary PATCH is multipart (CSV file attached)');
  assert(capturedPatch.content?.includes('BCSO'), 'Invoice content references "BCSO"');
  assert(capturedFollowup === null, 'No follow-up file — everything in the PATCH');
  const embeds = capturedPatch.embeds ?? [];
  assert(embeds.length > 0, 'Embed is included in the response');
  assert((embeds[0].fields ?? []).some(f => f.name.includes('Total Owed')), 'Embed has "Total Owed" field');
});

// ── Test: unrecognized component → ephemeral error (NOT "This interaction failed") ────
await runTest('Unrecognized component custom_id → ephemeral error message (type 4), not HTTP 400', async () => {
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(makeRequest('some_old_unknown_button_id'), FAKE_ENV, ctx);
  const data = await res.json();

  // Must return HTTP 200 with a proper Discord response type so Discord does
  // NOT show "This interaction failed" in the channel.
  assert(res.status === 200, `Response status is 200 (not 400). Got ${res.status}`);
  assert(data.type === 4, `Response type is CHANNEL_MESSAGE_WITH_SOURCE (4). Got ${data.type}`);
  assert(data.data?.flags === 64, 'Response is ephemeral (flags=64)');
  const content = data.data?.content || '';
  assert(content.includes('❌'), 'Error message starts with ❌');
  assert(content.toLowerCase().includes('panel'), 'Error message mentions "panel" for context');

  // No background work should be triggered for unrecognized interactions
  await flush();
});

// ── Test: malformed JSON body → HTTP 400 (not "This interaction failed") ────
await runTest('Malformed JSON body → HTTP 400, not HTTP 500', async () => {
  const req = new Request('https://bot.example.com/', {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Signature-Ed25519':   'aabbccdd',
      'X-Signature-Timestamp': '1234567890',
    },
    body: 'this is not valid json {{{',
  });
  const { ctx } = makeCtx();
  const res = await worker.fetch(req, FAKE_ENV, ctx);

  // Worker must NOT crash (500). Returns 400 for genuinely malformed bodies.
  assert(res.status === 400, `Response status is 400 for malformed JSON. Got ${res.status}`);
});

// ── Test: unknown slash command → ephemeral error (not HTTP 400) ────────────
await runTest('Unknown slash command → ephemeral error (type 4), not HTTP 400', async () => {
  const interaction = {
    type: 2,  // APPLICATION_COMMAND
    application_id: 'TEST_APP_ID',
    token:          'FAKE_INTERACTION_TOKEN',
    data: { name: 'some-unknown-slash-command', id: '9999' },
  };
  const body = JSON.stringify(interaction);
  const req = new Request('https://bot.example.com/', {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Signature-Ed25519':   'aabbccdd',
      'X-Signature-Timestamp': '1234567890',
    },
    body,
  });
  const { ctx } = makeCtx();
  const res  = await worker.fetch(req, FAKE_ENV, ctx);
  const data = await res.json();

  assert(res.status === 200, `Response status is 200. Got ${res.status}`);
  assert(data.type === 4, `Response type is CHANNEL_MESSAGE_WITH_SOURCE (4). Got ${data.type}`);
  assert(data.data?.flags === 64, 'Response is ephemeral (flags=64)');
  assert(data.data?.content?.includes('❌'), 'Error content starts with ❌');
});

// ── Test: unknown interaction type → ephemeral error (not HTTP 400) ─────────
await runTest('Unknown interaction type → ephemeral error (type 4), not HTTP 400', async () => {
  const interaction = {
    type: 99,   // Completely unknown interaction type
    application_id: 'TEST_APP_ID',
    token:          'FAKE_INTERACTION_TOKEN',
    data: {},
  };
  const body = JSON.stringify(interaction);
  const req = new Request('https://bot.example.com/', {
    method: 'POST',
    headers: {
      'Content-Type':          'application/json',
      'X-Signature-Ed25519':   'aabbccdd',
      'X-Signature-Timestamp': '1234567890',
    },
    body,
  });
  const { ctx } = makeCtx();
  const res  = await worker.fetch(req, FAKE_ENV, ctx);
  const data = await res.json();

  assert(res.status === 200, `Response status is 200. Got ${res.status}`);
  assert(data.type === 4, `Response type is CHANNEL_MESSAGE_WITH_SOURCE (4). Got ${data.type}`);
  assert(data.data?.flags === 64, 'Response is ephemeral (flags=64)');
  assert(data.data?.content?.includes('❌'), 'Error content starts with ❌');
});

// ── Additional reliability tests ───────────────────────────────────────────
//
// These tests exercise the invoice handlers' error handling:
//   • Network failure      — sheet fetch throws → error message shown to user
//   • Upstream HTTP 500    — sheet returns 500 → error message shown to user
//   • Empty result set     — 0-job month produces a valid 0-row invoice + CSV

// Helper: override the Google Sheets portion of globalThis.fetch temporarily.
// Calls the provided `sheetFn(url, opts)` instead of the default mock.
// Always restores the original mock, even on throw.
async function withSheetFetch(sheetFn, testFn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    // Use startsWith so only actual Google Sheets requests are intercepted —
    // avoids matching 'docs.google.com' appearing elsewhere in a URL.
    if (typeof url === 'string' && url.startsWith('https://docs.google.com/')) {
      return sheetFn(url, opts);
    }
    return orig(url, opts); // Discord webhook calls use the original mock
  };
  try {
    await testFn();
  } finally {
    globalThis.fetch = orig;
  }
}

// ── Test: network failure → error message shown ───────────────────────────────
await runTest('Network failure → error message shown to user', async () => {
  let attemptCount = 0;
  await withSheetFetch(
    async (_url, opts) => {
      attemptCount++;
      const err = new Error('The operation was aborted');
      err.name  = 'AbortError';
      throw err;
    },
    async () => {
      const { ctx, flush } = makeCtx();
      const res  = await worker.fetch(makeRequest('billing_dept_select', ['BCSO']), FAKE_ENV, ctx);
      const data = await res.json();

      assert(data.type === 6, 'Response type is DEFERRED_UPDATE_MESSAGE (6) on error path');

      await flush(); // wait for error handler

      assert(capturedPatch !== null, 'editOriginalMessage was called with an error');
      const content = capturedPatch.content || '';
      assert(content.includes('❌'), 'Error response starts with ❌');
      assert(
        content.toLowerCase().includes('failed') ||
        content.toLowerCase().includes('error'),
        `Error message is informative (got: "${content}")`
      );
      assert((capturedPatch.components ?? []).length === 0, 'No stale dropdown in error response');
      assert(attemptCount >= 1, `At least one fetch attempt was made (got ${attemptCount})`);
    }
  );
});

// ── Test: upstream HTTP 500 → error message shown ────────────────────────────
await runTest('Upstream HTTP 500 → error message shown to user', async () => {
  let fetchCount = 0;
  await withSheetFetch(
    async () => {
      fetchCount++;
      return {
        ok:      false,
        status:  500,
        headers: { get: () => null },
        text:    async () => 'Internal Server Error',
      };
    },
    async () => {
      const { ctx, flush } = makeCtx();
      const res  = await worker.fetch(makeRequest('billing_dept_select', ['LSPD']), FAKE_ENV, ctx);
      const data = await res.json();

      assert(data.type === 6, 'Response type is DEFERRED_UPDATE_MESSAGE (6)');

      await flush();

      assert(capturedPatch !== null, 'editOriginalMessage was called after error');
      const content = capturedPatch.content || '';
      assert(content.includes('❌'), 'Error response starts with ❌');
      assert(fetchCount >= 1, `At least one fetch attempt was made (got ${fetchCount})`);
    }
  );
});

// ── Test: month with no matching jobs → 0-row invoice + CSV (not an error) ──
await runTest('Month with 0 matching jobs → ephemeral error (no empty invoice)', async () => {
  // "2026-01-31" has no data in the fake sheet → 0 deptJobs for LSPD
  const { ctx, flush } = makeCtx();
  const res  = await worker.fetch(
    makeRequest('billing_month_select:LSPD', ['2026-01-31']),
    FAKE_ENV,
    ctx
  );
  const data = await res.json();

  assert(data.type === 6, 'Response type is DEFERRED_UPDATE_MESSAGE (6)');

  await flush();

  // The empty-invoice guard sends a plain JSON error rather than a CSV file.
  assert(capturedPatch !== null, 'editOriginalMessage was called');
  assert(!capturedPatchIsFile, 'Response is a plain JSON error (no CSV), not a multipart upload');
  assert(capturedFollowup === null, 'No follow-up file for 0-job month');
  const content = capturedPatch.content ?? '';
  assert(content.startsWith('❌'), 'Error message starts with ❌');
  assert(content.includes('No jobs found'), 'Error mentions "No jobs found"');
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
