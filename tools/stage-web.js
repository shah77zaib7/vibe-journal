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
   @capacitor/core is bundled too, but registerPlugin() resolves the native
   plugin through the global Capacitor bridge at runtime, so this is safe. */
const sqliteEntry = path.join(ROOT, 'node_modules/@capacitor-community/sqlite/dist/plugin.js');
if (fs.existsSync(sqliteEntry)) {
  const out = path.join(OUT, 'vendor', 'cap-sqlite.js');
  console.log('▸ bundling @capacitor-community/sqlite → www/vendor/cap-sqlite.js');
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
