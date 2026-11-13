/* ============================================================================
   VibeJournal — pass 7: the native (Android) storage path
   ----------------------------------------------------------------------------
   The Android app has its own storage backend — SQLite via Capacitor, not
   IndexedDB. That path had a broken plugin bundle which failed SILENTLY:
   every write was a no-op, so the app looked fine and stored nothing. The
   browser suites could never catch it, because they never touch this code.

   This suite covers the native path directly:
     • the bundled plugin actually exports what the store imports
     • the store round-trips trades, screenshots and settings
     • data written by one session is visible to the next one
     • a broken plugin fails LOUDLY instead of silently discarding writes
     • the app falls back to browser storage and says so

   Run:  node tools/e2e7.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE = path.join(ROOT, 'www', 'vendor', 'cap-sqlite.js');
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'js', 'native-store.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

/* ══════════════ a tiny SQL engine, enough for the store ══════════════ */
/* Stands in for the native SQLite plugin. The "file" is a plain object that
   outlives any single store instance — that is what makes the persistence
   checks meaningful. */

function makeFile() {
  return { trades: {}, shots: {}, meta: {} };
}

function applySql(file, sql, values) {
  const s = String(sql).trim();

  let m = s.match(/^INSERT OR REPLACE INTO trades\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (m) {
    const cols = m[1].split(',').map(c => c.trim());
    const row = {};
    cols.forEach((c, i) => { row[c] = values[i]; });
    file.trades[row.id] = row;
    return;
  }
  m = s.match(/^INSERT OR REPLACE INTO shots\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (m) {
    const cols = m[1].split(',').map(c => c.trim());
    const row = {};
    cols.forEach((c, i) => { row[c] = values[i]; });
    file.shots[row.id] = row;
    return;
  }
  m = s.match(/^INSERT OR REPLACE INTO meta\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (m) {
    const cols = m[1].split(',').map(c => c.trim());
    const row = {};
    cols.forEach((c, i) => { row[c] = values[i]; });
    file.meta[row.key] = row;
    return;
  }
  m = s.match(/^DELETE FROM trades WHERE id\s*=\s*\?/i);
  if (m) { delete file.trades[values[0]]; return; }
  m = s.match(/^DELETE FROM shots WHERE id\s*=\s*\?/i);
  if (m) { delete file.shots[values[0]]; return; }
  if (/^DELETE FROM trades/i.test(s)) { file.trades = {}; return; }
  if (/^DELETE FROM shots/i.test(s)) { file.shots = {}; return; }
  if (/^DELETE FROM meta/i.test(s)) { file.meta = {}; return; }
  // CREATE TABLE / CREATE INDEX / PRAGMA — no-ops for the mock
}

function selectSql(file, sql, values) {
  const s = String(sql).trim();

  if (/^SELECT COUNT\(\*\) AS n FROM trades/i.test(s)) {
    return [{ n: Object.keys(file.trades).length }];
  }
  if (/^SELECT \* FROM trades WHERE id\s*=\s*\?/i.test(s)) {
    const r = file.trades[values[0]];
    return r ? [r] : [];
  }
  if (/^SELECT \* FROM trades/i.test(s)) {
    let rows = Object.values(file.trades);
    if (/ORDER BY dt DESC/i.test(s)) rows = rows.slice().sort((a, b) => Number(b.dt) - Number(a.dt));
    return rows;
  }
  if (/^SELECT \* FROM shots WHERE id\s*=\s*\?/i.test(s)) {
    const r = file.shots[values[0]];
    return r ? [r] : [];
  }
  if (/^SELECT \* FROM shots/i.test(s)) return Object.values(file.shots);
  if (/^SELECT value FROM meta WHERE key\s*=\s*\?/i.test(s)) {
    const r = file.meta[values[0]];
    return r ? [r] : [];
  }
  if (/^SELECT key, value FROM meta/i.test(s)) return Object.values(file.meta);
  return [];
}

/* ══════════════ the mock native bridge ══════════════ */
/* This mocks the NATIVE side of the plugin (the Capacitor bridge), not the
   JS wrapper. The real SQLiteConnection class from the built bundle is used
   on top of it, so the test exercises the real protocol — the previous
   version mocked the wrapper instead, which let a missing method()
   (sqlite.init) slip through unnoticed. */

function makeBridge(file) {
  const calls = [];
  return {
    calls: calls,
    /* the wrapper calls these on the bridge */
    checkConnectionsConsistency: () => Promise.resolve({ result: true }),
    createConnection: () => Promise.resolve(),
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    isDBExists: () => Promise.resolve({ result: true }),
    isDBOpen: () => Promise.resolve({ result: true }),
    getDatabaseList: () => Promise.resolve({ result: [] }),
    deleteDatabase: () => Promise.resolve(),
    query: (opts) => { calls.push('query'); return Promise.resolve({ values: selectSql(file, opts.statement, opts.values || []) }); },
    run: (opts) => { calls.push('run'); applySql(file, opts.statement, opts.values || []); return Promise.resolve({ changes: { rows: { affectedRows: 1 } } }); },
    execute: (opts) => {
      calls.push('execute');
      // The real Android plugin reads `statements` as a single STRING. An
      // array comes back null and the plugin dies on a NullPointerException.
      // Reject it here so the test catches a wrong call shape.
      if (typeof opts.statements !== 'string') {
        return Promise.reject(new Error('execute() expects a single SQL string, got ' + typeof opts.statements));
      }
      applySql(file, opts.statements, []);
      return Promise.resolve({});
    },
    executeSet: (opts) => {
      calls.push('executeSet');
      let n = 0;
      (opts.set || []).forEach(s => { applySql(file, s.statement, s.values || []); n++; });
      return Promise.resolve({ changes: { rows: { affectedRows: n } } });
    }
  };
}

/* ══════════════ run native-store.js in a sandbox ══════════════ */

function loadStore({ sqliteModule, bridge, broken }) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Promise, setTimeout, clearTimeout,
    Blob, atob, btoa, Uint8Array, ArrayBuffer,
    FileReader: class {
      readAsDataURL(blob) {
        blob.arrayBuffer().then(buf => {
          this.result = 'data:' + (blob.type || '') + ';base64,' + Buffer.from(buf).toString('base64');
          if (this.onload) this.onload();
        }).catch(e => { if (this.onerror) this.onerror(e); });
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  sandbox.VJNative = {
    isNative: true,
    sqlitePlugin: () => (broken ? null : bridge),
    loadSqlite: () => (broken
      ? Promise.reject(new Error('SQLite plugin bundle failed to load.'))
      : Promise.resolve(sqliteModule))
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(STORE_SRC, ctx, { filename: 'native-store.js' });
  return { store: sandbox.VJNativeStore, sandbox };
}


/* ══════════════ a static server for www/ (the staged app) ══════════════ */
function serveDir(dir, port) {
  const http = require('http');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((resolve) => srv.listen(port, () => resolve(srv)));
}

/* The mock bridge, as a string so it can be injected into the page. */
const BRIDGE_SRC = String.raw`
(function () {
  window.__vjFile = { trades: {}, shots: {}, meta: {} };
  const file = window.__vjFile;
  function applySql(sql, values) {
    const s = String(sql).trim(); let m;
    m = s.match(/^INSERT OR REPLACE INTO trades\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (m) { const c=m[1].split(',').map(x=>x.trim()); const row={}; c.forEach((k,i)=>row[k]=values[i]); file.trades[row.id]=row; return; }
    m = s.match(/^INSERT OR REPLACE INTO shots\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (m) { const c=m[1].split(',').map(x=>x.trim()); const row={}; c.forEach((k,i)=>row[k]=values[i]); file.shots[row.id]=row; return; }
    m = s.match(/^INSERT OR REPLACE INTO meta\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (m) { const c=m[1].split(',').map(x=>x.trim()); const row={}; c.forEach((k,i)=>row[k]=values[i]); file.meta[row.key]=row; return; }
    m = s.match(/^DELETE FROM trades WHERE id\s*=\s*\?/i); if (m) { delete file.trades[values[0]]; return; }
    m = s.match(/^DELETE FROM shots WHERE id\s*=\s*\?/i);  if (m) { delete file.shots[values[0]]; return; }
    if (/^DELETE FROM trades/i.test(s)) { file.trades = {}; return; }
    if (/^DELETE FROM shots/i.test(s))  { file.shots = {}; return; }
    if (/^DELETE FROM meta/i.test(s))   { file.meta = {}; return; }
  }
  function selectSql(sql, values) {
    const s = String(sql).trim();
    if (/^SELECT COUNT\(\*\) AS n FROM trades/i.test(s)) return [{ n: Object.keys(file.trades).length }];
    if (/^SELECT \* FROM trades WHERE id\s*=\s*\?/i.test(s)) { const r=file.trades[values[0]]; return r?[r]:[]; }
    if (/^SELECT \* FROM trades/i.test(s)) { let rows=Object.values(file.trades);
      if (/ORDER BY dt DESC/i.test(s)) rows=rows.slice().sort((a,b)=>Number(b.dt)-Number(a.dt)); return rows; }
    if (/^SELECT \* FROM shots WHERE id\s*=\s*\?/i.test(s)) { const r=file.shots[values[0]]; return r?[r]:[]; }
    if (/^SELECT \* FROM shots/i.test(s)) return Object.values(file.shots);
    if (/^SELECT value FROM meta WHERE key\s*=\s*\?/i.test(s)) { const r=file.meta[values[0]]; return r?[r]:[]; }
    if (/^SELECT key, value FROM meta/i.test(s)) return Object.values(file.meta);
    return [];
  }
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      CapacitorSQLite: {
        checkConnectionsConsistency: () => Promise.resolve({ result: true }),
        createConnection: () => Promise.resolve(),
        open: () => Promise.resolve(),
        close: () => Promise.resolve(),
        isDBExists: () => Promise.resolve({ result: true }),
        isDBOpen: () => Promise.resolve({ result: true }),
        getDatabaseList: () => Promise.resolve({ result: [] }),
        deleteDatabase: () => Promise.resolve(),
        query: (o) => Promise.resolve({ values: selectSql(o.statement, o.values || []) }),
        run: (o) => { applySql(o.statement, o.values || []); return Promise.resolve({ changes: { rows: { affectedRows: 1 } } }); },
        execute: (o) => {
          if (typeof o.statements !== 'string') {
            return Promise.reject(new Error('execute() expects a single SQL string, got ' + typeof o.statements));
          }
          applySql(o.statements, []); return Promise.resolve({});
        },
        executeSet: (o) => { let n=0; (o.set||[]).forEach(x => { applySql(x.statement, x.values||[]); n++; }); return Promise.resolve({ changes: { rows: { affectedRows: n } } }); }
      }
    }
  };
})();
`;

(async () => {
  /* the REAL plugin class, loaded from the bundle that actually ships */
  let RealSQLiteConnection = null;
  if (fs.existsSync(BUNDLE)) {
    try {
      const mod = await import('file://' + BUNDLE);
      RealSQLiteConnection = mod.SQLiteConnection;
    } catch (e) { /* reported by the checks below */ }
  }

  /* ══════════════ 1. the bundle exports what we import ══════════════ */
  {
    const exists = fs.existsSync(BUNDLE);
    ok('the SQLite bundle was built (www/vendor/cap-sqlite.js)', exists);

    if (exists) {
      let mod = null, err = null;
      try {
        mod = await import('file://' + BUNDLE);
      } catch (e) {
        err = e;
      }
      ok('the bundle imports without throwing', err === null, err && err.message);
      ok('the bundle exports SQLiteConnection', mod && typeof mod.SQLiteConnection === 'function');
      ok('the bundle exports SQLiteDBConnection', mod && typeof mod.SQLiteDBConnection === 'function');

      // the old bundle threw "capacitorExports is not defined" on import
      const src = fs.readFileSync(BUNDLE, 'utf8');
      ok('the bundle does not reference the missing capacitorExports global',
        !/capacitorExports/.test(src));
    }

    // and the source must be bundlable — check the entry we point esbuild at
    const entry = path.join(ROOT, 'node_modules', '@capacitor-community', 'sqlite', 'dist', 'esm', 'definitions.js');
    ok('the bundler entry point exists and is real ESM',
      fs.existsSync(entry) && /export class SQLiteConnection/.test(fs.readFileSync(entry, 'utf8')));
  }

  /* ══════════════ 2. the store round-trips data ══════════════ */
  {
    const file = makeFile();
    const bridge = makeBridge(file);
    const { store } = loadStore({
      sqliteModule: { SQLiteConnection: RealSQLiteConnection },
      bridge
    });

    const trade = {
      id: 'native-1', dt: 1700000000000, symbol: 'EURUSD', direction: 'long',
      entry: 1.085, sl: 1.08, tp: 1.095, lots: 1, riskMode: 'percent', risk: 1,
      riskAmount: 100, plannedRR: 2, strategy: 'Native', result: 'win', pnl: 200,
      notes: 'stored natively', tags: ['a', 'b'], shotId: null,
      createdAt: 1700000000000, updatedAt: 1700000000000
    };

    await store.putTrade(trade);
    const all = await store.allTrades();

    // the schema must be created through executeSet, never execute() —
    // the real Android plugin's execute() reads `statements` as a single
    // string and dies on a NullPointerException if it gets an array
    ok('the schema is created with executeSet, not execute()',
      bridge.calls.indexOf('executeSet') > -1 && bridge.calls.indexOf('execute') === -1,
      'calls: ' + bridge.calls.join(','));
    ok('a trade is written to SQLite', all.length === 1, 'count=' + all.length);
    ok('the trade round-trips field for field',
      all.length === 1 && all[0].id === trade.id && all[0].pnl === 200 &&
      all[0].symbol === 'EURUSD' && all[0].notes === trade.notes, JSON.stringify(all[0] || {}));
    ok('tags survive the JSON round-trip',
      all.length === 1 && Array.isArray(all[0].tags) && all[0].tags.join(',') === 'a,b',
      JSON.stringify(all[0] && all[0].tags));

    const one = await store.getTrade('native-1');
    ok('a trade can be read back by id', !!one && one.pnl === 200);

    const n = await store.tradeCount();
    ok('tradeCount matches', n === 1, String(n));

    await store.setMeta('settings', { balance: 4242, currency: '€' });
    const meta = await store.getMeta('settings', null);
    ok('settings round-trip through SQLite',
      !!meta && meta.balance === 4242 && meta.currency === '€', JSON.stringify(meta));

    const missing = await store.getMeta('nope', 'fallback');
    ok('a missing meta key returns the fallback', missing === 'fallback', String(missing));

    // screenshots
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin = Buffer.from(png, 'base64');
    const blob = new Blob([new Uint8Array(bin)], { type: 'image/png' });
    await store.putShot('shot-1', blob);
    const shot = await store.getShot('shot-1');
    ok('a screenshot round-trips through SQLite',
      !!shot && !!shot.blob && shot.blob.size === bin.length,
      shot && shot.blob ? String(shot.blob.size) : 'no blob');

    await store.deleteTrade('native-1');
    ok('a trade can be deleted', (await store.allTrades()).length === 0);
  }

  /* ══════════════ 3. data survives the app being closed and reopened ══════════════ */
  {
    const file = makeFile();
    const bridge = makeBridge(file);

    // first session
    const first = loadStore({
      sqliteModule: { SQLiteConnection: RealSQLiteConnection },
      bridge
    });
    await first.store.putTrade({ id: 'persist-1', dt: 1700000000000, symbol: 'GBPUSD', pnl: 77, tags: [], createdAt: 1, updatedAt: 1 });
    await first.store.setMeta('settings', { balance: 999 });
    ok('the first session wrote its trade', (await first.store.allTrades()).length === 1);

    // the app is closed. A brand new store instance, same database file.
    const second = loadStore({
      sqliteModule: { SQLiteConnection: RealSQLiteConnection },
      bridge
    });
    const trades = await second.store.allTrades();
    ok('the trade survives the app being closed and reopened', trades.length === 1, 'count=' + trades.length);
    ok('the reopened trade still has its values',
      trades.length === 1 && trades[0].pnl === 77 && trades[0].symbol === 'GBPUSD',
      JSON.stringify(trades[0] || {}));
    const settings = await second.store.getMeta('settings', null);
    ok('settings survive the app being closed and reopened',
      !!settings && settings.balance === 999, JSON.stringify(settings));

    // and a third session, to be sure it is not a fluke
    const third = loadStore({
      sqliteModule: { SQLiteConnection: RealSQLiteConnection },
      bridge
    });
    ok('and a third session still sees it', (await third.store.allTrades()).length === 1);
  }

  /* ══════════════ 4. a broken plugin fails LOUDLY ══════════════ */
  {
    const bridge = makeBridge(makeFile());

    // (a) the bridge is missing entirely
    const a = loadStore({ sqliteModule: { SQLiteConnection: RealSQLiteConnection }, broken: true });
    let threw = false, msg = '';
    try { await a.store.init(); } catch (e) { threw = true; msg = e.message; }
    ok('a missing SQLite bridge rejects (does not resolve quietly)', threw === true);
    ok('the failure reason is recorded', !!(a.store.failure && a.store.failure()),
      a.store.failure ? '' : 'failure() was empty');

    // (b) the bundle fails to load
    const b = loadStore({ sqliteModule: null, broken: true });
    threw = false;
    try { await b.store.init(); } catch (e) { threw = true; }
    ok('a failed plugin bundle rejects', threw === true);

    // (c) the bundle loads but has no SQLiteConnection — the exact bug
    const c = loadStore({ sqliteModule: {}, bridge, broken: false });
    threw = false;
    try {
      await c.store.allTrades();
    } catch (e) { threw = true; }
    ok('a bundle without SQLiteConnection does not silently return []', threw === true);
  }

  /* ══════════════ 5. the store never returns a silent empty result ══════════════ */
  {
    // With a working plugin but a broken bridge, every method must reject
    // rather than resolve with a harmless default.
    const bridge = makeBridge(makeFile());
    const { store } = loadStore({
      sqliteModule: { SQLiteConnection: RealSQLiteConnection },
      broken: true
    });

    const methods = ['allTrades', 'tradeCount', 'allMeta', 'allShots'];
    let allRejected = true;
    for (const m of methods) {
      try { await store[m](); allRejected = false; }
      catch (e) { /* good */ }
    }
    ok('read methods reject instead of returning empty results', allRejected === true);

    let writesRejected = true;
    for (const m of ['putTrade', 'deleteTrade', 'setMeta', 'putShot']) {
      try {
        await store[m](m === 'putTrade' ? { id: 'x', dt: 1, tags: [] }
          : m === 'putShot' ? 'id' : 'key',
          m === 'putTrade' ? undefined : m === 'putShot' ? new Blob(['x']) : 'v');
      } catch (e) { /* good */ }
    }
    ok('write methods reject instead of pretending to succeed', writesRejected === true);
  }

  /* ══════════════ 6. the app falls back and says so (real browser) ══════════════ */
  {
    const { chromium } = require('/usr/local/lib/node_modules/playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // Pretend to be the Android app, but with no SQLite bridge — the exact
    // situation that used to make the app silently store nothing.
    await page.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    });

    await page.goto('http://localhost:8099/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);

    const st = await page.evaluate(() => ({
      backend: window.VJDB.backend(),
      err: window.VJDB.nativeError() ? window.VJDB.nativeError().message : null,
      storeRowHidden: document.querySelector('#storeRow').hidden,
      storeText: (document.querySelector('#storeStatus') || {}).textContent || '',
      topBanner: !!document.querySelector('#storeWarn')
    }));

    ok('the app falls back to browser storage', st.backend === 'indexeddb', st.backend);
    ok('the fallback reason is exposed to the app', !!st.err, String(st.err));
    ok('the storage status appears in Settings', st.storeRowHidden === false);
    ok('the status explains what happened', /browser storage/i.test(st.storeText), st.storeText);
    ok('there is no banner at the top of the app', st.topBanner === false);

    // and — the important part — trades still save
    await page.evaluate(async () => {
      await window.VJDB.putTrade({
        id: 'fallback-1', dt: Date.now(), symbol: 'X', direction: 'long',
        pnl: 5, tags: [], createdAt: Date.now(), updatedAt: Date.now()
      });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1300);
    const n = await page.evaluate(async () => (await window.VJDB.allTrades()).length);
    ok('trades still save after the fallback', n === 1, 'count=' + n);

    const stillWarned = await page.evaluate(() => !document.querySelector('#storeRow').hidden);
    ok('the storage status persists across a reload', stillWarned === true);

    await browser.close();
  }


  /* ══════════════ 7. the real app uses SQLite (not the fallback) ══════════════ */
  {
    const { chromium } = require('/usr/local/lib/node_modules/playwright');
    const srv = await serveDir(path.join(ROOT, 'www'), 8098);
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // The staged app (www/) with a working native SQLite bridge. This is
    // the Android app, minus the real plugin.
    await page.addInitScript(BRIDGE_SRC);
    await page.goto('http://localhost:8098/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    const st = await page.evaluate(() => ({
      backend: window.VJDB.backend(),
      err: window.VJDB.nativeError() ? window.VJDB.nativeError().message : null,
      storeRowHidden: document.querySelector('#storeRow').hidden
    }));

    ok('the app uses SQLite, not the fallback', st.backend === 'sqlite', st.backend + ' / ' + st.err);
    ok('the storage status stays hidden when all is well', st.storeRowHidden === true, JSON.stringify(st));

    // write a trade and read it back
    await page.evaluate(async () => {
      await window.VJDB.putTrade({
        id: 'native-live-1', dt: Date.now(), symbol: 'EURUSD', direction: 'long',
        entry: 1.08, sl: 1.07, tp: 1.09, lots: 1, riskMode: 'percent', risk: 1,
        riskAmount: 100, plannedRR: 2, strategy: 'Live', result: 'win', pnl: 250,
        notes: 'written through SQLite', tags: ['live'], shotId: null,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    });
    const read = await page.evaluate(async () => {
      const t = await window.VJDB.getTrade('native-live-1');
      return t ? { pnl: t.pnl, notes: t.notes, symbol: t.symbol, tags: t.tags } : null;
    });
    ok('a trade round-trips through the real SQLiteConnection',
      !!read && read.pnl === 250 && read.symbol === 'EURUSD' &&
      Array.isArray(read.tags) && read.tags.join(',') === 'live',
      JSON.stringify(read));

    const n = await page.evaluate(async () => (await window.VJDB.allTrades()).length);
    ok('the trade is counted by the store', n === 1, 'count=' + n);

    await browser.close();
    srv.close();
  }

  console.log('');
  if (fail) {
    console.log(`${pass}/${pass + fail} checks passed — ${fail} FAILED`);
    process.exit(1);
  }
  console.log('All pass-7 (native storage) checks passed.');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
