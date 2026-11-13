# VibeJournal 1.4.1 — Android storage fix

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

## The bug

**The Android app was not saving anything.** Trades looked like they were
saved — the screen updated, the chart moved — but nothing ever reached
disk. Close the app, reopen it, and the journal was empty.

Sample data would not load either, for the same reason.

The cause was in the bundled SQLite plugin. It was built from the plugin's
UMD entry point, which expects a global `capacitorExports` to exist. The
bundle therefore threw the moment it was imported:

```
capacitorExports is not defined
```

That error was caught and swallowed, the native store returned `null`, and
every method quietly returned a harmless default — `allTrades()` returned
an empty list, `putTrade()` returned without writing a single row. The app
looked perfectly healthy the whole time.

No browser test could ever have caught it, because the browser uses
IndexedDB and never touches the SQLite path.

## The fix

1. **The bundle is built from the plugin's real ESM entry**, which has
   proper exports and no missing global. The build now **fails outright**
   if the bundle does not export `SQLiteConnection` — a broken bundle can
   never ship again.
2. **The native store rejects instead of swallowing.** Any failure is
   recorded and surfaced.
3. **The app falls back to browser storage and tells you.** If the private
   database cannot be opened, a banner appears at the top of the screen
   saying so. Your trades still save; they just go somewhere else, and you
   know about it.

## What about the data you already lost?

Unfortunately it cannot be recovered — it was never written. But the same
thing does not happen again.

**Before 1.4.1**, if you logged a trade on the Android app and reopened it,
the trade was gone. From 1.4.1 onward it is there.

## Install

1. Download `VibeJournal-1.4.1-debug.apk` (below, or use the **Download raw file** button)
2. Copy it to your phone
3. Tap it → allow **Install unknown apps** for your file manager
4. Open **VibeJournal** from your app drawer

Requires Android 7.0+ (API 24) and ~14 MB free.

**Upgrading?** Install straight over the top. Nothing is lost — there was
nothing to lose.

## Verify the download

```bash
sha256sum -c SHA256SUMS.txt
```

## Try it

Open the app → **Settings → Data → Load sample data** (or add a trade by
hand) → **close the app completely** → reopen it. Your trades are still
there.

That is the exact sequence that failed before.

## Notes

- **Debug-signed.** Fine for sideloading, but signed with the standard
  Android debug key rather than a private one. For a personal release
  build, run `bash tools/make-keystore.sh` and then
  `bash tools/build-release.sh` **on your own machine** — back the
  keystore up, it's the key to every future update.
- The **PWA** version of the same app is at
  https://shah77zaib7.github.io/vibe-journal/
