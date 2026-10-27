/* VibeJournal — pass 3: instrument picker, candlestick chart, colour mode, perf. */
'use strict';
const { chromium, devices } = require('/usr/local/lib/node_modules/playwright');

/* These suites exercise the app itself. The cloud layer and the welcome
   gate have their own suites (e2e4 = sync, e2e5 = gate), so blank the
   cloud config here — otherwise the gate stands in front of the app. */
const BLANK_CLOUD = () => {
  window.VJConfig = { supabaseUrl: '', supabaseAnonKey: '', shotsBucket: 'shots' };
};

const path = require('path');
const fs = require('fs');

const URL = 'http://localhost:8099/';
const SHOTS = path.resolve(__dirname, '..', '.shots');
let fails = 0;
const check = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

async function seed(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#recentList .empty h3', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  const has = await page.locator('#recentList button[data-action="load-sample"]').count();
  if (has) {
    await page.locator('#recentList button[data-action="load-sample"]').click();
    await page.waitForSelector('#confirmModal:not([hidden])');
    await page.locator('#cfOk').click();
    await page.waitForTimeout(1800);
  }
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  /* ================= desktop ================= */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(BLANK_CLOUD);
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('  [pageerror] ' + e.message); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('  [js-error] ' + m.text()); } });

  await seed(page);

  /* ---------- 1. red/green is the default ---------- */
  const mode = await page.evaluate(() => document.documentElement.getAttribute('data-pnl'));
  check(mode === 'color', 'semantic red/green P&L is on by default');

  const pnlColours = await page.evaluate(() => {
    const pos = getComputedStyle(document.documentElement).getPropertyValue('--pos').trim();
    const neg = getComputedStyle(document.documentElement).getPropertyValue('--neg').trim();
    const toRgb = c => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
      if (m) return m.slice(1, 4).map(Number);
      const h = /^#([0-9a-f]{6})$/i.exec(c.trim());
      if (h) { const v = h[1]; return [0,2,4].map(i => parseInt(v.substr(i,2),16)); }
      return [0, 0, 0];
    };
    const p = toRgb(pos), n = toRgb(neg);
    return { pos, neg, posGreen: p[1] > p[0] + 20, negRed: n[0] > n[1] + 20 };
  });
  check(pnlColours.posGreen, `--pos is green (${pnlColours.pos})`);
  check(pnlColours.negRed, `--neg is red (${pnlColours.neg})`);

  // the actual P&L text in the journal must be coloured
  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(700);
  const coloured = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#tradeRows .pnl-pos, #tradeRows .pnl-neg')];
    const hue = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? m.slice(1, 4).map(Number) : null; };
    let green = 0, red = 0;
    els.forEach(e => { const h = hue(getComputedStyle(e).color); if (!h) return; if (h[1] > h[0] + 20) green++; if (h[0] > h[1] + 20) red++; });
    return { total: els.length, green, red };
  });
  check(coloured.green > 0 && coloured.red > 0, `journal P&L renders green+red (${coloured.green} green / ${coloured.red} red of ${coloured.total})`);

  /* ---------- 2. instrument picker ---------- */
  await page.locator('.btn-new').click();
  await page.waitForSelector('#tradeSheet:not([hidden])');
  await page.waitForTimeout(500);

  await page.locator('#f-symbol').click();
  await page.waitForTimeout(400);
  check(await page.locator('#symbolPickerMenu').isVisible(), 'picker opens on click');

  const groups = await page.locator('#symbolList .picker-group-t').allInnerTexts();
  check(/MAJORS/i.test(groups.join()) && /METALS/i.test(groups.join()), 'picker groups instruments by category: ' + groups.join('/'));

  const syms = await page.locator('#symbolList .pi-sym').allInnerTexts();
  check(['EURUSD', 'XAUUSD', 'XAGUSD'].every(s => syms.includes(s)), 'EURUSD, XAUUSD and XAGUSD are all in the list');

  // the menu must not be clipped by the scrolling sheet
  const notClipped = await page.evaluate(() => {
    const m = document.querySelector('#symbolPickerMenu');
    const r = m.getBoundingClientRect();
    return r.height > 100 && r.bottom <= window.innerHeight + 1 && r.width > 100;
  });
  check(notClipped, 'picker menu is fully visible (not clipped by the sheet)');
  await page.screenshot({ path: path.join(SHOTS, '40-picker-open.png') });

  // metals group
  await page.locator('#f-symbol').fill('');
  await page.waitForTimeout(300);
  const metalItems = await page.locator('#symbolList .picker-group').filter({ hasText: 'METALS' }).locator('.pi-sym').allInnerTexts();
  check(metalItems.includes('XAUUSD') && metalItems.includes('XAGUSD'), 'metals group lists gold and silver: ' + metalItems.join(','));

  // search by name
  await page.locator('#f-symbol').fill('gold');
  await page.waitForTimeout(300);
  const goldHits = await page.locator('#symbolList .pi-sym').allInnerTexts();
  check(goldHits.includes('XAUUSD'), 'searching "gold" finds XAUUSD');

  // keyboard select
  await page.locator('#f-symbol').fill('xag');
  await page.waitForTimeout(300);
  await page.locator('#f-symbol').press('Enter');
  await page.waitForTimeout(300);
  check(await page.locator('#f-symbol').inputValue() === 'XAGUSD', 'Enter selects the highlighted instrument');

  // custom symbol still allowed
  await page.locator('#f-symbol').fill('mycustom');
  await page.locator('#f-symbol').press('Enter');
  await page.waitForTimeout(300);
  check(await page.locator('#f-symbol').inputValue() === 'MYCUSTOM', 'custom symbols are accepted and upper-cased');

  // the list closes on blur
  await page.locator('#f-entry').click();
  await page.waitForTimeout(400);
  check(!(await page.locator('#symbolPickerMenu').isVisible()), 'picker closes when focus leaves the field');

  await page.locator('#f-symbol').fill('XAUUSD');
  await page.locator('#f-entry').fill('2385.40');
  await page.locator('#f-sl').fill('2380.40');
  await page.locator('#f-tp').fill('2395.40');
  await page.locator('#f-risk').fill('250');
  await page.waitForTimeout(400);
  await page.locator('#saveTrade').click();
  await page.waitForTimeout(900);
  check(await page.locator('#navCount').innerText() === '41', 'trade saved via the picker');

  /* ---------- 3. candlestick chart ---------- */
  await page.locator('[data-nav="analytics"]').first().click();
  await page.waitForTimeout(800);
  await page.locator('.seg[data-tab="chart"]').click();
  await page.waitForTimeout(900);

  const paint = await page.locator('#candleChart').evaluate(c => {
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, green = 0, red = 0;
    for (let i = 0; i < g.length; i += 4) {
      if (g[i + 3] > 8) { n++; if (g[i + 1] > g[i] + 20) green++; if (g[i] > g[i + 1] + 20) red++; }
    }
    return { n, green, red };
  });
  check(paint.n > 5000, `candles painted (${paint.n}px)`);
  check(paint.green > 200 && paint.red > 200, `candles are green AND red (${paint.green}g / ${paint.red}r)`);

  const frame = await page.locator('#chartFrame button.is-active').innerText();
  check(/1D|4H|1H|1W/.test(frame), `timeframe auto-selected: ${frame}`);

  // timeframes all work
  for (const f of ['1h', '4h', '1w', '1d']) {
    await page.locator(`#chartFrame button[data-frame="${f}"]`).click();
    await page.waitForTimeout(500);
    const p = await page.locator('#candleChart').evaluate(c => {
      const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < g.length; i += 4) if (g[i] > 8) n++;
      return n;
    });
    check(p > 5000, `timeframe ${f.toUpperCase()} renders (${p}px)`);
  }
  await page.screenshot({ path: path.join(SHOTS, '41-candle-tab.png'), fullPage: true });

  // trade entries are drawn on the chart
  const entries = await page.locator('#chartTrades .trade-row').count();
  check(entries > 0, `chart tab lists the pair's entries (${entries})`);

  // symbol switch
  await page.locator('#chartSymbol').click();
  await page.waitForTimeout(350);
  const chartSyms = await page.locator('#chartList .pi-sym').allInnerTexts();
  check(chartSyms.includes('XAUUSD'), 'chart tab has its own instrument picker');
  await page.locator('#chartSymbol').fill('xauusd');
  await page.waitForTimeout(300);
  await page.locator('#chartSymbol').press('Enter');
  await page.waitForTimeout(800);
  check(await page.locator('#chartSymbol').inputValue() === 'XAUUSD', 'chart symbol switches to XAUUSD');
  await page.screenshot({ path: path.join(SHOTS, '42-candle-gold.png'), fullPage: true });

  /* ---------- 4. detail mini chart ---------- */
  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('#tradeRows tr').first().click();
  await page.waitForSelector('#detailSheet:not([hidden])');
  await page.waitForTimeout(900);
  const mini = await page.locator('#detCandle').evaluate(c => {
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < g.length; i += 4) if (g[i] > 8) n++;
    return n;
  });
  check(mini > 2000, `trade detail shows a mini candle chart (${mini}px)`);
  await page.screenshot({ path: path.join(SHOTS, '43-detail-candle.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- 5. monochrome still available ---------- */
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('#setColorPnl').uncheck();
  await page.waitForTimeout(700);
  const mono = await page.evaluate(() => document.documentElement.getAttribute('data-pnl'));
  check(mono === 'mono', 'monochrome mode can still be switched on');
  await page.locator('#setColorPnl').check();
  await page.waitForTimeout(600);

  await ctx.close();

  /* ================= mobile ================= */
  const mctx = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mctx.addInitScript(BLANK_CLOUD);
  const m = await mctx.newPage();
  m.on('pageerror', e => { errors.push('mobile: ' + e.message); });
  await m.goto(URL, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1200);

  // picker must work on a touch screen
  await m.locator('.tab-fab').click();
  await m.waitForSelector('#tradeSheet:not([hidden])');
  await m.waitForTimeout(600);
  await m.locator('#f-symbol').click();
  await m.waitForTimeout(500);
  check(await m.locator('#symbolPickerMenu').isVisible(), 'mobile: picker opens');
  const mClipped = await m.evaluate(() => {
    const r = document.querySelector('#symbolPickerMenu').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight + 1;
  });
  check(mClipped, 'mobile: picker stays inside the viewport');
  await m.screenshot({ path: path.join(SHOTS, '44-mobile-picker.png') });

  await m.locator('#symbolList .picker-item').first().click();
  await m.waitForTimeout(400);
  const picked = await m.locator('#f-symbol').inputValue();
  check(picked === 'EURUSD', 'mobile: tapping an item selects it (' + picked + ')');
  check(!(await m.locator('#symbolPickerMenu').isVisible()), 'mobile: picker closes after selection');
  await m.screenshot({ path: path.join(SHOTS, '45-mobile-picker-selected.png') });
  await m.keyboard.press('Escape');
  await m.waitForTimeout(400);

  // no horizontal overflow anywhere
  for (const v of ['dashboard', 'journal', 'analytics', 'settings']) {
    await m.locator(`.tab[data-nav="${v}"]`).click();
    await m.waitForTimeout(600);
    const over = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(!over, 'mobile: no horizontal overflow on ' + v);
  }
  await m.locator('.tab[data-nav="analytics"]').click();
  await m.waitForTimeout(600);
  await m.locator('.seg[data-tab="chart"]').click();
  await m.waitForTimeout(900);
  const mOver = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!mOver, 'mobile: chart tab has no horizontal overflow');
  await m.screenshot({ path: path.join(SHOTS, '46-mobile-candle.png'), fullPage: true });

  await mctx.close();
  await browser.close();

  console.log(fails === 0 && errors.length === 0
    ? '\nAll pass-3 checks passed with no JS errors.'
    : `\n${fails} failed check(s), ${errors.length} JS error(s).`);
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
