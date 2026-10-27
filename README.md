# VibeJournal

A private, installable **trading journal** that runs entirely in your browser.
No backend, no account, no telemetry — every trade you log stays in your
device's IndexedDB and is never transmitted anywhere.

![Dashboard](docs/dashboard.png)

---

## Features

**Trade logging** — date/time, pair, direction, entry, stop loss, take profit,
lot size, risk (amount *or* %), strategy, result, P&L, notes, custom tags and an
optional chart screenshot (stored as a compressed blob). Live R:R and pip
distance as you type; P&L auto-fills from risk × R:R when you mark a result.

**Dashboard** — net P&L, win-rate ring, equity curve over 30D/90D/6M/1Y/ALL,
profit factor, average R:R, average risk, recent trades and a per-strategy
breakdown.

**Journal** — full-text search across symbol, strategy, notes and tags, with
filters for date range, pair, strategy, result, direction and tags. Sortable
columns, one-tap edit and delete, and a full detail sheet per trade.

**Analytics** — performance (expectancy, average win/loss, best/worst, payoff
ratio, streaks), strategy and pair breakdowns, risk management stats
(average/largest/total risk, consistency, realised R), and a timeline with
monthly / weekly / day-of-week / hourly views.

**Candlestick chart** — real OHLC candles with *your* entries, stops and
targets plotted on the price series, plus 1H/4H/1D/1W timeframes. Also appears
in miniature inside each trade's detail sheet.

![Candlestick chart](docs/candlestick-chart.png)

**Data** — JSON export (including screenshots as base64), CSV export,
JSON import, and a one-tap full wipe. Sample data generator for exploring the
app before committing your own trades.

## Install it

VibeJournal is a PWA. Serve the folder over HTTP and it will offer to install:

```bash
# any static server works
npx serve .
python3 -m http.server 8000
```

Then open it on your phone and use the browser's **Add to Home Screen** — it
launches fullscreen, works offline, and keeps your data between sessions.

> Service workers require HTTPS (or `localhost`). If you deploy to GitHub
> Pages, enable **Settings → Pages → Deploy from branch `main` / (root)**.

## Cloud backup & sync (optional)

Sign in with Google to keep a private copy of your journal in **your own
Supabase project** and sync it across devices.

**The app is local-first.** Your device's storage is always the source of
truth; Supabase is a mirror. So the app still works offline, still works
with no account, and signing in is entirely optional. Nothing is uploaded
until you sign in.

### Setup (about 10 minutes)

> **New to this? Follow the click-by-click guide →
> [`docs/SETUP-CLOUD.md`](docs/SETUP-CLOUD.md)** — it goes screen by screen
> through Google Cloud, Supabase and the app, with the common traps called
> out. Or let the helper do the fiddly part:
>
> ```bash
> npm run setup:cloud
> ```
>
> It decodes your key, **refuses a `service_role` key**, checks your project
> actually answers, and writes `js/config.js` for you.


**1. Create a Supabase project** — [supabase.com](https://supabase.com) → New project.

**2. Run the schema.** SQL Editor → New query → paste the whole of
[`tools/supabase-schema.sql`](tools/supabase-schema.sql) → Run.

> That file creates three tables and, crucially, the **Row Level Security
> policies** that keep your data private. Run it as-is.

**3. Enable Google sign-in.** Authentication → Providers → Google → enable.
You need a Google OAuth client:

- Google Cloud Console → *APIs & Services* → *Credentials* → **Create OAuth
  client ID** → type **Web application**
- Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
- Add `<your-project-ref>.supabase.co` as an authorised JavaScript origin
- Paste the client ID + secret into the Supabase Google provider form

**4. Add your keys** to `js/config.js`:

```js
supabaseUrl: 'https://<your-project-ref>.supabase.co',
supabaseAnonKey: '<the anon / public key>',
```

Use the **anon** key, never `service_role` — the service-role key bypasses
Row Level Security and must never be committed or shipped.

Leave the keys blank and the app stays 100% local; the Supabase code is not
even downloaded.

### The welcome gate

The app opens on a sign-in screen rather than dropping you straight into the
journal. Sign in with Google, or choose **Continue without an account** and
carry on with the local-only app — that choice is remembered, so you are
never asked twice.

The gate only appears when there is something to sign into: with no
Supabase project configured it stays out of the way entirely.

### How the sync works

| | |
|---|---|
| **Source of truth** | your device (IndexedDB in the browser, SQLite in the app) |
| **Conflict rule** | last write wins, compared on `updatedAt` |
| **Deletes** | soft — a tombstone is synced so a deleted trade cannot reappear |
| **Screenshots** | uploaded to a private Storage bucket at `{user_id}/{trade_id}.jpg` |
| **When it syncs** | on sign-in, on every change, when the app returns to the foreground, and every 60s while open |

Move a journal between devices or between the PWA and the app with
**Settings → Export JSON → Import**.

### 🔒 Security note

The `anon` key ships inside the app and in this public repo — that is
normal and safe, it is designed to be public. **The only thing protecting
your trades is Row Level Security.** After running the schema, confirm it
took effect:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('trades','shots','settings');
```

Every row must read `rowsecurity = true`. If any says `false`, your data
is exposed — re-run the schema.

## Android app

The same code also builds as a native Android app with
[Capacitor](https://capacitorjs.com/) — same UI, same data model, but with
native storage, haptics, the Android back button and no service worker.

```bash
npm install
bash tools/android-toolchain.sh      # JDK 21 + Android SDK (once)
bash tools/make-keystore.sh          # your signing key (once — BACK IT UP)
bash tools/build-release.sh          # → android/app/build/outputs/apk/release/
```

Sideload the APK: copy it to the phone, allow **Install unknown apps** for
your file manager, tap it. To rebuild after a change, run
`bash tools/build-apk.sh` (debug build) or `bash tools/build-release.sh`.

**Native differences from the PWA**

| | PWA | Android |
|---|---|---|
| Storage | IndexedDB | SQLite in the app's private data dir |
| Cloud sync | Supabase (optional) | Supabase (optional) |
| Service worker | yes | no — assets ship inside the APK |
| Back button | browser history | closes the sheet, then steps back a view |
| Data | browser storage | survives cache eviction; uninstalling removes it |

Your journal moves between the two with **Settings → Export JSON → Import**.

> **The keystore is the key to every future update.** If you lose it, Android
> will refuse to install a newer build over the existing app, and you'll have
> to uninstall first — which deletes the app's data. Generate it on your own
> machine (`tools/make-keystore.sh`) and back it up.

## Design

**"Frosted Ink"** — an iOS-style glass surface system: translucent panels over
a grayscale palette, hairline borders, soft shadows and generous whitespace.
Dark by default, with a full light theme and an optional semantic red/green
P&L mode.

![Mobile picker](docs/mobile-picker.png)

## Performance

Rendering was profiled on an emulated iPhone 13 at 4× CPU throttling:

| | before | after |
|---|---|---|
| Scroll p95 frame | 42 ms | **19 ms** |
| Dropped frames (206) | 13 | **0** |
| Tab switch (click → painted) | ~300–500 ms | **47 ms avg** |

The wins came from removing live `backdrop-filter` from scrolling surfaces
(146 elements → 0 on mobile), replacing the blurred decorative blobs with
gradient layers, gating sticky `:hover` behind a real pointer, and skipping
chart rebuilds when the underlying data has not changed.

## Tech

Vanilla HTML, CSS and JavaScript — no build step, no framework, no runtime
dependencies. [Chart.js](https://www.chartjs.org/) 4.4.7 is vendored into
`vendor/` so the app is fully functional offline. Icons are generated by
`tools/make_icons.py` (Pillow).

```
index.html            app shell
css/style.css         design system + layout
js/db.js              IndexedDB layer
js/stats.js           analytics engine (pure functions)
js/instruments.js     instrument catalogue
js/picker.js          searchable combobox
js/candles.js         candlestick renderer
js/ui.js              formatting + chart theming
js/app.js             application
sw.js                 precaching service worker
```

## Tests

```bash
npm i -D playwright && npx playwright install chromium

node tools/serve.js &        # static server on :8099
node tools/verify.js         # static integrity sweep
node tools/e2e.js             # core app  (38 checks)
node tools/e2e2.js            # data, export, import  (18 checks)
node tools/e2e3.js            # picker, candles, colour  (35 checks)
node tools/perf-mobile.js     # mobile frame-time profile
node tools/e2e4.js            # Google sign-in + Supabase sync  (22 checks)
node tools/e2e5.js            # the welcome gate                 (34 checks)
```

The sync suite runs against a **mock Supabase backend** injected at the
network layer, so the real sync engine — dirty tracking, pull, push, soft
deletes, last-write-wins — is exercised without needing a real project.

## Privacy

There is no analytics, no tracking and no network call of any kind after the
app is cached. Your journal is stored under the `vibejournal` IndexedDB
database on your device. Clearing site data deletes it permanently — export a
backup first if you care about it.

## Licence

MIT — use it however you like.
