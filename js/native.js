/* ============================================================================
   VibeJournal — native (Capacitor) bridge
   Everything here is a no-op in the browser, so the same JS runs in both
   the PWA and the Android app.
   ========================================================================== */
(function (global) {
  'use strict';

  var cap = global.Capacitor || null;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var plugins = (cap && cap.Plugins) || {};

  /* ---------- status bar ---------- */
  function setStatusBar(theme) {
    if (!isNative || !plugins.StatusBar) return;
    try {
      // let the app draw under the status bar, then pad for it in CSS
      plugins.StatusBar.setOverlaysWebView({ overlay: true });
      plugins.StatusBar.setStyle({ style: theme === 'light' ? 'LIGHT' : 'DARK' });
    } catch (e) { /* non-fatal */ }
  }

  /* ---------- splash screen ---------- */
  function hideSplash() {
    if (!isNative || !plugins.SplashScreen) return;
    try { plugins.SplashScreen.hide({ fadeOutDuration: 220 }); } catch (e) {}
  }

  /* ---------- haptics ---------- */
  function haptic(kind) {
    if (!isNative || !plugins.Haptics) return;
    try {
      if (kind === 'success') plugins.Haptics.notification({ type: 'SUCCESS' });
      else if (kind === 'warning') plugins.Haptics.notification({ type: 'WARNING' });
      else if (kind === 'error') plugins.Haptics.notification({ type: 'ERROR' });
      else plugins.Haptics.impact({ style: 'LIGHT' });
    } catch (e) {}
  }

  /* ---------- android back button ---------- */
  var backHandlers = [];
  function onBack(fn) { backHandlers.push(fn); }

  function initBackButton() {
    if (!isNative || !plugins.App) return;
    try {
      plugins.App.addListener('backButton', function () {
        // last registered handler wins; if one handles it, we're done
        for (var i = backHandlers.length - 1; i >= 0; i--) {
          if (backHandlers[i]() === true) return;
        }
        // nothing wanted it — let Android close the app
        try { plugins.App.minimizeApp(); } catch (e) {}
      });
    } catch (e) {}
  }

  /* ---------- status bar height (real inset) ---------- */
  function statusBarHeight() {
    return new Promise(function (resolve) {
      if (!isNative || !plugins.StatusBar || !plugins.StatusBar.getInfo) return resolve(0);
      try {
        plugins.StatusBar.getInfo().then(function (r) {
          resolve(r && r.statusBarStyle ? (r.statusBarStyle === 'DARK' ? 0 : 0) : 0);
        }).catch(function () { resolve(0); });
      } catch (e) { resolve(0); }
    });
  }

  /* ---------- sqlite plugin (loaded lazily as an ES module) ---------- */
  var sqliteMod = null;
  function loadSqlite() {
    if (sqliteMod) return Promise.resolve(sqliteMod);
    if (!isNative) return Promise.resolve(null);
    return import('./vendor/cap-sqlite.js')
      .then(function (m) { sqliteMod = m; return m; })
      .catch(function () { return null; });
  }

  global.VJNative = {
    isNative: isNative,
    plugins: plugins,
    setStatusBar: setStatusBar,
    hideSplash: hideSplash,
    haptic: haptic,
    onBack: onBack,
    statusBarHeight: statusBarHeight,
    loadSqlite: loadSqlite
  };
})(window);
