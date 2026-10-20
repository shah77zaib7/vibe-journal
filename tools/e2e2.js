/* VibeJournal — pass 2: screenshot, import/export round-trip, clear-all, gestures. */
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL = 'http://localhost:8099/';
const SHOTS = path.resolve(__dirname, '..', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });

function ok(m) { console.log('  PASS  ' + m); }
function bad(m) { console.log('  FAIL  ' + m); }
let fails = 0;
const check = (c, m) => { c ? ok(m) : (bad(m), fails++); };

// a real PNG on disk to feed the file input
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAACWCAYAAACb3McZAAAAaklEQVR4nO3BMQEAAADCoPVPbQ0h' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgH8FZgAAZ' +
  'G0k0kQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.log('  [page-error] ' + e.message); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('  [js-error] ' + m.text()); } });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  /* ---------- screenshot attach ---------- */
  await page.locator('.btn-new').click();
  await page.waitForSelector('#tradeSheet:not([hidden])');
  await page.waitForTimeout(400);

  const ratioVisible = await page.locator('#ratioStrip').evaluate(e => e.getBoundingClientRect().height > 20);
  check(ratioVisible, 'R:R strip is visible (not flex-collapsed)');

  await page.locator('#f-symbol').fill('XAUUSD');
  await page.locator('#f-entry').fill('2385.40');
  await page.locator('#f-sl').fill('2380.40');
  await page.locator('#f-tp').fill('2395.40');
  await page.locator('#f-risk').fill('250');
  await page.waitForTimeout(300);
  const rrTxt = await page.locator('#calcRR').innerText();
  check(rrTxt === '2.00R', `live R:R = ${rrTxt} (risk 5.0 / reward 10.0)`);

  const shotPath = path.join(os.tmpdir(), 'shot.png');
  fs.writeFileSync(shotPath, PNG);
  await page.locator('#shotInput').setInputFiles(shotPath);
  await page.waitForSelector('#shotPreview:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(400);
  const shotSrc = await page.locator('#shotImg').getAttribute('src');
  check(!!shotSrc && shotSrc.startsWith('blob:'), 'screenshot preview attached and downscaled to a blob');
  await page.screenshot({ path: path.join(SHOTS, '20-shot-attached.png') });

  await page.locator('#f-result .seg-btn[data-val="win"]').click();
  await page.waitForTimeout(200);
  await page.locator('#saveTrade').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, '21-after-shot-save.png') });

  /* ---------- detail shows the image from IndexedDB ---------- */
  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(700);
  await page.locator('#tradeRows tr').first().click();  await page.waitForSelector('#detailSheet:not([hidden])');
  await page.waitForTimeout(900);
  const detImg = await page.locator('#detShot').count();
  const detLoaded = detImg ? await page.locator('#detShot').evaluate(i => i.complete && i.naturalWidth > 0) : false;
  check(detImg === 1 && detLoaded, 'screenshot persists to IndexedDB and renders in detail view');
  await page.screenshot({ path: path.join(SHOTS, '22-detail-with-shot.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- export -> clear -> import round-trip ---------- */
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(600);

  // regression: a trade saved WITH a screenshot must survive a reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  const afterReload = await page.locator('#navCount').innerText();
  check(afterReload === '1', `trade with screenshot survives reload (navCount=${afterReload})`);

  const counts = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('vibejournal');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return await new Promise(res => {
      const t = db.transaction(['trades'], 'readonly').objectStore('trades').count();
      t.onsuccess = () => res(t.result);
    });
  });
  check(counts === 1, `exactly 1 trade stored before backup (${counts})`);

  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('[data-action="export-json"]').click()
  ]).then(r => r[0]);
  const backupPath = path.join(os.tmpdir(), 'vj-backup.json');
  await dl.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check(backup.app === 'VibeJournal' && backup.trades.length === 1, `backup JSON: ${backup.trades.length} trade(s), ${Object.keys(backup.screenshots).length} screenshot(s)`);
  check(!!backup.screenshots && Object.values(backup.screenshots)[0].startsWith('data:image/'), 'screenshot embedded as base64 data URL');

  // clear everything
  await page.locator('[data-action="clear-all"]').click();
  await page.waitForSelector('#confirmModal:not([hidden])');
  await page.locator('#cfOk').click();
  await page.waitForTimeout(1200);
  const afterClear = await page.locator('#navCount').innerText();
  check(afterClear === '0', `clear-all wipes the journal (navCount=${afterClear})`);
  await page.locator('[data-nav="dashboard"]').first().click();
  await page.waitForTimeout(700);
  const emptyBack = await page.locator('#recentList .empty h3').isVisible().catch(() => false);
  check(emptyBack, 'empty state returns after clear');

  // import the backup back
  await page.locator('#importFile').setInputFiles(backupPath);
  await page.waitForSelector('#confirmModal:not([hidden])', { timeout: 5000 });
  await page.locator('#cfOk').click();
  await page.waitForTimeout(1500);
  const afterImport = await page.locator('#navCount').innerText();
  check(afterImport === '1', `import restores trades (navCount=${afterImport})`);

  await page.locator('[data-nav="journal"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('#tradeRows tr').first().click();
  await page.waitForSelector('#detailSheet:not([hidden])');
  await page.waitForTimeout(900);
  const imgAfterImport = await page.locator('#detShot').count();
  const okAfterImport = imgAfterImport ? await page.locator('#detShot').evaluate(i => i.complete && i.naturalWidth > 0) : false;
  check(imgAfterImport === 1 && okAfterImport, 'screenshot survives the export/clear/import round-trip');
  await page.screenshot({ path: path.join(SHOTS, '23-after-import.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- validation ---------- */
  await page.locator('.btn-new').click();
  await page.waitForSelector('#tradeSheet:not([hidden])');
  await page.waitForTimeout(400);
  await page.locator('#saveTrade').click();
  await page.waitForTimeout(500);
  const stillOpen = await page.locator('#tradeSheet').isVisible();
  const toastTxt = await page.locator('#toasts .toast').first().innerText().catch(() => '');
  check(stillOpen && /pair/i.test(toastTxt), `empty form is rejected with a toast ("${toastTxt.trim()}")`);
  await page.screenshot({ path: path.join(SHOTS, '24-validation.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- reject a bad import ---------- */
  const junk = path.join(os.tmpdir(), 'junk.json');
  fs.writeFileSync(junk, '{"nope":true}');
  await page.locator('[data-nav="settings"]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); });
  await page.locator('#importFile').setInputFiles(junk);
  await page.waitForTimeout(1200);
  const toasts = await page.locator('#toasts .toast').allInnerTexts();
  const junkToast = toasts.join(' | ');
  check(/no trades|no valid/i.test(junkToast), `malformed import rejected ("${junkToast.trim()}")`);
  const stillOne = await page.locator('#navCount').innerText();
  check(stillOne === '1', `malformed import left data untouched (navCount=${stillOne})`);

  /* ---------- mobile: drag the sheet down to dismiss ---------- */
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  const m = await mctx.newPage();
  m.on('pageerror', e => { errors.push('mobile: ' + e.message); });
  await m.goto(URL, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1000);
  await m.locator('.tab-fab').click();
  await m.waitForSelector('#tradeSheet:not([hidden])');
  await m.waitForTimeout(500);
  const grab = await m.locator('#tradeSheet .sheet-grab').boundingBox();
  await m.touchscreen.tap(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await m.evaluate(() => {
    const el = document.querySelector('#tradeSheet .sheet-grab');
    const mk = (t, y) => new TouchEvent(t, { bubbles: true, cancelable: true,
      touches: t === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: 100, clientY: y })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: 100, clientY: y })] });
    el.dispatchEvent(mk('touchstart', 400));
    document.querySelector('#tradeSheet').dispatchEvent(mk('touchmove', 460));
    document.querySelector('#tradeSheet').dispatchEvent(mk('touchmove', 560));
    document.querySelector('#tradeSheet').dispatchEvent(mk('touchend', 560));
  });
  await m.waitForTimeout(700);
  const sheetGone = !(await m.locator('#tradeSheet').isVisible());
  check(sheetGone, 'mobile: drag-down gesture dismisses the trade sheet');

  // body scroll restored
  const bodyOverflow = await m.evaluate(() => document.body.style.overflow);
  check(bodyOverflow === '', 'body scroll lock is released after closing the sheet');

  await mctx.close();
  await ctx.close();
  await browser.close();

  console.log(fails === 0 && errors.length === 0
    ? '\nAll pass-2 checks passed with no JS errors.'
    : `\n${fails} failed check(s), ${errors.length} JS error(s).`);
  process.exit(fails || errors.length ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
