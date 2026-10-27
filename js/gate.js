/* ============================================================================
   VibeJournal — welcome gate
   ----------------------------------------------------------------------------
   The entry screen. It stands in front of the app until the user either
   signs in or chooses to stay local-only.

   Two rules govern it:
     • It never blocks the app for someone who has no account and does not
       want one — that choice is remembered, not re-asked.
     • It never shows when there is nothing to sign into (no Supabase
       project configured) or when a session already exists.
   ========================================================================== */
(function (global) {
  'use strict';

  var SKIP_KEY = 'cloud:skipGate';

  var el = {};
  var db = null;
  var busy = false;
  var leaving = false;
  var shown = false;
  var resetTimer = null;

  function $(sel) { return document.querySelector(sel); }

  function ready() {
    if (el.root) return true;
    el.root = $('#gate');
    if (!el.root) return false;
    el.card = $('.gate-card', el.root);
    el.google = $('#gateGoogle');
    el.skip = $('#gateSkip');
    el.err = $('#gateErr');
    el.foot = $('#gateFoot');
    return !!(el.google && el.skip);
  }

  function configured() {
    var cfg = global.VJConfig || {};
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  /* ─────────────────────────── showing ─────────────────────────── */

  function show() {
    if (!ready() || shown || leaving) return;
    shown = true;
    el.root.hidden = false;
    document.documentElement.classList.add('gate-open');
    el.err.hidden = true;
    setBusy(false);

    // two frames: one for the browser to paint the un-hidden element, one
    // for the class change to actually animate
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.root.classList.add('is-in');
      });
    });

    // focus the card, not the button — focusing the button paints a focus
    // ring on the hero CTA, which reads like a stray border
    try { el.card.focus({ preventScroll: true }); } catch (e) { /* noop */ }
  }

  function hide() {
    if (!ready() || !shown || leaving) return;
    leaving = true;
    shown = false;
    el.root.classList.remove('is-in');
    el.root.classList.add('is-leaving');
    document.documentElement.classList.remove('gate-open');
    clearTimeout(resetTimer);

    setTimeout(function () {
      el.root.hidden = true;
      el.root.classList.remove('is-leaving');
      leaving = false;
    }, 470);
  }

  function setBusy(on) {
    busy = !!on;
    el.google.classList.toggle('is-busy', busy);
    el.google.disabled = busy;
  }

  function setErr(msg) {
    if (!el.err) return;
    if (!msg) { el.err.hidden = true; el.err.textContent = ''; return; }
    el.err.textContent = msg;
    el.err.hidden = false;
    el.err.classList.remove('is-shake');
    // restart the shake animation
    void el.err.offsetWidth;
    el.err.classList.add('is-shake');
  }

  /* ─────────────────────────── actions ─────────────────────────── */

  function signIn() {
    if (busy || !global.VJCloud) return;
    setErr('');
    setBusy(true);

    // If the user comes back without finishing (closed the browser, denied
    // consent), don't leave the button spinning forever.
    clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      if (busy) { setBusy(false); setErr('Sign-in was cancelled. Try again when you are ready.'); }
    }, 90000);

    global.VJCloud.signInWithGoogle().then(function (res) {
      if (res && res.redirecting) {
        // web: the whole tab is navigating to Google. Leave the button
        // spinning — the page will come back with a session.
        return;
      }
      // native: the auth browser is open. We wait for the deep link.
    }).catch(function (e) {
      clearTimeout(resetTimer);
      setBusy(false);
      setErr((e && e.message) ? e.message : 'Could not start sign-in.');
    });
  }

  function skip() {
    if (busy) return;
    if (db) {
      db.setMeta(SKIP_KEY, true).catch(function () { /* not fatal */ });
    }
    hide();
  }

  /* ─────────────────────────── wiring ─────────────────────────── */

  function bind() {
    el.google.addEventListener('click', signIn);
    el.skip.addEventListener('click', skip);

    // Enter / Space on the focused button
    el.google.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); signIn(); }
    });

    // If the user returns to the tab without completing sign-in, let them
    // try again rather than sitting on a dead spinner.
    global.addEventListener('focus', function () {
      if (busy && global.VJCloud) {
        var st = global.VJCloud.status();
        if (!st.signedIn) {
          clearTimeout(resetTimer);
          setBusy(false);
        }
      }
    });
  }

  /**
   * @param {object} store  VJDB
   */
  function init(store) {
    db = store || global.VJDB;
    if (!ready()) return;
    bind();

    // The gate is only interesting if there is something to sign into.
    if (!configured()) {
      if (el.foot) el.foot.textContent = 'Your journal stays on this device. Cloud backup is not set up.';
      return;
    }

    // Signed in already? Nothing to gate.
    if (global.VJCloud) {
      global.VJCloud.onAuthChange(function (st) {
        if (st && st.signedIn) {
          clearTimeout(resetTimer);
          setBusy(false);
          hide();
        }
      });
      var st = global.VJCloud.status();
      if (st && st.signedIn) return;
    }

    // Ask once. A local-only user is never asked again.
    if (db && db.getMeta) {
      db.getMeta(SKIP_KEY, false).then(function (skipped) {
        if (!skipped) show();
      }).catch(function () { show(); });
    } else {
      show();
    }
  }

  global.VJGate = {
    init: init,
    show: show,
    hide: hide,
    isOpen: function () { return shown; }
  };
})(window);
