/* VibeJournal — performance profiler. Finds what actually costs frames. */
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');

const URL = 'http://localhost:8099/';

async function measure(page, label, setup) {
  // instrument long tasks + frame timing
  await page.evaluate(() => {
    window.__lt = [];
    window.__frames = [];
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); })
        .observe({ entryTypes: ['longtask'] });
    } catch (e) {}
    let last = performance.now();
    window.__raf = () => {
      const t = performance.now();
      window.__frames.push(t - last); last = t;
      window.__rafId = requestAnimationFrame(window.__raf);
    };
    window.__raf();
  });

  if (setup) await setup();

  await page.waitForTimeout(2500);
  await page.evaluate(() => cancelAnimationFrame(window.__rafId));

  const r = await page.evaluate(() => {
    const f = (window.__frames || []).slice(2);
    f.sort((a, b) => a - b);
    const pct = p => f.length ? Math.round(f[Math.min(f.length - 1, Math.floor(f.length * p))]) : 0;
    return {
      frames: f.length,
      median: pct(0.5), p95: pct(0.95), worst: Math.round(f[f.length - 1] || 0),
      over32ms: f.filter(x => x > 32).length,
      longTasks: (window.__lt || []).slice(0, 8),
      longTaskCount: (window.__lt || []).length
    };
  });
  const verdict = r.p95 <= 20 ? 'SMOOTH' : r.p95 <= 34 ? 'MILD STUTTER' : 'JANKY';
  console.log(`${label.padEnd(30)} p50=${String(r.median).padStart(3)}ms  p95=${String(r.p95).padStart(4)}ms  worst=${String(r.worst).padStart(4)}ms  >32ms:${String(r.over32ms).padStart(4)}/${r.frames}  longtasks=${r.longTaskCount} ${r.longTasks.length ? JSON.stringify(r.longTasks) : ''}  [${verdict}]`);
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // seed data
  const has = await page.locator('#recentList button[data-action="load-sample"]').count();
  if (has) {
    await page.locator('#recentList button[data-action="load-sample"]').click();
    await page.waitForSelector('#confirmModal:not([hidden])');
    await page.locator('#cfOk').click();
    await page.waitForTimeout(1500);
  }
  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(600);

  console.log('\n── scrolling the journal (40 rows) ──');
  await measure(page, 'baseline scroll', async () => {
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, 420);
      await page.waitForTimeout(110);
    }
  });

  console.log('\n── dashboard scroll (charts + glass cards) ──');
  await page.locator('[data-nav="dashboard"]').first().click();
  await page.waitForTimeout(800);
  await measure(page, 'baseline scroll', async () => {
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 420); await page.waitForTimeout(110); }
  });

  // Now A/B test the suspected culprits
  await page.addStyleTag({ content: `.backdrop{display:none!important}` });
  await page.waitForTimeout(500);
  await measure(page, 'backdrop blobs OFF', async () => {
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 420); await page.waitForTimeout(110); }
  });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);

  await page.addStyleTag({ content: `*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}` });
  await page.waitForTimeout(500);
  await measure(page, 'backdrop-filter OFF', async () => {
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 420); await page.waitForTimeout(110); }
  });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);

  await page.addStyleTag({ content: `*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.backdrop{display:none!important}` });
  await page.waitForTimeout(500);
  await measure(page, 'BOTH OFF', async () => {
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 420); await page.waitForTimeout(110); }
  });

  console.log('\n── tab switching cost ──');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const t0 = Date.now();
  const views = ['journal', 'analytics', 'dashboard', 'settings', 'dashboard'];
  for (const v of views) {
    const a = Date.now();
    await page.locator(`[data-nav="${v}"]`).first().click();
    await page.waitForTimeout(350);
    process.stdout.write(`${v}:${Date.now() - a}ms `);
  }
  console.log(`\ntotal ${Date.now() - t0}ms for ${views.length} switches`);

  // how many elements use backdrop-filter on this page?
  const cost = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const bf = all.filter(e => {
      const s = getComputedStyle(e);
      return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none');
    });
    return { total: all.length, backdropFilter: bf.length, visible: bf.filter(e => e.offsetParent !== null).length };
  });
  console.log('backdrop-filter elements:', JSON.stringify(cost));

  await browser.close();
})();
