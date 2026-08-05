// Checks that preferences.js migrates the legacy ui-enhancements.js
// localStorage keys ('high-contrast', 'large-text', 'compact-mode')
// into the unified preferences object without losing user settings.
//
// Run: node test-preferences.cjs

const fs = require('fs'), vm = require('vm');
const store = {};
const classes = new Set();

const ctx = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  document: {
    body: { classList: { toggle:(c,on)=>{on?classes.add(c):classes.delete(c);}, add:c=>classes.add(c) } },
    getElementById: () => null,
  },
  window: { location: { pathname: '/index.html' } },
  console,
};
vm.createContext(ctx);

// storage helpers from utils.js
vm.runInContext(`
function kStorageSet(k,v){ localStorage.setItem(k, JSON.stringify(v)); return true; }
function kStorageGet(k,d){ try{const r=localStorage.getItem(k); return r?JSON.parse(r):d;}catch(e){return d;} }
`, ctx);

// the real preferences.js, minus its DOMContentLoaded auto-init
vm.runInContext(fs.readFileSync('preferences.js','utf8').replace(/\/\/ Auto-initialize on load[\s\S]*$/,''), ctx);

// A user who had the OLD ui-enhancements.js keys set:
store['high-contrast'] = 'true';
store['compact-mode']  = 'true';

vm.runInContext('kInitPreferences()', ctx);
const p = vm.runInContext('kGetPreferences()', ctx);

let failed = 0;
const ok = (l,a,e)=>{ if(a!==e) failed++; console.log(`${a===e?'PASS':'FAIL'}  ${l}: ${a} (expect ${e})`); };
ok('highContrast migrated', p.highContrast, true);
ok('compactMode migrated ', p.compactMode,  true);
ok('largeText untouched  ', p.largeText,    false);
ok('legacy keys removed  ', !('high-contrast' in store) && !('compact-mode' in store), true);
console.log(`${JSON.stringify([...classes].sort())===JSON.stringify(['compact-mode','high-contrast'])?'PASS':'FAIL'}  body classes: ${JSON.stringify([...classes].sort())}`);

vm.runInContext('kInitPreferences()', ctx);
ok('idempotent re-init   ', vm.runInContext('kGetPreferences()',ctx).highContrast, true);

process.exit(failed ? 1 : 0);
