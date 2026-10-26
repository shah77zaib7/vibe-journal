/* ============================================================================
   VibeJournal — cloud account sheet
   Sign in with Google, see sync status, sign out.
   ========================================================================== */
(function (global) {
  'use strict';

  var $ = VJUI.$, esc = VJUI.esc;
  var sheet = null;
  var scrim = null;
  var onChange = null;

  function ready() {
    if (!sheet) {
      sheet = document.getElementById('cloudSheet');
      scrim = document.getElementById('cloudScrim');
      if (!sheet) return false;
      sheet.addEventListener('click', function (e) {
        var b = e.target.closest('[data-cloud-action]');
        if (!b) return;
        var a = b.dataset.cloudAction;
        if (a === 'signin') signIn();
        else if (a === 'signout') signOut();
        else if (a === 'sync') sync();
        else if (a === 'close') close();
      });
      if (scrim) scrim.addEventListener('click', close);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sheet && !sheet.hidden) close();
      });
    }
    return true;
  }

  function open() {
    if (!ready()) return;
    render();
    scrim.hidden = false;
    sheet.hidden = false;
    sheet.classList.remove('closing');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!sheet) return;
    sheet.classList.add('closing');
    setTimeout(function () {
      sheet.hidden = true;
      sheet.classList.remove('closing');
      scrim.hidden = true;
      document.body.style.overflow = '';
    }, 200);
  }

  function ago(ts) {
    if (!ts) return 'never';
    var d = Math.floor((Date.now() - ts) / 1000);
    if (d < 45) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }

  function render() {
    if (!ready()) return;
    var st = global.VJCloud.status();
    var body = sheet.querySelector('.sheet-body');

    if (!st.configured) {
      body.innerHTML =
        '<div class="cloud-empty">' +
          '<span class="cloud-ic"><svg class="ic"><use href="#i-cloud"/></svg></span>' +
          '<h3>Cloud backup isn’t set up yet</h3>' +
          '<p>The app works exactly as it does now — everything is stored on this device, nothing is uploaded. ' +
          'Add your Supabase keys to <code>js/config.js</code> to turn on Google Sign-In and cross-device sync.</p>' +
          '<ol class="cloud-steps">' +
            '<li>Create a project at <b>supabase.com</b></li>' +
            '<li>Run <code>tools/supabase-schema.sql</code> in the SQL Editor</li>' +
            '<li>Enable <b>Google</b> under Authentication → Providers</li>' +
            '<li>Paste the Project URL and <b>anon</b> key into <code>js/config.js</code></li>' +
          '</ol>' +
        '</div>';
      return;
    }

    if (!st.signedIn) {
      body.innerHTML =
        '<div class="cloud-empty">' +
          '<span class="cloud-ic"><svg class="ic"><use href="#i-cloud"/></svg></span>' +
          '<h3>Sign in to back up your journal</h3>' +
          '<p>Your trades stay on this device either way. Signing in adds a private cloud copy so you can ' +
          'restore after a reinstall, or move between your phone and your laptop.</p>' +
          '<button class="btn-google" data-cloud-action="signin">' +
            '<svg class="ic" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/><path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 6.68 9.14 4.75 12 4.75z"/></svg>' +
            '<span>Continue with Google</span>' +
          '</button>' +
          (st.error ? '<p class="cloud-err"><svg class="ic"><use href="#i-alert"/></svg>' + esc(st.error) + '</p>' : '') +
        '</div>';
      return;
    }

    /* signed in */
    var name = (st.user && st.user.name) || (st.user && st.user.email) || 'You';
    body.innerHTML =
      '<div class="cloud-user">' +
        '<span class="cloud-avatar">' + esc(name.charAt(0).toUpperCase()) + '</span>' +
        '<div><b>' + esc(name) + '</b><span>' + esc((st.user && st.user.email) || '') + '</span></div>' +
      '</div>' +
      '<div class="cloud-status">' +
        row('Last synced', ago(st.lastSyncAt)) +
        row('Pending changes', String(st.pending)) +
        row('Connection', st.online ? 'Online' : 'Offline — will sync when back') +
        row('Status', st.syncing ? 'Syncing…' : (st.error ? 'Error' : 'Up to date')) +
      '</div>' +
      (st.error ? '<p class="cloud-err"><svg class="ic"><use href="#i-alert"/></svg>' + esc(st.error) + '</p>' : '') +
      '<div class="cloud-actions">' +
        '<button class="btn-ghost" data-cloud-action="sync"><svg class="ic"><use href="#i-dl"/></svg><span>Sync now</span></button>' +
        '<button class="btn-ghost danger" data-cloud-action="signout"><svg class="ic"><use href="#i-close"/></svg><span>Sign out</span></button>' +
      '</div>' +
      '<p class="cloud-note">Signing out keeps your journal on this device. Nothing is deleted — the cloud copy stays ' +
      'in your Supabase account and you can sign back in any time.</p>';
  }

  function row(k, v) {
    return '<div class="cloud-kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  }

  function signIn() {
    var btn = sheet.querySelector('[data-cloud-action="signin"]');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    global.VJCloud.signInWithGoogle()
      .then(function (r) {
        if (r && r.redirecting) return;   // the page is navigating away
        render();
      })
      .catch(function (e) {
        global.VJCloud.state.error = e.message;
        render();
      });
  }

  function signOut() {
    global.VJCloud.signOut().then(function () {
      render();
      if (onChange) onChange();
    });
  }

  function sync() {
    global.VJCloud.syncNow()
      .then(function () { render(); })
      .catch(function () { render(); });
  }

  global.VJCloudUI = {
    open: open,
    close: close,
    render: render,
    onChange: function (fn) { onChange = fn; }
  };
})(window);
