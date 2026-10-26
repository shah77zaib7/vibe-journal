#!/usr/bin/env node
/* ============================================================================
   VibeJournal — cloud setup helper
   ----------------------------------------------------------------------------
   Walks you through adding Supabase to your app. It:

     1. asks for your Project URL and anon key
     2. DECODES the key and refuses it if it is a service_role key
        (service_role bypasses Row Level Security and must never be shipped)
     3. pings your project to prove the URL + key actually work
     4. writes js/config.js
     5. prints the schema SQL you still need to run

   Usage:   node tools/setup-cloud.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'js', 'config.js');

/* ── tiny prompt helpers ─────────────────────────────────────────────────── */
/* Hand-rolled rather than readline, for two reasons:
   - a pasted key must not be echoed to the terminal
   - piped input (scripts, CI) arrives as one chunk, so we read char by
     char and stop at the first newline rather than taking the whole buffer */
function makeReader() {
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.resume();

  // A 'data' chunk can contain several lines. Whatever we do not consume
  // now has to survive for the next read, or piped input loses values.
  let pending = '';

  function readLine({ secret = false } = {}) {
    return new Promise((resolve) => {
      let val = '';
      let done = false;

      const finish = (result) => {
        if (done) return;
        done = true;
        stdin.removeListener('data', onData);
        stdin.removeListener('end', onEnd);
        if (stdin.setRawMode) stdin.setRawMode(wasRaw);
        stdin.pause();
        resolve(result);
      };

      // Consume a chunk of text, filling val. Stops at the first newline;
      // whatever follows it is stashed in `pending` for the next read.
      const consume = (text) => {
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (ch === '\r' || ch === '\n') {
            pending = text.slice(i + 1);
            process.stdout.write('\n');
            finish(val);
            return true;
          }
          if (ch === '\u0003' || ch === '\u0004') {       // ctrl-c / ctrl-d
            process.stdout.write('\n');
            process.exit(130);
          }
          if (ch === '\u007f' || ch === '\b') {             // backspace
            if (val.length) {
              val = val.slice(0, -1);
              if (secret) process.stdout.write('\b \b');
            }
            continue;
          }
          val += ch;
          if (secret) process.stdout.write('*');
        }
        return false;
      };

      const onData = (buf) => {
        if (consume(buf.toString())) return;
      };

      const onEnd = () => finish(val);                    // EOF without newline
      stdin.on('data', onData);
      stdin.on('end', onEnd);

      // Anything left over from a previous read is ours already — take it
      // now rather than waiting for a 'data' event that may never come.
      if (pending) {
        const rest = pending;
        pending = '';
        consume(rest);
      }
    });
  }

  return {
    async ask(question, { secret = false } = {}) {
      process.stdout.write(question);
      return readLine({ secret });
    },
    close() {
      if (stdin.setRawMode) stdin.setRawMode(wasRaw);
      stdin.pause();
    }
  };
}

function line(char = '─', n = 64) {
  console.log(char.repeat(n));
}

/* ── decode a Supabase JWT without verifying it (we only read the claims) ── */
function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

/* ── check the project actually answers with these credentials ──────────── */
function pingProject(url, anonKey) {
  return new Promise((resolve) => {
    const u = new URL('/auth/v1/settings', url);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname,
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body: body.slice(0, 300) }));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timed out' }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
  });
}

async function main() {
  const reader = makeReader();
  line('═');
  console.log('  VibeJournal — Supabase setup');
  line('═');
  console.log('');
  console.log('  Need these from your Supabase dashboard:');
  console.log('    Project Settings → API → Project URL');
  console.log('    Project Settings → API → anon (public) key');
  console.log('');
  console.log('  Not the service_role key. The helper below will refuse it.');
  console.log('');

  /* ── 1. project url ── */
  let url = '';
  while (true) {
    const raw = await reader.ask('  Project URL (https://xxxx.supabase.co): ');
    const candidate = raw.replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(candidate)) {
      console.log('    ✗ That does not look like a Supabase project URL.');
      console.log('      It should be exactly: https://xxxxxxxx.supabase.co');
      continue;
    }
    url = candidate;
    break;
  }
  console.log(`    ✓ ${url}`);
  console.log('');

  /* ── 2. anon key ── */
  let key = '';
  while (true) {
    key = await reader.ask('  anon (public) key: ', { secret: true });
    if (!key) { console.log('    ✗ Empty. Paste the anon key.'); continue; }

    const claims = decodeJwt(key);
    if (!claims) {
      console.log('    ✗ That is not a JWT. Copy the whole key — it starts with "eyJ" and ends with "=".');
      continue;
    }
    if (claims.role === 'service_role') {
      console.log('');
      console.log('    ✗✗✗ STOP — that is the service_role key. ✗✗✗');
      console.log('');
      console.log('    The service_role key BYPASSES Row Level Security. If it ships in');
      console.log('    your app, anyone who unpacks the APK gets full read/write access to');
      console.log('    every trade of every user. It must never leave the server.');
      console.log('');
      console.log('    Delete it from your clipboard, then paste the ANON (public) key.');
      console.log('');
      key = '';
      continue;
    }
    if (claims.role && claims.role !== 'anon') {
      console.log(`    ✗ This key has role "${claims.role}", not "anon". Use the anon key.`);
      continue;
    }
    break;
  }
  console.log('    ✓ key looks like an anon key');
  console.log('');

  /* ── 3. prove it works ── */
  console.log('  Checking your project…');
  const res = await pingProject(url, key);
  if (!res.ok) {
    console.log(`    ✗ Could not reach ${url} (HTTP ${res.status}).`);
    if (res.status === 401 || res.status === 403) {
      console.log('      → The key was rejected. You probably copied the wrong one.');
    } else if (res.status === 0) {
      console.log('      → Network error. Check your connection and the URL.');
    } else {
      console.log('      → Check the Project URL and try again.');
    }
    console.log('');
    process.exit(1);
  }
  console.log('    ✓ project reachable, key accepted');
  console.log('');

  /* ── 4. write config ── */
  let cfg = fs.readFileSync(CONFIG_PATH, 'utf8');
  const before = cfg;
  cfg = cfg.replace(/supabaseUrl:\s*'[^']*'/, `supabaseUrl: '${url}'`);
  cfg = cfg.replace(/supabaseAnonKey:\s*'[^']*'/, `supabaseAnonKey: '${key}'`);
  if (cfg === before) {
    console.log('  ✗ Could not find supabaseUrl / supabaseAnonKey in js/config.js.');
    console.log('    Nothing was changed.');
    process.exit(1);
  }
  fs.writeFileSync(CONFIG_PATH, cfg);
  console.log('  ✓ wrote js/config.js');
  console.log('');

  /* ── 5. what is left to do ── */
  line();
  console.log('  DONE — config is written. Two things left:');
  line();
  console.log('');
  console.log('  1. RUN THE SCHEMA (this is the important one — it turns on RLS)');
  console.log('');
  console.log('     Open this file, copy ALL of it, paste into Supabase → SQL Editor → Run:');
  console.log('');
  console.log('       ' + path.join(ROOT, 'tools', 'supabase-schema.sql'));
  console.log('');
  console.log('     Then verify RLS actually took effect:');
  console.log('');
  console.log("       select tablename, rowsecurity from pg_tables");
  console.log("       where schemaname = 'public'");
  console.log("         and tablename in ('trades','shots','settings');");
  console.log('');
  console.log('     All three rows must say rowsecurity = true.');
  console.log('');
  console.log('  2. ENABLE GOOGLE (Authentication → Providers → Google)');
  console.log('     See SETUP-CLOUD.md in the repo for the click-by-click version.');
  console.log('');
  line('═');
  console.log('');
  reader.close();
  console.log('  Then run:  node tools/verify.js && node tools/serve.js');
  console.log('  and open http://localhost:8099/');
  console.log('');
}

main().catch((e) => {
  console.error('  setup failed:', e.message);
  process.exit(1);
});
