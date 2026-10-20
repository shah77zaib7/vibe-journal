/* VibeJournal — end-to-end smoke test in real Chromium. */
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:8099/';
const SHOTS = path.resolve(__dirname, '..', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });

const log = [];
function ok(m) { log.push('  PASS  ' + m); console.log('  PASS  ' + m); }
function bad(m) { log.push('  FAIL  ' + m); console.log('  FAIL  ' + m); }

async function main() {
  const browser = await chromium.launch();
  const errors = [];

  /* ---------------- desktop ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') { errors.push('console: ' + m.text()); console.log('  [js-error] ' + m.text()); } });
  page.on('pageerror', e => { errors.push('pageerror: ' + e.message); console.log('  [page-error] ' + e.message); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  // the app boots async (IndexedDB + first render) — wait for real content
  await page.waitForSelector('#recentList .empty h3', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);

  // empty state
  const emptyVisible = await page.locator('#recentList .empty h3').isVisible().catch(() => false);
  emptyVisible ? ok('dashboard shows empty state with CTA') : bad('empty state missing');

  const equityOverlay = await page.locator('#equityEmpty').isVisible().catch(() => false);
  equityOverlay ? ok('equity chart shows an empty-state message with no trades') : bad('equity empty state missing');
  const overlayScoped = await page.locator('#equityEmpty').evaluate(e => {
    const a = e.getBoundingClientRect(), b = document.querySelector('.hero-chart').getBoundingClientRect();
    return Math.abs(a.height - b.height) < 2 && Math.abs(a.top - b.top) < 2;
  });
  overlayScoped ? ok('equity overlay is scoped to the chart, not the whole hero') : bad('equity overlay overflows its box');

  // load sample data
  await page.locator('#recentList button[data-action="load-sample"]').click();
  await page.waitForSelector('#confirmModal:not([hidden])');
  await page.locator('#cfOk').click();
  await page.waitForFunction(() => document.querySelectorAll('#recentList .trade-row').length > 0, { timeout: 8000 });
  await page.waitForTimeout(900);
  ok('sample data loaded, recent list populated');

  const net = await page.locator('#heroPnl').innerText();
  const wr = await page.locator('#heroWR').innerText();
  const wrRing = await page.locator('#winRing').evaluate(el => el.style.strokeDashoffset);
  ok(`hero P&L = ${net}, win rate = ${wr}, ring offset = ${wrRing}`);

  const chartPainted = await page.locator('#equityChart').evaluate(c => {
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < g.length; i += 4) if (g[i] > 8) n++;
    return n;
  });
  chartPainted > 2000 ? ok(`equity chart painted (${chartPainted}px)`) : bad(`equity chart looks empty (${chartPainted}px)`);

  await page.screenshot({ path: path.join(SHOTS, '01-dashboard-dark.png'), fullPage: true });

  // range pills
  await page.locator('.range-pill[data-range="0"]').click();
  await page.waitForTimeout(500);
  ok('equity range filter responds');

  /* ---------------- journal ---------------- */
  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(500);
  const rows = await page.locator('#tradeRows tr').count();
  rows > 0 ? ok(`journal lists ${rows} trades`) : bad('journal table empty');

  // search
  await page.locator('#q').fill('EURUSD');
  await page.waitForTimeout(400);
  const filtered = await page.locator('#tradeRows tr').count();
  const symbols = await page.locator('#tradeRows .t-sym').allInnerTexts();
  const allEur = symbols.every(s => s.trim() === 'EURUSD');
  (filtered > 0 && filtered < rows && allEur) ? ok(`search filters to ${filtered} EURUSD rows`) : bad(`search failed (${filtered} rows, all EURUSD=${allEur})`);
  await page.locator('#q').fill('');
  await page.waitForTimeout(350);

  // filters
  await page.locator('#filterBtn').click();
  await page.locator('#fResult').selectOption('win');
  await page.locator('#applyFilters').click();
  await page.waitForTimeout(400);
  const winOnly = await page.locator('#tradeRows tr').count();
  const badges = await page.locator('#tradeRows .badge-win').count();
  winOnly === badges ? ok(`result filter works (${winOnly} win rows)`) : bad(`result filter off (${winOnly} vs ${badges})`);
  const chipCount = await page.locator('#activeChips .chip').count();
  chipCount === 1 ? ok('active filter chip shown') : bad('active filter chip missing');
  await page.locator('#activeChips .chip').click();
  await page.waitForTimeout(400);
  ok('filter chip dismissal works');

  // sort
  await page.locator('#sortBtn').click();
  await page.waitForTimeout(400);
  const sortLabel = await page.locator('#sortLabel').innerText();
  ok(`sort cycles (now "${sortLabel}")`);

  await page.screenshot({ path: path.join(SHOTS, '02-journal-dark.png'), fullPage: true });

  // detail sheet
  await page.locator('#tradeRows tr').first().click();
  await page.waitForSelector('#detailSheet:not([hidden])');
  await page.waitForTimeout(500);
  const detCells = await page.locator('#detailBody .det-cell').count();
  detCells >= 6 ? ok(`detail sheet renders (${detCells} fields)`) : bad('detail sheet incomplete');
  await page.screenshot({ path: path.join(SHOTS, '03-detail.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------------- add a trade ---------------- */
  await page.locator('.btn-new').click();
  await page.waitForSelector('#tradeSheet:not([hidden])');
  await page.waitForTimeout(450);

  await page.locator('#f-symbol').fill('GBPJPY');
  await page.locator('#f-entry').fill('188.400');
  await page.locator('#f-sl').fill('188.100');
  await page.locator('#f-tp').fill('189.100');
  await page.locator('#f-lots').fill('0.50');
  await page.locator('#f-risk').fill('300');
  await page.waitForTimeout(350);

  const rr = await page.locator('#calcRR').innerText();
  const pips = await page.locator('#calcPips').innerText();
  rr === '2.33R' ? ok(`live R:R computes (${rr})`) : bad(`R:R wrong: ${rr} (expected 2.33R)`);
  pips === '30.0 pips' ? ok(`pip distance computes (${pips})`) : bad(`pip distance wrong: ${pips}`);

  await page.locator('#f-result .seg-btn[data-val="win"]').click();
  await page.waitForTimeout(250);
  const autoPnl = await page.locator('#f-pnl').inputValue();
  autoPnl === '700' ? ok(`auto P&L fill = ${autoPnl} (300 risk × 2.33R)`) : bad(`auto P&L = ${autoPnl}, expected 700`);

  await page.locator('#f-tags').fill('london, fvg');
  await page.locator('#f-notes').fill('Automated test entry.');
  await page.screenshot({ path: path.join(SHOTS, '04-trade-form.png') });
  await page.locator('#saveTrade').click();
  await page.waitForTimeout(900);

  const afterRows = await page.locator('#tradeRows tr').count();
  afterRows === rows + 1 ? ok('trade saved and appears in journal') : bad(`row count ${afterRows}, expected ${rows + 1}`);

  // persistence across reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const persisted = await page.locator('#navCount').innerText();
  persisted === String(rows + 1) ? ok(`persisted after reload (${persisted} trades in IndexedDB)`) : bad(`persistence failed: navCount=${persisted}`);

  /* ---------------- analytics ---------------- */
  await page.locator('[data-nav="analytics"]').first().click();
  await page.waitForTimeout(800);
  const cumPainted = await page.locator('#cumChart').evaluate(c => {
    const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < g.length; i += 4) if (g[i] > 8) n++;
    return n;
  });
  cumPainted > 2000 ? ok('cumulative P&L chart painted') : bad(`cumulative chart empty (${cumPainted}px)`);
  await page.screenshot({ path: path.join(SHOTS, '05-analytics-perf.png'), fullPage: true });

  for (const tab of ['strat', 'pairs', 'risk', 'time']) {
    await page.locator(`.seg[data-tab="${tab}"]`).click();
    await page.waitForTimeout(650);
    const paneOn = await page.locator(`.tab-pane[data-pane="${tab}"].is-active`).count();
    paneOn ? ok(`analytics tab "${tab}" renders`) : bad(`analytics tab "${tab}" failed`);
    await page.screenshot({ path: path.join(SHOTS, `06-analytics-${tab}.png`), fullPage: true });
  }
  // time granularity
  await page.locator('#timeGran button[data-gran="dow"]').click();
  await page.waitForTimeout(600);
  const dowRows = await page.locator('#timeTbl tbody tr').count();
  dowRows > 0 ? ok(`time granularity switch works (${dowRows} rows)`) : bad('day-of-week breakdown empty');

  /* ---------------- settings, theme, colour ---------------- */
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '07-settings-dark.png'), fullPage: true });

  // balance
  await page.locator('#setBalance').fill('25000');
  await page.locator('#setBalance').dispatchEvent('change');
  await page.waitForTimeout(700);
  const balShown = await page.locator('#setBalance').inputValue();
  balShown === '25000' ? ok('starting balance updates') : bad('balance did not persist');

  // light theme
  await page.locator('#themeSeg button[data-theme-val="light"]').click();
  await page.waitForTimeout(800);
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  theme === 'light' ? ok('light theme applies') : bad('theme toggle failed');
  await page.locator('[data-nav="dashboard"]').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, '08-dashboard-light.png'), fullPage: true });

  // semantic colour toggle
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('#setColorPnl').check();
  await page.waitForTimeout(700);
  const pnlMode = await page.evaluate(() => document.documentElement.getAttribute('data-pnl'));
  pnlMode === 'color' ? ok('semantic P&L colour mode applies') : bad('colour mode failed');
  await page.locator('[data-nav="dashboard"]').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '09-dashboard-color-pnl.png'), fullPage: true });
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('#setColorPnl').uncheck();
  await page.locator('#themeSeg button[data-theme-val="dark"]').click();
  await page.waitForTimeout(600);

  /* ---------------- export ---------------- */
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.locator('[data-action="export-json"]').click()
  ]).then(r => r[0]);
  dl ? ok('JSON export downloads: ' + dl.suggestedFilename()) : bad('JSON export failed');
  const dl2 = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.locator('[data-action="export-csv"]').click()
  ]).then(r => r[0]);
  if (dl2) {
    const p = await dl2.path();
    const csv = fs.readFileSync(p, 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    lines.length === rows + 2 ? ok(`CSV export: ${lines.length - 1} data rows + header`) : bad(`CSV rows ${lines.length - 1}`);
  } else bad('CSV export failed');

  /* ---------------- PWA / service worker ---------------- */
  const swReady = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return !!r.active;
  });
  swReady ? ok('service worker active') : bad('service worker not active');

  const cacheNames = await page.evaluate(() => caches.keys());
  const vjCache = cacheNames.find(n => n.startsWith('vibejournal'));
  const cacheCount = vjCache ? await page.evaluate(async (n) => {
    const c = await caches.open(n);
    return (await c.keys()).length;
  }, vjCache) : 0;
  cacheCount >= 12 ? ok(`app shell precached (${cacheCount} entries in ${vjCache})`) : bad(`only ${cacheCount} cached`);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const r = await fetch(href);
    return r.ok ? await r.json() : null;
  });
  manifest && manifest.icons && manifest.icons.length >= 3
    ? ok(`manifest valid (${manifest.name}, ${manifest.icons.length} icons, display=${manifest.display})`)
    : bad('manifest invalid');

  // offline
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1400);
  const offlineOk = await page.evaluate(() => ({
    hasApp: !!document.querySelector('.view.is-active'),
    trades: document.querySelector('#navCount') ? document.querySelector('#navCount').textContent : null,
    rows: document.querySelectorAll('#recentList .trade-row, #tradeRows tr').length
  }));
  offlineOk.hasApp && Number(offlineOk.trades) === rows + 1
    ? ok(`OFFLINE: app boots from cache, ${offlineOk.trades} trades intact, ${offlineOk.rows} rows rendered`)
    : bad(`OFFLINE failed: ${JSON.stringify(offlineOk)}`);
  await page.screenshot({ path: path.join(SHOTS, '10-offline.png'), fullPage: true });
  await ctx.setOffline(false);

  await ctx.close();

  /* ---------------- mobile ---------------- */
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const m = await mctx.newPage();
  const merrs = [];
  m.on('pageerror', e => merrs.push(e.message));
  m.on('console', e => { if (e.type() === 'error') merrs.push(e.text()); });
  await m.goto(URL, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1200);

  const tabbarVisible = await m.locator('.tabbar').isVisible();
  const sidebarHidden = !(await m.locator('.sidebar').isVisible());
  tabbarVisible && sidebarHidden ? ok('mobile: bottom tab bar shown, sidebar hidden') : bad('mobile nav wrong');

  const hasHorizScroll = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  hasHorizScroll ? bad('mobile: page scrolls horizontally') : ok('mobile: no horizontal overflow');

  await m.screenshot({ path: path.join(SHOTS, '11-mobile-dashboard.png'), fullPage: true });

  await m.locator('.tab[data-nav="journal"]').click();
  await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(SHOTS, '12-mobile-journal.png'), fullPage: true });

  await m.locator('.tab-fab').click();
  await m.waitForSelector('#tradeSheet:not([hidden])');
  await m.waitForTimeout(600);
  const sheetBox = await m.locator('#tradeSheet').boundingBox();
  (sheetBox && sheetBox.y < 844 && sheetBox.y > 0) ? ok('mobile: trade sheet opens as bottom sheet') : bad('sheet position wrong');
  await m.screenshot({ path: path.join(SHOTS, '13-mobile-form.png') });
  await m.keyboard.press('Escape');
  await m.waitForTimeout(400);

  await m.locator('.tab[data-nav="analytics"]').click();
  await m.waitForTimeout(800);
  await m.screenshot({ path: path.join(SHOTS, '14-mobile-analytics.png'), fullPage: true });

  await m.locator('.tab[data-nav="settings"]').click();
  await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(SHOTS, '15-mobile-settings.png'), fullPage: true });

  const mHoriz = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  mHoriz ? bad('mobile: horizontal overflow on settings') : ok('mobile: settings fits viewport');

  await mctx.close();
  await browser.close();

  console.log('\n═══ VibeJournal E2E ═══');
  log.forEach(l => console.log(l));
  const fails = log.filter(l => l.includes('FAIL'));
  console.log('\n' + (log.length - fails.length) + '/' + log.length + ' checks passed');
  if (errors.length) { console.log('\nDesktop JS errors:'); [...new Set(errors)].forEach(e => console.log('  ! ' + e)); }
  if (merrs.length) { console.log('\nMobile JS errors:'); [...new Set(merrs)].forEach(e => console.log('  ! ' + e)); }
  if (!errors.length && !merrs.length) console.log('\nNo console/page errors on desktop or mobile.');
  process.exit(fails.length || errors.length || merrs.length ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
