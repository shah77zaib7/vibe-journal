# VibeJournal 1.4.2 — Android storage fix, part 2

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

## What you saw

A **Storage fallback** banner at the top of the app:

> The private database could not be opened (The SQLite plugin bundle failed to
> load.), so trades are being saved in the app's browser storage instead.

That banner was the 1.4.1 safety net doing its job. It meant the app could
not open its private SQLite database, so it fell back to the WebView's
storage. Your trades were still being saved — just somewhere else — and the
app was telling you so rather than pretending everything was fine.

## Why it happened

Two more bugs in the Android storage path, both in code that no browser test
could ever reach (the browser uses IndexedDB and never touches SQLite).

**1. The bundle was looked for in the wrong place.**
`js/native.js` sits at `js/native.js`, but the SQLite bundle sits at
`vendor/cap-sqlite.js`. A dynamic `import()` inside a **classic** script
resolves relative to the *script*, not the document — so the app asked for
`/js/vendor/cap-sqlite.js`, got a **404**, and the plugin never loaded.

**2. `sqlite.init()` does not exist.**
The plugin's `SQLiteConnection` class has no `init()` method, and neither
does the native bridge. The call threw `TypeError: sqlite.init is not a
function` the moment it was reached.

Both were found by the new native-storage test suite, which now runs the
**real** plugin class against a mock native bridge instead of a hand-written
imitation of the plugin — the previous version mocked the wrapper class,
which is exactly why the missing `init()` slipped through.

## The fix

- The bundle URL is now resolved against the document, with a fallback to the
  absolute path.
- The `init()` call is gone; the flow starts at `checkConnectionsConsistency`,
  which is what the plugin actually implements.
- The store still rejects loudly on failure, and the app still falls back to
  browser storage with a visible banner — it just never needs to now.

## The banner stays

You asked whether to remove it. **It stays** — it is the only thing that
turned "the app silently stores nothing" into "the app tells you it cannot
store". It is invisible unless the database genuinely cannot be opened.

If you ever see it again, the app is working, your trades are being saved,
and you should export a backup until it is sorted.

## Install

1. Download `VibeJournal-1.4.2-debug.apk` (below, or use the **Download raw file** button)
2. Copy it to your phone
3. Tap it → allow **Install unknown apps** for your file manager
4. Open **VibeJournal** from your app drawer

Requires Android 7.0+ (API 24) and ~14 MB free.

**Upgrading?** Install straight over the top. Nothing is lost.

## Try it

Open the app → **Settings → Data → Load sample data** → **close the app
completely** → reopen it.

Two things to check:
1. **No banner** at the top of the screen.
2. Your trades are still there.

> If the banner is still there, tell me what it says exactly — it now
> carries the real error, and every fallback path is tested.

## Notes

- **Debug-signed.** Fine for sideloading, but signed with the standard
  Android debug key rather than a private one. For a personal release
  build, run `bash tools/make-keystore.sh` and then
  `bash tools/build-release.sh` **on your own machine** — back the
  keystore up, it's the key to every future update.
- The **PWA** version of the same app is at
  https://shah77zaib7.github.io/vibe-journal/
