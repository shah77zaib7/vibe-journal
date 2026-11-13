#!/usr/bin/env node
/**
 * Stage the web app into www/ for the native (Capacitor) build.
 *
 * The PWA is served from the repo root, so this copies the exact same files
 * into www/ — minus dev-only folders (docs, tools) — and bundles the one
 * plugin that needs a bundler. The PWA itself never needs a build step.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

/* folders + files that make up the shipped app */
const COPY_DIRS = ['css', 'js', 'icons', 'vendor'];
const COPY_FILES = ['index.html', 'manifest.webmanifest'];

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function copyDir(src, dest) {
  mkdir(dest);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log('▸ staging web assets → www/');
rmrf(OUT);
mkdir(OUT);
for (const d of COPY_DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) copyDir(src, path.join(OUT, d));
}
for (const f of COPY_FILES) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
}

/* the service worker is a PWA-only concern — in the native app the assets
   are already on disk, and a caching SW only gets in the way of updates */
if (fs.existsSync(path.join(ROOT, 'sw.js'))) {
  console.log('▸ copying sw.js (skipped at runtime when native)');
  fs.copyFileSync(path.join(ROOT, 'sw.js'), path.join(OUT, 'sw.js'));
}

/* bundle the SQLite plugin — it is the only dependency that needs a bundler.
   IMPORTANT: bundle dist/esm/definitions.js, NOT dist/plugin.js.

   dist/plugin.js is a UMD bundle that expects a global `capacitorExports`
   (from @capacitor/core) to exist. Bundling it produces a file with no ESM
   exports at all, and importing it throws "capacitorExports is not
   defined" — which used to fail silently and leave the Android app storing
   nothing. dist/esm/definitions.js has proper `export class` statements and
   no @capacitor/core dependency; the native implementation itself comes
   from the Capacitor bridge (window.Capacitor.Plugins.CapacitorSQLite). */
const sqliteEntry = path.join(ROOT, 'node_modules/@capacitor-community/sqlite/dist/esm/definitions.js');
if (fs.existsSync(sqliteEntry)) {
  const out = path.join(OUT, 'vendor', 'cap-sqlite.js');
  console.log('▸ bundling @capacitor-community/sqlite (definitions) → www/vendor/cap-sqlite.js');
  try {
    const esbuild = require('esbuild');
    esbuild.buildSync({
      entryPoints: [sqliteEntry],
      bundle: true,
      format: 'esm',
      minify: true,
      outfile: out,
      logLevel: 'error'
    });
  } catch (e) {
    console.warn('  ! esbuild failed — native SQLite will fall back to the web store');
    console.warn('  ', e.message);
  }

  /* Verify the bundle really exposes what js/native-store.js imports. A
     silent failure here is what made the Android app lose every trade, so
     it must break the build, not warn. */
  const bundle = fs.readFileSync(out, 'utf8');
  const missing = ['SQLiteConnection', 'SQLiteDBConnection']
    .filter((n) => !new RegExp('export\\s*\\{[^}]*\\b' + n + '\\b').test(bundle) &&
                     !new RegExp('export\\s+(const|class|function)\\s+' + n + '\\b').test(bundle));
  if (missing.length) {
    console.error(`✗ cap-sqlite.js is missing export(s): ${missing.join(', ')}`);
    console.error('  The Android app would silently fail to save anything. Aborting.');
    process.exit(1);
  }
  console.log('  ✓ bundle exports SQLiteConnection + SQLiteDBConnection');
}

/* report */
function walk(dir, base) {
  let bytes = 0, files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = walk(p, base); bytes += r.bytes; files += r.files; }
    else { bytes += fs.statSync(p).size; files++; }
  }
  return { bytes, files };
}
const t = walk(OUT, OUT);
console.log(`✓ staged ${t.files} files, ${(t.bytes / 1024).toFixed(0)} KB → www/`);
