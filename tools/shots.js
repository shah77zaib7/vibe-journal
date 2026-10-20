/* VibeJournal — final screenshot pass. */
'use strict';
const { chromium, devices } = require('/usr/local/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const URL = 'http://localhost:8099/';
const SHOTS = path.resolve(__dirname, '..', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  /* desktop */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#recentList .empty h3', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '50-empty.png'), fullPage: true });

  await page.locator('#recentList button[data-action="load-sample"]').click();
  await page.waitForSelector('#confirmModal:not([hidden])');
  await page.locator('#cfOk').click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: path.join(SHOTS, '51-dashboard.png'), fullPage: true });

  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '52-journal.png'), fullPage: true });

  await page.locator('[data-nav="analytics"]').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, '53-analytics.png'), fullPage: true });

  await page.locator('.seg[data-tab="chart"]').click();
  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(SHOTS, '54-chart-tab.png'), fullPage: true });

  await page.locator('.seg[data-tab="risk"]').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, '55-risk.png'), fullPage: true });

  // picker open
  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('.btn-new').click();
  await page.waitForSelector('#tradeSheet:not([hidden])');
  await page.waitForTimeout(700);
  await page.locator('#f-symbol').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, '56-picker.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // detail with mini candle chart
  await page.locator('#tradeRows tr').first().click();
  await page.waitForSelector('#detailSheet:not([hidden])');
  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(SHOTS, '57-detail.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // light theme dashboard
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('#themeSeg button[data-theme-val="light"]').click();
  await page.waitForTimeout(900);
  await page.locator('[data-nav="dashboard"]').first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, '58-light.png'), fullPage: true });
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('#themeSeg button[data-theme-val="dark"]').click();
  await page.waitForTimeout(700);

  await ctx.close();

  /* mobile */
  const mctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const m = await mctx.newPage();
  await m.goto(URL, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1000);
  const has = await m.locator('#recentList button[data-action="load-sample"]').count();
  if (has) {
    await m.locator('#recentList button[data-action="load-sample"]').click();
    await m.waitForSelector('#confirmModal:not([hidden])');
    await m.locator('#cfOk').click();
    await m.waitForTimeout(2000);
  }
  await m.screenshot({ path: path.join(SHOTS, '59-mobile-dashboard.png'), fullPage: true });

  await m.locator('.tab[data-nav="analytics"]').click();
  await m.waitForTimeout(800);
  await m.locator('.seg[data-tab="chart"]').click();
  await m.waitForTimeout(1100);
  await m.screenshot({ path: path.join(SHOTS, '60-mobile-chart.png'), fullPage: true });

  await m.locator('.tab[data-nav="journal"]').click();
  await m.waitForTimeout(600);
  await m.locator('.tab-fab').click();
  await m.waitForSelector('#tradeSheet:not([hidden])');
  await m.waitForTimeout(700);
  await m.locator('#f-symbol').click();
  await m.waitForTimeout(700);
  await m.screenshot({ path: path.join(SHOTS, '61-mobile-picker.png') });

  await mctx.close();
  await browser.close();
  console.log('screenshots written to ' + SHOTS);
})();
