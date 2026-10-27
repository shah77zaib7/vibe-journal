/* ============================================================================
   VibeJournal — pass 5: the welcome gate
   ----------------------------------------------------------------------------
   Checks the entry screen end to end: that it appears when it should, stays
   out of the way when it should, signs in, and never nags a local-only user
   twice.

   Run:  node tools/e2e5.js
   ========================================================================== */
'use strict';

const fs = require('fs');
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

/* ── a mock Supabase backend, same as the cloud suite ── */
const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'trader@example.com', user_metadata: { full_name: 'Test Trader' } };

async function installMock(page) {
  const server = { trades: [], shots: [], settings: [], calls: [] };
  const json = (body, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/mock-vibe.supabase.co/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    server.calls.push(method + ' ' + p);

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
    if (p === '/auth/v1/user') return route.fulfill(json(USER));
    if (p === '/auth/v1/logout') return route.fulfill(json({}));
    if (p === '/auth/v1/authorize') {
      return route.fulfill({ status: 302, headers: { location: APP_URL } });
    }
    if (p === '/rest/v1/trades') {
      if (method === 'GET') return route.fulfill(json(server.trades));
      if (method === 'POST') {
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
      return route.fulfill(json([]));
    }
    if (p === '/rest/v1/shots') {
      if (method === 'GET') return route.fulfill(json(server.shots));
      return route.fulfill(json([]));
    }
    if (p === '/rest/v1/settings') {
      if (method === 'GET') return route.fulfill(json(server.settings));
      return route.fulfill(json([]));
    }
    return route.fulfill(json([]));
  });
  return server;
}

async function newPage(browser, { configured = true } = {}) {
  // a phone-sized viewport — this screen is designed for the thumb
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((on) => {
    window.VJConfig = on
      ? { supabaseUrl: 'https://mock-vibe.supabase.co', supabaseAnonKey: 'anon-key-for-tests', shotsBucket: 'shots' }
      : { supabaseUrl: '', supabaseAnonKey: '', shotsBucket: 'shots' };
  }, configured);
  const server = installMock(page);
  return { page, errors, server };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ─────────────────── 1. the gate appears ─────────────────── */
  {
    const { page, errors } = await newPage(browser);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    const g = await page.evaluate(() => ({
      hidden: document.querySelector('#gate').hidden,
      title: (document.querySelector('#gateTitle') || {}).textContent,
      sub: (document.querySelector('#gateSub') || {}).textContent,
      google: !!document.querySelector('#gateGoogle'),
      skip: !!document.querySelector('#gateSkip'),
      trust: document.querySelectorAll('.gate-trust li').length,
      isIn: document.querySelector('#gate').classList.contains('is-in'),
      gateOpen: document.documentElement.classList.contains('gate-open')
    }));

    ok('gate appears when configured and signed out', g.hidden === false, JSON.stringify(g));
    ok('gate shows the brand', /Vibe/.test(g.title || ''), g.title);
    ok('gate has a Continue with Google button', g.google === true);
    ok('gate has a continue-without-account escape hatch', g.skip === true);
    ok('gate shows 3 trust points', g.trust === 3, String(g.trust));
    ok('gate plays its entrance animation', g.isIn === true);
    ok('gate locks the page behind it', g.gateOpen === true);

    // the app behind must not be clickable
    const covered = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 40);
      return !!(el && el.closest('#gate'));
    });
    ok('the app behind the gate is not clickable', covered === true);

    await page.screenshot({ path: path.join(SHOTS, '90-gate.png') });
    ok('no JS errors on the gate screen', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  /* ─────────────────── 2. the gate animates ─────────────────── */
  {
    const { page } = await newPage(browser);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    const motion = await page.evaluate(() => {
      const blob = document.querySelector('.gate-blob.g1');
      const mark = document.querySelector('.gate-mark');
      const ring = document.querySelector('.gate-mark-ring');
      const halo = document.querySelector('.gate-halo');
      const anim = (el) => el ? getComputedStyle(el).animationName : null;
      return {
        blob: anim(blob),
        mark: anim(mark),
        ring: anim(ring),
        halo: anim(halo),
        blobDur: blob ? getComputedStyle(blob).animationDuration : null
      };
    });
    ok('the background blobs drift', motion.blob && motion.blob !== 'none', JSON.stringify(motion));
    ok('the brand mark floats', motion.mark && motion.mark !== 'none');
    ok('the brand mark ring breathes', motion.ring && motion.ring !== 'none');
    ok('the halo pulses', motion.halo && motion.halo !== 'none');
    ok('the blobs animate slowly (not a flicker)', parseFloat(motion.blobDur) >= 10, motion.blobDur);

    // the blob must not use a blur filter (the app's own perf rule)
    const noFilter = await page.evaluate(() => {
      const b = document.querySelector('.gate-blob.g1');
      return getComputedStyle(b).filter;
    });
    ok('the background uses no blur filter (mobile perf)', noFilter === 'none', noFilter);

    await page.close();
  }

  /* ─────────────────── 3. skipping is remembered ─────────────────── */
  {
    const { page } = await newPage(browser);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    ok('gate is up before skipping', await page.evaluate(() => !document.querySelector('#gate').hidden));

    await page.click('#gateSkip');
    await page.waitForTimeout(900);

    const after = await page.evaluate(() => ({
      hidden: document.querySelector('#gate').hidden,
      flag: window.VJDB ? null : null
    }));
    ok('skipping dismisses the gate', after.hidden === true);

    const stored = await page.evaluate(() => window.VJDB.getMeta('cloud:skipGate', null));
    ok('the "no account" choice is remembered', stored === true, String(stored));

    // reload — the gate must not come back
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    const again = await page.evaluate(() => document.querySelector('#gate').hidden);
    ok('a local-only user is never asked again', again === true);

    await page.close();
  }

  /* ─────────────────── 4. signing in dismisses it ─────────────────── */
  {
    const { page, errors } = await newPage(browser);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);

    // stub the OAuth call so the page does not navigate away mid-assertion
    await page.evaluate(() => {
      window.__gateBusy = true;
      window.VJCloud.signInWithGoogle = function () {
        return new Promise(function () {});   // never settles — we are checking the pending state
      };
    });

    await page.click('#gateGoogle');
    await page.waitForTimeout(600);

    const busy = await page.evaluate(() => ({
      busy: document.querySelector('#gateGoogle').classList.contains('is-busy'),
      spinner: getComputedStyle(document.querySelector('.gate-spinner')).display,
      disabled: document.querySelector('#gateGoogle').disabled
    }));
    ok('the button shows a busy state while signing in', busy.busy === true);
    ok('the spinner is visible while busy', busy.spinner !== 'none', busy.spinner);
    ok('the button is disabled while busy', busy.disabled === true);

    // sign in on the app's own client, exactly as the OAuth callback would
    await page.evaluate(async () => {
      const { error } = await window.VJCloud.state.client.auth
        .signInWithPassword({ email: 'trader@example.com', password: 'x' });
      if (error) throw error;
    });
    await page.waitForTimeout(1400);

    const done = await page.evaluate(() => ({
      hidden: document.querySelector('#gate').hidden,
      user: window.VJCloud.status().user ? window.VJCloud.status().user.email : null,
      gateOpen: document.documentElement.classList.contains('gate-open')
    }));
    ok('signing in dismisses the gate', done.hidden === true, JSON.stringify(done));
    ok('the signed-in user is set', done.user === 'trader@example.com', String(done.user));
    ok('the page lock is released after sign-in', done.gateOpen === false);

    await page.screenshot({ path: path.join(SHOTS, '91-gate-signed-in.png') });
    ok('no JS errors during sign-in', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  /* ─────────────────── 5. an existing session skips the gate ─────────────────── */
  {
    const { page } = await newPage(browser);
    // seed a session in localStorage before the app boots
    await page.addInitScript(() => {
      window.VJConfig = {
        supabaseUrl: 'https://mock-vibe.supabase.co',
        supabaseAnonKey: 'anon-key-for-tests',
        shotsBucket: 'shots'
      };
    });
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
      await window.VJCloud.state.client.auth
        .signInWithPassword({ email: 'trader@example.com', password: 'x' });
    });
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    const hidden = await page.evaluate(() => document.querySelector('#gate').hidden);
    ok('a returning signed-in user never sees the gate', hidden === true);
    await page.close();
  }

  /* ─────────────────── 6. no Supabase configured → no gate ─────────────────── */
  {
    const { page } = await newPage(browser, { configured: false });
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    const st = await page.evaluate(() => ({
      hidden: document.querySelector('#gate').hidden,
      configured: window.VJCloud.status().configured
    }));
    ok('with no Supabase configured the gate stays out of the way', st.hidden === true, JSON.stringify(st));
    ok('the app reports cloud is not configured', st.configured === false);
    await page.close();
  }

  /* ─────────────────── 7. a failed sign-in is reported ─────────────────── */
  {
    const { page } = await newPage(browser);
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      window.VJCloud.signInWithGoogle = function () {
        return Promise.reject(new Error('Popup blocked'));
      };
    });
    await page.click('#gateGoogle');
    await page.waitForTimeout(700);
    const err = await page.evaluate(() => ({
      hidden: document.querySelector('#gateErr').hidden,
      text: document.querySelector('#gateErr').textContent,
      busy: document.querySelector('#gateGoogle').classList.contains('is-busy')
    }));
    ok('a failed sign-in shows an error', err.hidden === false, JSON.stringify(err));
    ok('the error message is shown to the user', /popup blocked/i.test(err.text || ''), err.text);
    ok('the button recovers after a failure', err.busy === false);
    await page.close();
  }

  await browser.close();

  console.log('');
  if (fail) {
    console.log(`${pass}/${pass + fail} checks passed — ${fail} FAILED`);
    process.exit(1);
  }
  console.log(`All pass-5 (gate) checks passed with no JS errors.`);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
