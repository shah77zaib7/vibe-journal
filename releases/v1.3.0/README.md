# VibeJournal 1.3.0 — Android app

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

## What's new in 1.3.0

**A welcome screen.** The app now opens on a sign-in screen instead of
dropping you straight into the journal. Sign in with Google, or tap
**Continue without an account** and carry on with the local-only app — that
choice is remembered, so you are never asked twice.

**Cloud backup is switched on.** Your Supabase project is baked into this
build, so Google sign-in and cross-device sync work out of the box. Your
journal still lives on the device first; Supabase is a mirror for backup and
sync, and the app still works fully offline with no account.

## Install

1. Download `VibeJournal-1.3.0-debug.apk` (below, or use the **Download raw file** button)
2. Copy it to your phone
3. Tap it → allow **Install unknown apps** for your file manager
4. Open **VibeJournal** from your app drawer

Requires Android 7.0+ (API 24) and ~15 MB free.

## Verify the download

```bash
sha256sum -c SHA256SUMS.txt
```

## Before screenshots sync

The `shots` storage bucket has to exist in your Supabase project. Run
`tools/supabase-storage.sql` in the SQL Editor once — it creates the bucket
and its access policies. Trades and settings sync without it; only
screenshots need it.

## Notes

- **Debug-signed.** Fine for sideloading, but signed with the standard Android
  debug key rather than a private one. For a personal release build, run
  `bash tools/make-keystore.sh` and then `bash tools/build-release.sh` **on your
  own machine** — back the keystore up, it's the key to every future update.
- The **PWA** version of the same app is at
  https://shah77zaib7.github.io/vibe-journal/
- Move your journal between PWA and app with **Settings → Export JSON → Import**.
- Full setup walkthrough: [`docs/SETUP-CLOUD.md`](../../docs/SETUP-CLOUD.md)
