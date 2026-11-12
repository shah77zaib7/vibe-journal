# VibeJournal 1.4.0 — Android app

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

## What's new in 1.4.0

**No sign-in. No account. No cloud. No network calls at all.**

The Google sign-in, the Supabase sync layer and the welcome screen are all
gone. The app opens straight into your journal and stays there. There is
nowhere for your data to go — it is stored on your device and nowhere else.

This also makes the app noticeably lighter: the 223 KB Supabase bundle is no
longer shipped, so the APK is smaller and starts faster.

## Your data is safe

Removing the cloud layer touched nothing in the local store. Verified by
a dedicated test suite that:

- writes trades, screenshots and settings, then refreshes — everything intact
- reloads five times in a row — everything intact
- **closes the whole browser and reopens it on the same profile** — everything intact
- goes offline and comes back — everything intact
- round-trips export → erase → import — every trade restored

The local store was always `CREATE TABLE IF NOT EXISTS` / `IF NOT EXISTS`
object stores, so there is no migration that could drop data.

## Back up your journal

There is no cloud, so your backup is a file you own.

**Settings → Data → Export** writes one JSON file with every trade, every
screenshot and your settings. **Import** restores it on any device, in any
browser. That is also how you move a journal between the PWA and this app.

> The only thing that can delete your journal is clearing the app's storage:
> *Settings → Apps → VibeJournal → Storage → Clear storage* on Android, or
> clearing site data in a browser. Uninstalling does the same. Export
> regularly if this journal matters to you.

## Install

1. Download `VibeJournal-1.4.0-debug.apk` (below, or use the **Download raw file** button)
2. Copy it to your phone
3. Tap it → allow **Install unknown apps** for your file manager
4. Open **VibeJournal** from your app drawer

Requires Android 7.0+ (API 24) and ~14 MB free.

**Upgrading from 1.3.0?** Your trades are untouched — install over the top.
The database is not recreated. The Supabase sign-in is simply gone.

## Verify the download

```bash
sha256sum -c SHA256SUMS.txt
```

## Notes

- **Debug-signed.** Fine for sideloading, but signed with the standard Android
  debug key rather than a private one. For a personal release build, run
  `bash tools/make-keystore.sh` and then `bash tools/build-release.sh` **on your
  own machine** — back the keystore up, it's the key to every future update.
- The **PWA** version of the same app is at
  https://shah77zaib7.github.io/vibe-journal/
