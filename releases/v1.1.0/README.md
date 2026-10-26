# VibeJournal 1.1.0 — Android app

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

## Install

1. Download `VibeJournal-1.2.0-debug.apk` (below, or use the **Download raw file** button)
2. Copy it to your phone
3. Tap it → allow **Install unknown apps** for your file manager
4. Open **VibeJournal** from your app drawer

Requires Android 7.0+ (API 24) and ~15 MB free.

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
- Move your journal between PWA and app with **Settings → Export JSON → Import**.

| | PWA | Android |
|---|---|---|
| Storage | IndexedDB | SQLite in the app's private data dir |
| Service worker | yes | no — assets ship inside the APK |
| Back button | browser history | closes the sheet, then steps back a view |
