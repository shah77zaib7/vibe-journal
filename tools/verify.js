/* static integrity sweep for the shipped app */
'use strict';
const fs = require('fs');
const path = require('path');
// resolve from this file, not the cwd — the repo is runnable from anywhere
const P = path.resolve(__dirname, '..') + path.sep;
const html = fs.readFileSync(P+'index.html','utf8');
const css  = fs.readFileSync(P+'css/style.css','utf8');
const js   = ['app','ui','db','stats','instruments','picker','candles','cloud','cloud-ui','config']
                .map(f => fs.readFileSync(P+`js/${f}.js`,'utf8')).join('\n');
let fail = 0;

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const refs = new Set([...js.matchAll(/\$\$?\(\s*'#([A-Za-z0-9_-]+)'/g)].map(m=>m[1])
  .concat([...js.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'/g)].map(m=>m[1])));
const dyn = new Set(['detShot','detCandle']);
const missing = [...refs].filter(r => !ids.has(r) && !dyn.has(r));
console.log(missing.length ? 'MISSING IDS: '+missing.join(', ') : `OK  ${refs.size} JS id refs resolve`);
if (missing.length) fail++;

const syms = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m=>m[1]));
const uses = [...new Set([...html.matchAll(/<use href="#(i-[a-z0-9-]+)"/g)].map(m=>m[1])
  .concat([...js.matchAll(/"(i-[a-z0-9-]+)"/g)].map(m=>m[1])))];
const badUse = uses.filter(u => !syms.has(u));
console.log(badUse.length ? 'MISSING ICONS: '+badUse.join(', ') : `OK  ${uses.length} icon refs resolve`);
if (badUse.length) fail++;

// every <script src> must exist and be in the precache list
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
const gone = scripts.filter(f => !fs.existsSync(P+f));
console.log(gone.length ? 'MISSING SCRIPTS: '+gone.join(', ') : `OK  ${scripts.length} script tags exist`);
if (gone.length) fail++;

const sw = fs.readFileSync(P+'sw.js','utf8');
const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m=>m[1]).filter(Boolean);
const unshipped = shell.filter(f => !fs.existsSync(P+f));
const notCached = scripts.filter(f => !shell.includes(f.replace(/^js\//,'js/').replace(/^vendor\//,'vendor/')) && !shell.includes(f));
console.log(unshipped.length ? 'SW POINTS AT MISSING FILE: '+unshipped.join(', ') : `OK  ${shell.length} precache entries exist`);
if (unshipped.length) fail++;
if (notCached.length) { console.log('  WARN not precached: '+notCached.join(', ')); fail++; }

const junk = ['console.log','debugger','TODO','FIXME'].filter(k => js.includes(k));
console.log(junk.length ? 'LEFTOVERS: '+junk.join(', ') : 'OK  no debug leftovers');
if (junk.length) fail++;

const o=(css.match(/{/g)||[]).length, c=(css.match(/}/g)||[]).length;
console.log(o===c ? `OK  CSS balanced (${o} rules)` : `CSS UNBALANCED ${o}/${c}`);
if (o!==c) fail++;

console.log(fail? `\n${fail} PROBLEM(S)` : '\nAll integrity checks passed.');
process.exit(fail?1:0);
