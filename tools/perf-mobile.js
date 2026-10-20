/* VibeJournal — mobile performance profile. */
'use strict';
const { chromium, devices } = require('/usr/local/lib/node_modules/playwright');
const URL = 'http://localhost:8099/';

async function run(page, label, inject, action) {
  if (inject) { await page.addStyleTag({ content: inject }); await page.waitForTimeout(400); }
  await page.evaluate(() => {
    window.__lt = []; window.__f = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] }); } catch (e) {}
    let last = performance.now();
    const tick = () => { const t = performance.now(); window.__f.push(t - last); last = t; window.__raf = requestAnimationFrame(tick); };
    window.__raf = requestAnimationFrame(tick);
  });
  await action();
  await page.waitForTimeout(2000);
  await page.evaluate(() => cancelAnimationFrame(window.__raf));
  const r = await page.evaluate(() => {
    const f = (window.__f || []).slice(2).sort((a, b) => a - b);
    const p = q => f.length ? Math.round(f[Math.min(f.length - 1, Math.floor(f.length * q))]) : 0;
    return { n: f.length, p50: p(.5), p95: p(.95), worst: Math.round(f[f.length - 1] || 0), slow: f.filter(x => x > 32).length, lt: window.__lt.length };
  });
  const v = r.p95 <= 20 ? 'SMOOTH' : r.p95 <= 34 ? 'STUTTER' : 'JANKY';
  console.log(`${label.padEnd(34)} p50=${String(r.p50).padStart(3)}  p95=${String(r.p95).padStart(4)}  worst=${String(r.worst).padStart(4)}  dropped=${String(r.slow).padStart(4)}/${r.n}  longtasks=${r.lt}  [${v}]`);
  return r;
}

(async () => {
  const browser = await chromium.launch();
  // emulate a mid-range phone with a throttled CPU
  const ctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const has = await page.locator('#recentList button[data-action="load-sample"]').count();
  if (has) {
    await page.locator('#recentList button[data-action="load-sample"]').click();
    await page.waitForSelector('#confirmModal:not([hidden])');
    await page.locator('#cfOk').click();
    await page.waitForTimeout(1600);
  }
  await page.locator('.tab[data-nav="journal"]').click();
  await page.waitForTimeout(700);

  const scroll = async () => {
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 380); await page.waitForTimeout(110); }
  };

  console.log('\n── MOBILE (iPhone 13, CPU throttled 4x) ──');
  console.log('journal scroll:');
  await run(page, 'as-shipped', null, scroll);

  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1400);
  await page.locator('.tab[data-nav="journal"]').click(); await page.waitForTimeout(600);
  await run(page, 'tabbar backdrop-filter OFF', `.tabbar{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`, scroll);

  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1400);
  await page.locator('.tab[data-nav="journal"]').click(); await page.waitForTimeout(600);
  await run(page, 'blobs OFF', `.backdrop{display:none!important}`, scroll);

  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1400);
  await page.locator('.tab[data-nav="journal"]').click(); await page.waitForTimeout(600);
  await run(page, 'BOTH OFF', `.backdrop{display:none!important}
    .tabbar,.appbar-in,.sheet{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`, scroll);

  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1400);
  await page.locator('.tab[data-nav="journal"]').click(); await page.waitForTimeout(600);
  await run(page, 'ALL backdrop-filter OFF', `*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    .backdrop{display:none!important}`, scroll);

  // tab switch latency
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1400);
  console.log('\ntab switch latency (mobile, 4x CPU):');
  for (const v of ['journal', 'analytics', 'dashboard', 'settings', 'dashboard']) {
    const a = Date.now();
    await page.locator(`.tab[data-nav="${v}"]`).click();
    await page.waitForTimeout(300);
    process.stdout.write(`${v}=${Date.now() - a}ms  `);
  }
  console.log();

  const cost = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const bf = all.filter(e => {
      const s = getComputedStyle(e);
      return (s.backdropFilter && s.backdropFilter !== 'none');
    });
    return { total: all.length, withBackdropFilter: bf.length, visible: bf.filter(e => e.offsetParent).length };
  });
  console.log('\nelements on page:', JSON.stringify(cost));
  await browser.close();
})();
