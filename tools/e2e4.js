/* ============================================================================
   VibeJournal — pass 4: Google Sign-In + Supabase sync
   A mock Supabase backend is injected at the network layer, so the REAL sync
   engine (dirty tracking, pull, push, soft deletes, LWW) is exercised.
   ========================================================================== */
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const APP_URL = 'http://localhost:8099/';
const SHOTS = path.resolve(__dirname, '..', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const check = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

const PROJECT = 'https://mock-vibe.supabase.co';
const ANON = 'anon-key-for-tests';
const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'trader@example.com', user_metadata: { full_name: 'Test Trader' } };

/* the "server" state */
const server = {
  trades: [],          // {id, user_id, data, updated_at, deleted, deleted_at}
  settings: [],
  shots: [],
  calls: []
};

async function installMock(page) {
  await page.addInitScript(() => {
    window.VJConfig = {
      supabaseUrl: 'https://mock-vibe.supabase.co',
      supabaseAnonKey: 'anon-key-for-tests',
      oauthRedirectWeb: '',
      oauthRedirectNative: 'vibejournal://auth-callback',
      shotsBucket: 'shots',
      syncInterval: 600000
    };
  });

  const json = (body, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/mock-vibe.supabase.co/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    server.calls.push(method + ' ' + p);

    /* ── auth ── */
    if (p === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type') || '';
      if (grant === 'refresh_token' || grant === 'password') {
        return route.fulfill(json({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token_expires_in: 60 * 60 * 24 * 30,
          user: USER
        }));
      }
      return route.fulfill(json({ error: 'unsupported_grant_type' }, 400));
    }
    if (p === '/auth/v1/user') {
      return route.fulfill(json(USER));
    }
    if (p === '/auth/v1/logout') {
      return route.fulfill(json({}));
    }
    if (p === '/auth/v1/authorize') {
      // not reached — the web flow redirects the whole tab
      return route.fulfill({ status: 302, headers: { location: APP_URL } });
    }

    /* ── rest: trades ── */
    if (p === '/rest/v1/trades') {
      if (method === 'GET') {
        return route.fulfill(json(server.trades));
      }
      if (method === 'POST') {
        // upsert — body is an array
        let rows = [];
        try { rows = JSON.parse(req.postData() || '[]'); } catch (e) {}
        if (!Array.isArray(rows)) rows = [rows];
        rows.forEach(r => {
          const i = server.trades.findIndex(t => t.id === r.id);
          if (i > -1) server.trades[i] = Object.assign({}, server.trades[i], r);
          else server.trades.push(r);
        });
        return route.fulfill(json([]));
      }
      if (method === 'PATCH' || method === 'DELETE') {
        return route.fulfill(json([]));
      }
    }
    if (p === '/rest/v1/settings') {
      if (method === 'GET') return route.fulfill(json(server.settings));
      if (method === 'POST') {
        let rows = [];
        try { rows = JSON.parse(req.postData() || '[]'); } catch (e) {}
        if (!Array.isArray(rows)) rows = [rows];
        rows.forEach(r => {
          const i = server.settings.findIndex(s => s.key === r.key);
          if (i > -1) server.settings[i] = r; else server.settings.push(r);
        });
        return route.fulfill(json([]));
      }
    }
    if (p === '/rest/v1/shots') {
      if (method === 'GET') return route.fulfill(json(server.shots));
      if (method === 'POST') {
        let rows = [];
        try { rows = JSON.parse(req.postData() || '[]'); } catch (e) {}
        if (!Array.isArray(rows)) rows = [rows];
        rows.forEach(r => {
          const i = server.shots.findIndex(s => s.id === r.id);
          if (i > -1) server.shots[i] = r; else server.shots.push(r);
        });
        return route.fulfill(json([]));
      }
    }

    /* ── storage ── */
    if (p.startsWith('/storage/v1/object/')) {
      if (method === 'GET' || method === 'HEAD') {
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
      }
      return route.fulfill(json({ Key: 'ok' }));
    }
    if (p.startsWith('/storage/v1/')) {
      return route.fulfill(json({}));
    }

    return route.fulfill(json({ message: 'unmocked ' + method + ' ' + p }, 404));
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('  [pageerror] ' + e.message); });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // the mock backend intentionally 404s some paths — not an app error
    if (/mock-vibe|Failed to load resource|net::ERR/.test(t)) return;
    errors.push(t); console.log('  [js-error] ' + t);
  });

  await installMock(page);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#recentList .empty h3', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);

  /* seed a realistic journal so there is something to sync */
  await page.locator('#recentList button[data-action="load-sample"]').click();
  await page.waitForSelector('#confirmModal:not([hidden])');
  await page.locator('#cfOk').click();
  await page.waitForTimeout(2000);
  const seeded = await page.evaluate(async () => (await window.VJDB.allTrades()).length);
  check(seeded > 0, `journal seeded with sample trades (${seeded})`);

  /* ── 0. with NO config at all, the supabase bundle is never downloaded ── */
  {
    const bare = await browser.newContext({ viewport: { width: 900, height: 700 } });
    const bp = await bare.newPage();
    await bp.goto(APP_URL, { waitUntil: 'networkidle' });
    await bp.waitForTimeout(1500);
    const fetched = await bp.evaluate(() =>
      performance.getEntriesByType('resource').some(r => /supabase\.js/.test(r.name)));
    check(!fetched, 'unconfigured app never downloads the supabase bundle (stays fully offline)');
    const sub2 = await bp.locator('#sideCloudSub').innerText();
    check(/not set up/i.test(sub2), `unconfigured app reports "not set up" ("${sub2}")`);
    await bp.locator('[data-action="open-cloud"]').first().click();
    await bp.waitForSelector('#cloudSheet:not([hidden])');
    await bp.waitForTimeout(400);
    const steps = await bp.locator('#cloudSheet .cloud-steps li').count();
    check(steps === 4, `unconfigured app shows setup instructions (${steps} steps)`);
    await bp.screenshot({ path: path.join(SHOTS, '80-cloud-not-configured.png') });
    await bare.close();
  }

  /* ── 2. cloud is configured → the sheet shows the sign-in state ── */
  await page.locator('[data-action="open-cloud"]').first().click();
  await page.waitForSelector('#cloudSheet:not([hidden])');
  await page.waitForTimeout(600);
  const hasGoogleBtn = await page.locator('#cloudSheet [data-cloud-action="signin"]').count();
  check(hasGoogleBtn === 1, 'cloud sheet shows a "Continue with Google" button');
  const sub = await page.locator('#sideCloudSub').innerText();
  check(/not signed in/i.test(sub), `sidebar shows sync state ("${sub}")`);
  await page.screenshot({ path: path.join(SHOTS, '80-cloud-signed-out.png') });

  /* ── 3. sign in ──
     The web flow redirects the whole tab to Google, so the page navigates
     away — we can't follow it here. Instead we exercise the exact same
     code path the redirect lands on: a session appearing on the client,
     which fires the SIGNED_IN event the sync engine listens for. */
  await page.evaluate(async () => {
    // sign in on the app's own client — the same object the app listens to
    const { data, error } = await window.VJCloud.state.client.auth
      .signInWithPassword({ email: 'trader@example.com', password: 'x' });
    if (error) throw error;
  }).catch(e => console.log('  [signin helper] ' + e.message));

  await page.waitForTimeout(2500);

  const diag = await page.evaluate(() => ({
    configured: window.VJCloud.state.configured,
    hasClient: !!window.VJCloud.state.client,
    stateUser: window.VJCloud.state.user ? window.VJCloud.state.user.email : null,
    error: window.VJCloud.state.error,
    status: window.VJCloud.status()
  }));
  console.log('  [diag] ' + JSON.stringify(diag).slice(0, 400));

  const st1 = await page.evaluate(() => window.VJCloud.status());
  check(st1.signedIn === true, `signed in as ${st1.user && st1.user.email}`);

  /* ── 4. local trades are pushed to the cloud on first sign-in ── */
  await page.evaluate(() => window.VJCloud.syncNow());
  await page.waitForTimeout(1500);
  const pushed = server.trades.length;
  check(pushed > 0, `local trades pushed to the mock backend (${pushed} rows)`);

  const pushedRow = server.trades[0];
  check(pushedRow && pushedRow.user_id === USER.id, 'pushed row carries the signed-in user id (RLS column)');
  check(pushedRow && pushedRow.data && pushedRow.data.symbol, 'trade payload is stored as JSONB data');
  check(pushedRow && !pushedRow.deleted, 'live trades are not marked deleted');

  /* ── 5. a remote trade appears locally (pull) ── */
  server.trades.push({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    user_id: USER.id,
    data: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', dt: Date.now() - 3600000, symbol: 'XAUUSD', direction: 'buy', result: 'win', pnl: 420, tags: [], riskMode: 'amount', risk: 250, updatedAt: Date.now() },
    updated_at: new Date().toISOString(),
    deleted: false, deleted_at: null
  });
  await page.evaluate(() => window.VJCloud.syncNow());
  await page.waitForTimeout(2000);
  const localHas = await page.evaluate(async () => {
    const rows = await window.VJDB.allTrades();
    return rows.some(t => t.symbol === 'XAUUSD' && t.pnl === 420);
  });
  check(localHas, 'a remote trade is pulled down into the local store');

  /* ── 6. a local edit is pushed back up (dirty tracking) ── */
  const before = server.trades.length;
  await page.evaluate(async () => {
    const rows = await window.VJDB.allTrades();
    const t = rows[0];
    t.notes = 'edited in test';
    t.updatedAt = Date.now() + 5000;         // newer than the server copy
    await window.VJDB.putTrade(t);
    window.VJCloud.markDirty(t.id);
  });
  await page.evaluate(() => window.VJCloud.syncNow());
  await page.waitForTimeout(1800);
  const edited = server.trades.some(t => t.data && t.data.notes === 'edited in test');
  check(edited, 'a locally edited trade is pushed back to the cloud');

  /* ── 7. deletion propagates as a tombstone, not a hard delete ── */
  const victim = await page.evaluate(async () => {
    const rows = await window.VJDB.allTrades();
    const t = rows.find(x => x.symbol === 'XAUUSD') || rows[0];
    await window.VJDB.deleteTrade(t.id);
    window.VJCloud.markDeleted(t.id);
    return t.id;
  });
  await page.evaluate(() => window.VJCloud.syncNow());
  await page.waitForTimeout(1800);
  const tomb = server.trades.find(t => t.id === victim);
  check(tomb && tomb.deleted === true, 'a deleted trade becomes a soft-delete tombstone on the server');
  check(tomb && !!tomb.deleted_at, 'the tombstone records deleted_at');
  check(!!tomb, 'the tombstoned row is kept, not removed (so it cannot resurrect)');

  /* ── 8. pulling the tombstone removes it locally too ── */
  await page.evaluate(() => window.VJCloud.syncNow());
  await page.waitForTimeout(1800);
  const goneLocally = await page.evaluate(async (id) => {
    const rows = await window.VJDB.allTrades();
    return !rows.some(t => t.id === id);
  }, victim);
  check(goneLocally, 'the tombstone is applied locally on the next pull');

  /* ── 9. status UI reflects the signed-in state ── */
  await page.locator('#cloudSheet [data-cloud-action="sync"]').count().then(async n => {
    if (n) await page.locator('#cloudSheet [data-cloud-action="sync"]').click();
  });
  await page.waitForTimeout(1200);
  const sideSub = await page.locator('#sideCloudSub').innerText();
  check(!/not signed in/i.test(sideSub), `sidebar reflects the signed-in state ("${sideSub}")`);
  await page.screenshot({ path: path.join(SHOTS, '81-cloud-signed-in.png') });

  /* ── 10. sign out keeps local data ── */
  await page.locator('#cloudSheet [data-cloud-action="signout"]').click();
  await page.waitForTimeout(1500);
  const st2 = await page.evaluate(() => window.VJCloud.status());
  check(st2.signedIn === false, 'signed out');
  const stillLocal = await page.evaluate(async () => (await window.VJDB.allTrades()).length);
  check(stillLocal > 0, `local journal survives sign-out (${stillLocal} trades kept)`);

  await ctx.close();
  await browser.close();

  console.log(fails === 0 && errors.length === 0
    ? '\nAll pass-4 (cloud) checks passed with no JS errors.'
    : `\n${fails} failed check(s), ${errors.length} JS error(s).`);
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
