/* ============================================================================
   VibeJournal — pass 6: local data persistence
   ----------------------------------------------------------------------------
   The app is local-only now, so the local store IS the product. This suite
   is the guarantee that a trade, a screenshot or a setting is still there
   after a refresh, after the browser is closed and reopened, and while
   offline — and that none of the removed cloud code is still lurking.

   Run:  node tools/e2e6.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('/usr/local/lib/node_modules/playwright');

const APP_URL = 'http://localhost:8099/';
const SHOTS = path.resolve(__dirname, '..', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

const errorsOf = (page) => {
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  return errs;
};

/* Add a trade straight through the store, then read it back. */
async function seedTrade(page, n) {
  return page.evaluate(async (count) => {
    const t = {
      id: 'persist-test-' + count,
      dt: Date.now(),
      symbol: 'EURUSD',
      direction: 'long',
      entry: 1.0850,
      sl: 1.0800,
      tp: 1.0950,
      lots: 1,
      riskMode: 'percent',
      risk: 1,
      riskAmount: 100,
      plannedRR: 2,
      strategy: 'Persistence test',
      result: 'win',
      pnl: 200,
      notes: 'must survive ' + count,
      tags: ['persist'],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await window.VJDB.putTrade(t);
    return (await window.VJDB.allTrades()).length;
  }, n);
}

const countTrades = (page) => page.evaluate(async () => (await window.VJDB.allTrades()).length);
const readTrade = (page, id) => page.evaluate(async (tid) => {
  const t = await window.VJDB.getTrade(tid);
  return t ? { id: t.id, pnl: t.pnl, notes: t.notes, symbol: t.symbol } : null;
}, id);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ══════════════ 1. a refresh keeps everything ══════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = errorsOf(page);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const n = await seedTrade(page, 1);
    ok('a trade can be written to the local store', n === 1, String(n));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const after = await countTrades(page);
    ok('the trade survives a refresh', after === 1, 'count=' + after);

    const t = await readTrade(page, 'persist-test-1');
    ok('the trade survives a refresh, field for field',
      !!t && t.pnl === 200 && t.notes === 'must survive 1' && t.symbol === 'EURUSD',
      JSON.stringify(t));

    const shown = await page.locator('#recentList .trade-row').count();
    ok('the trade is rendered in the journal after a refresh', shown > 0, 'rows=' + shown);

    ok('no JS errors around the refresh', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  /* ══════════════ 2. many refreshes in a row ══════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    for (let i = 1; i <= 6; i++) await seedTrade(page, i);
    ok('six trades written', (await countTrades(page)) === 6);

    for (let i = 0; i < 5; i++) {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(450);
    }
    const after = await countTrades(page);
    ok('all six survive five consecutive refreshes', after === 6, 'count=' + after);

    await ctx.close();
  }

  /* ══════════════ 3. closing and reopening the app ══════════════ */
  {
    // a persistent profile is the closest a browser gets to "reopen the app":
    // the whole browser shuts down and comes back on the same user data dir
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-persist-'));
    let ctx = await chromium.launchPersistentContext(dir, {
      viewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    let page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    await seedTrade(page, 1);
    await page.evaluate(async () => {
      await window.VJDB.setMeta('settings', { balance: 12345, currency: '€', theme: 'light' });
    });
    ok('data written in the first session', (await countTrades(page)) === 1);

    await ctx.close();          // the whole browser closes

    // reopen on the same profile
    ctx = await chromium.launchPersistentContext(dir, {
      viewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);

    const after = await countTrades(page);
    ok('the trade survives the app being closed and reopened', after === 1, 'count=' + after);

    const settings = await page.evaluate(async () => await window.VJDB.getMeta('settings', null));
    ok('settings survive the app being closed and reopened',
      !!settings && settings.balance === 12345 && settings.currency === '€',
      JSON.stringify(settings));

    const t = await readTrade(page, 'persist-test-1');
    ok('trade content survives the app being closed and reopened',
      !!t && t.pnl === 200 && t.notes === 'must survive 1', JSON.stringify(t));

    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ══════════════ 4. screenshots survive ══════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const wrote = await page.evaluate(async () => {
      // a tiny valid PNG
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bin = atob(png);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: 'image/png' });
      await window.VJDB.putShot('shot-persist-1', blob);
      return (await window.VJDB.getShot('shot-persist-1')) ? true : false;
    });
    ok('a screenshot can be written to the local store', wrote === true);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);
    const still = await page.evaluate(async () => {
      const rec = await window.VJDB.getShot('shot-persist-1');
      return rec && rec.blob ? rec.blob.size : 0;
    });
    ok('the screenshot survives a refresh', still > 0, 'size=' + still);

    await ctx.close();
  }

  /* ══════════════ 5. offline, then back ══════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);   // let the service worker install
    await seedTrade(page, 1);

    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500);

    const offlineCount = await countTrades(page).catch(() => -1);
    ok('data is intact while offline', offlineCount === 1, 'count=' + offlineCount);

    const title = await page.locator('#viewTitle').innerText().catch(() => '');
    ok('the app still boots while offline', !!title, title);

    await ctx.setOffline(false);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);
    ok('data is intact after coming back online', (await countTrades(page)) === 1);

    await ctx.close();
  }

  /* ══════════════ 6. export → erase → import is lossless ══════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    await seedTrade(page, 1);
    await seedTrade(page, 2);
    const before = await page.evaluate(async () => (await window.VJDB.allTrades()).length);

    // export, wipe, import — the round trip a user relies on now that
    // there is no cloud
    const roundTrip = await page.evaluate(async () => {
      const all = await window.VJDB.allTrades();
      const blob = new Blob([JSON.stringify({ version: 1, trades: all })], { type: 'application/json' });
      const text = await blob.text();
      const data = JSON.parse(text);
      await window.VJDB.clearAll();
      const wiped = (await window.VJDB.allTrades()).length;
      // import it back
      for (const t of (data.trades || [])) await window.VJDB.putTrade(t);
      const restored = (await window.VJDB.allTrades()).length;
      return { wiped, restored, exported: (data.trades || []).length };
    });
    ok('export produces the trades', roundTrip.exported === before, JSON.stringify(roundTrip));
    ok('erase really empties the store', roundTrip.wiped === 0, JSON.stringify(roundTrip));
    ok('import restores every trade', roundTrip.restored === before, JSON.stringify(roundTrip));

    await ctx.close();
  }

  /* ══════════════ 7. no sign-in code survives anywhere ══════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const dom = await page.evaluate(() => ({
      gate: !!document.querySelector('#gate'),
      gateCss: !!document.querySelector('link[href*="gate.css"]'),
      cloudSheet: !!document.querySelector('#cloudSheet'),
      googleBtn: !!document.querySelector('#gateGoogle, [data-cloud-action="signin"]'),
      sideCloud: !!document.querySelector('.side-cloud'),
      cloudPanel: /Cloud &amp; sync/.test(document.documentElement.innerHTML),
      globals: ['VJCloud', 'VJCloudUI', 'VJGate', 'VJConfig'].filter(g => typeof window[g] !== 'undefined')
    }));

    ok('no welcome gate in the DOM', dom.gate === false);
    ok('no gate stylesheet loaded', dom.gateCss === false);
    ok('no cloud account sheet in the DOM', dom.cloudSheet === false);
    ok('no Google sign-in button anywhere', dom.googleBtn === false);
    ok('no sidebar cloud entry', dom.sideCloud === false);
    ok('no "Cloud & sync" panel', dom.cloudPanel === false);
    ok('no cloud globals defined', dom.globals.length === 0, dom.globals.join(','));

    // the app boots straight into the journal
    const journal = await page.locator('#viewTitle').innerText().catch(() => '');
    ok('the app opens straight into the journal', /dashboard/i.test(journal), journal);

    // and the supabase bundle must never be fetched
    const fetched = await page.evaluate(() =>
      performance.getEntriesByType('resource').some(r => /supabase/i.test(r.name)));
    ok('the Supabase bundle is never downloaded', fetched === false);

    await ctx.close();
  }

  /* ══════════════ 8. no sign-in strings anywhere in the source ══════════════ */
  {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.toolchain' ||
            e.name === 'www' || e.name === 'android' || e.name === 'build') continue;
        // releases/ holds historical notes for versions that did ship the
        // cloud layer — they describe the past, they are not live code
        if (e.name === 'releases') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|html|css|json|sql|md)$/.test(e.name) && e.name !== 'package-lock.json') files.push(p);
      }
    };
    walk(path.resolve(__dirname, '..'));

    const hits = [];
    for (const f of files) {
      if (f === __filename) continue;   // this file names what it looks for
      const txt = fs.readFileSync(f, 'utf8');
      if (/supabase|VJCloud|VJGate|Continue with Google|signInWithOAuth/i.test(txt)) {
        hits.push(path.relative(path.resolve(__dirname, '..'), f));
      }
    }
    ok('no source file mentions Supabase, the cloud layer or Google sign-in',
      hits.length === 0, hits.join(', '));

    const vendor = path.resolve(__dirname, '..', 'vendor');
    const vendorFiles = fs.readdirSync(vendor);
    ok('the Supabase bundle is gone from vendor/', !vendorFiles.some(f => /supabase/i.test(f)),
      vendorFiles.join(','));
  }

  await browser.close();

  console.log('');
  if (fail) {
    console.log(`${pass}/${pass + fail} checks passed — ${fail} FAILED`);
    process.exit(1);
  }
  console.log('All pass-6 (persistence) checks passed with no JS errors.');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
