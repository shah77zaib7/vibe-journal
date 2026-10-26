# VibeJournal 1.2.1 — Android app

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

**New in 1.2.0:** optional Google Sign-In with Supabase cloud backup and
cross-device sync. The app is still local-first — the device is the source of
truth, Supabase is a mirror, and everything works offline with no account.

**Fixed in 1.2.1:** the cloud icon in the sidebar and Settings was missing
from the icon sprite (it rendered as an empty box), and the new cloud
modules were not in the service worker precache list, so they could be
missing when the app started offline.

## Install

1. Download `VibeJournal-1.2.1-debug.apk` (below, or use the **Download raw file** button)
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
`js/config.js` in the repo to turn it on, then rebuild the APK (the keys
are compiled into it).

Full walkthrough, screen by screen: [`docs/SETUP-CLOUD.md`](../../docs/SETUP-CLOUD.md).

Or run the helper, which decodes your key, **refuses a `service_role` key**,
checks your project answers, and writes the config for you:

```bash
node tools/setup-cloud.js
```

## Notes

- **Debug-signed.** Fine for sideloading, but signed with the standard Android
  debug key rather than a private one. For a personal release build, run
  `bash tools/make-keystore.sh` and then `bash tools/build-release.sh` **on your
  own machine** — back the keystore up, it's the key to every future update.
- The **PWA** version of the same app is at
  https://shah77zaib7.github.io/vibe-journal/
- Move your journal between PWA and app with **Settings → Export JSON → Import**.
