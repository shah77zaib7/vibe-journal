/* true click -> painted latency for tab switching (mobile, 4x CPU throttle) */
'use strict';
const { chromium, devices } = require('/usr/local/lib/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('http://localhost:8099/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const has = await page.locator('#recentList button[data-action="load-sample"]').count();
  if (has) {
    await page.locator('#recentList button[data-action="load-sample"]').click();
    await page.waitForSelector('#confirmModal:not([hidden])');
    await page.locator('#cfOk').click();
    await page.waitForTimeout(1800);
  }
  for (const v of ['journal','analytics','dashboard','settings']) {
    await page.locator(`.tab[data-nav="${v}"]`).click();
    await page.waitForTimeout(500);
  }
  console.log('true click -> painted latency (4x CPU throttle, mobile):');
  let tot = 0, n = 0;
  for (const v of ['journal','analytics','dashboard','settings','journal','dashboard','analytics','settings']) {
    const ms = await page.evaluate(async (view) => {
      const t0 = performance.now();
      document.querySelector(`.tab[data-nav="${view}"]`).click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    }, v);
    tot += ms; n++;
    console.log(`  ${v.padEnd(10)} ${String(ms).padStart(4)}ms ${ms < 100 ? '[OK]' : ms < 200 ? '[meh]' : '[slow]'}`);
    await page.waitForTimeout(400);
  }
  console.log(`  average ${Math.round(tot/n)}ms`);
  await browser.close();
})();
