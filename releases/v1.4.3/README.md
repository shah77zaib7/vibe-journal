# VibeJournal 1.4.3 — no more banner, and SQLite actually works

Pre-built, sideloadable APK. Same journal, same UI, as a native Android app.

## The banner is gone

You asked for it, so it is gone. **Nothing appears at the top of the app
any more.** If the storage backend ever needs attention, it is reported as
one quiet line in **Settings → Data**, where the other storage options
already live.

## The real fix behind it

That banner was reporting a genuine failure — a fourth bug in the Android
storage path:

```
Execute: Attempt to invoke virtual method 'java.lang.String
java.lang.String.replace(...)' on a null object reference
```

A **NullPointerException inside the SQLite plugin**. The app was calling
`execute()` with an array of SQL statements, but on Android the plugin's
`execute()` reads `statements` as a **single string**. The array came back
`null`, and the plugin died on `statements.replace(...)`.

So the private database was never created, and the app fell back to the
WebView's storage — which is why your trades were still saving (thankfully)
but the banner kept appearing.

The schema is now created with `executeSet()`, which takes the
`{statement, values}` shape and behaves the same on every platform.

**Your data is fine.** The fallback was a real, working store in the app's
private directory — your trade came back after reopening the app because it
was saved correctly, just in the other database.

## The test that caught it

The native-storage suite now mocks the plugin's **native bridge** rather
than its wrapper class, and the mock enforces the plugin's real contract.
`execute()` with an array now fails the test instead of silently producing
a null on a phone.

It also asserts the schema is created via `executeSet` and never via
`execute`.

## Install

1. Download `VibeJournal-1.4.3-debug.apk` (below, or use the **Download raw file** button)
2. Copy it to your phone
3. Tap it → allow **Install unknown apps** for your file manager
4. Open **VibeJournal** from your app drawer

Requires Android 7.0+ (API 24) and ~14 MB free.

**Upgrading?** Install straight over the top. Nothing is lost.

## Try it

Open the app. **No banner.** Add a trade, close the app completely, reopen
it — your trade is there.

## Notes

- **Debug-signed.** Fine for sideloading, but signed with the standard
  Android debug key rather than a private one. For a personal release
  build, run `bash tools/make-keystore.sh` and then
  `bash tools/build-release.sh` **on your own machine** — back the
  keystore up, it's the key to every future update.
- The **PWA** version of the same app is at
  https://shah77zaib7.github.io/vibe-journal/
