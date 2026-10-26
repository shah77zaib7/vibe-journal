#!/usr/bin/env node
/** Bundle @supabase/supabase-js into a single ESM file (vendor/supabase.js).
 *  It is loaded lazily — only when the user actually signs in — so the
 *  offline / local-only experience never downloads it. */
'use strict';
const path = require('path');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/index.mjs')],
  bundle: true, format: 'esm', minify: true,
  outfile: path.join(ROOT, 'vendor', 'supabase.js'),
  logLevel: 'error'
});
console.log('✓ bundled supabase-js → vendor/supabase.js');
