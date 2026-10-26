# VibeJournal 1.2.0 — Android app

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

**New in 1.2.0:** optional Google Sign-In with Supabase cloud backup and
cross-device sync. The app is still local-first — the device is the source of
truth, Supabase is a mirror, and everything works offline with no account.

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

## Cloud backup (optional)

The app ships with cloud backup **switched off** — add your Supabase keys to
`js/config.js` in the repo to turn it on. See the README for the full setup
(including the Google OAuth steps and the Row Level Security check).

## Notes

- **Debug-signed.** Fine for sideloading, but signed with the standard Android
  debug key rather than a private one. For a personal release build, run
  `bash tools/make-keystore.sh` and then `bash tools/build-release.sh` **on your
  own machine** — back the keystore up, it's the key to every future update.
- The **PWA** version of the same app is at
  https://shah77zaib7.github.io/vibe-journal/
- Move your journal between PWA and app with **Settings → Export JSON → Import**.
