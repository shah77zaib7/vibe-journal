/* ============================================================================
   VibeJournal — cloud layer (Supabase) + sync engine
   ----------------------------------------------------------------------------
   Local-first by design:
     • the local store (IndexedDB / SQLite) is the source of truth the UI reads
     • Supabase is a mirror for backup and cross-device sync
     • nothing in the UI ever waits on the network
   So the app keeps working offline, keeps working with no account, and
   signing in is entirely optional.

   Sync strategy: last-write-wins on `updatedAt`, with soft deletes so a
   deletion on one device propagates instead of the row reappearing.
   ========================================================================== */
(function (global) {
  'use strict';

  var CFG = global.VJConfig || {};
  var state = {
    configured: false,
    client: null,
    user: null,
    session: null,
    lastSyncAt: 0,
    pending: 0,
    syncing: false,
    error: null,
    online: true
  };

  var listeners = [];
  var db = null;            // VJDB
  var dirty = {};           // tradeId -> true
  var tombstones = {};      // tradeId -> deletedAt ms
  var DIRTY_KEY = 'sync:dirty';
  var TOMB_KEY = 'sync:tombstones';
  var LAST_KEY = 'sync:lastAt';

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(status()); } catch (e) { /* listener errors must not break sync */ }
    });
  }

  function status() {
    return {
      configured: state.configured,
      signedIn: !!state.user,
      user: state.user ? { id: state.user.id, email: state.user.email, name: state.user.user_metadata && state.user.user_metadata.full_name } : null,
      lastSyncAt: state.lastSyncAt,
      pending: Object.keys(dirty).length + Object.keys(tombstones).length,
      syncing: state.syncing,
      error: state.error,
      online: state.online
    };
  }

  /* ─────────────────────────── config ─────────────────────────── */

  function isConfigured() {
    return !!(CFG.supabaseUrl && CFG.supabaseAnonKey &&
              /^https?:\/\//.test(CFG.supabaseUrl));
  }

  function isNative() {
    return !!(global.VJNative && global.VJNative.isNative);
  }

  /* ─────────────────────────── client ─────────────────────────── */

  function loadClient() {
    if (state.client) return Promise.resolve(state.client);
    if (!isConfigured()) return Promise.reject(new Error('Cloud backup is not configured.'));
    return import('../vendor/supabase.js').then(function (mod) {
      state.client = mod.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: !isNative(),   // native handles the redirect itself
          flowType: isNative() ? 'implicit' : 'pkce'
        }
      });
      state.configured = true;
      attachAuthListener();
      return state.client;
    });
  }

  /* ─────────────────────────── auth ─────────────────────────── */

  function redirectUri() {
    if (isNative()) return CFG.oauthRedirectNative || 'vibejournal://auth-callback';
    return CFG.oauthRedirectWeb || (location.origin + location.pathname);
  }

  /**
   * Google sign-in.
   * Web  : Supabase redirects the whole tab; the session is picked up on return.
   * App : we open the auth URL in the system browser and wait for the deep
   *       link to bounce back with the tokens.
   */
  function signInWithGoogle() {
    return loadClient().then(function (client) {
      var opts = {
        provider: 'google',
        options: {
          redirectTo: redirectUri(),
          skipBrowserRedirect: isNative()
        }
      };
      if (!isNative()) {
        // full-page redirect
        return client.auth.signInWithOAuth(opts).then(function (data) {
          return { redirecting: true, url: data && data.url };
        });
      }
      return client.auth.signInWithOAuth(opts).then(function (data) {
        if (!data || !data.url) throw new Error('Could not start Google sign-in.');
        return openAuthWindow(data.url);
      });
    });
  }

  function openAuthWindow(url) {
    var browser = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Browser;
    if (!browser) {
      // no browser plugin (e.g. running as a plain web page) — fall back
      window.open(url, '_blank');
      return Promise.resolve({ opened: true });
    }
    return browser.open({ url: url, presentationStyle: 'popover', toolbarColor: '#0B0B0D' })
      .then(function () { return { opened: true }; });
  }

  /** Called when the Android deep link fires with the OAuth tokens. */
  function handleDeepLink(url) {
    if (!url || !/access_token|code=/.test(url)) return Promise.resolve(false);
    return loadClient().then(function (client) {
      var hash = url.indexOf('#') > -1 ? url.slice(url.indexOf('#') + 1) : '';
      var params = new URLSearchParams(hash || url.split('?')[1] || '');
      var access_token = params.get('access_token');
      var refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        return client.auth.setSession({ access_token: access_token, refresh_token: refresh_token })
          .then(function () { return true; });
      }
      var code = params.get('code');
      if (code) {
        return client.auth.exchangeCodeForSession(code).then(function () { return true; });
      }
      return false;
    }).catch(function (e) {
      state.error = e.message;
      emit();
      return false;
    });
  }

  function signOut() {
    if (!state.client) return Promise.resolve();
    return state.client.auth.signOut().then(function () {
      state.user = null;
      state.session = null;
      emit();
    });
  }

  function currentUser() { return state.user; }

  function onAuthChange(fn) {
    listeners.push(fn);
    attachAuthListener();
  }

  var authListenerAttached = false;

  /**
   * Supabase's auth listener has to be attached to the live client, which
   * may not exist yet when the app registers its listener. Attach it as soon
   * as the client exists — otherwise sign-in events are never seen.
   */
  function attachAuthListener() {
    if (authListenerAttached || !state.client) return;
    authListenerAttached = true;
    state.client.auth.onAuthStateChange(function (event, session) {
      state.session = session;
      state.user = session ? session.user : null;
      if (event === 'SIGNED_IN') {
        // first sign-in: everything currently on the device is ours
        markAllDirty().then(saveDirtyState).catch(function () {});
      }
      emit();
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // IMPORTANT: never make Supabase calls synchronously inside this
        // callback — supabase-js holds an auth lock while it runs, and
        // postgrest calls auth.getSession() internally, which deadlocks.
        // Defer to the next tick, after the lock is released.
        setTimeout(function () { syncNow().catch(function () {}); }, 0);
      }
    });
  }

  /* ───────────────────── dirty / tombstone tracking ───────────────────── */

  function loadDirtyState() {
    return Promise.all([
      db.getMeta(DIRTY_KEY, {}),
      db.getMeta(TOMB_KEY, {}),
      db.getMeta(LAST_KEY, 0)
    ]).then(function (r) {
      dirty = r[0] || {};
      tombstones = r[1] || {};
      state.lastSyncAt = r[2] || 0;
    });
  }

  function saveDirtyState() {
    return Promise.all([
      db.setMeta(DIRTY_KEY, dirty),
      db.setMeta(TOMB_KEY, tombstones)
    ]);
  }

  function markDirty(id) {
    if (!id) return;
    dirty[id] = true;
    delete tombstones[id];
    state.pending = Object.keys(dirty).length + Object.keys(tombstones).length;
  }

  function markAllDirty() {
    return db.allTrades().then(function (rows) {
      rows.forEach(function (t) { dirty[t.id] = true; });
    });
  }

  function markDeleted(id) {
    delete dirty[id];
    tombstones[id] = Date.now();
    state.pending = Object.keys(dirty).length + Object.keys(tombstones).length;
  }

  /* ─────────────────────────── sync ─────────────────────────── */

  function table(name) { return state.client.from(name); }

  /** Remote → local. */
  function pull() {
    return loadClient().then(function () {
      // use the session we already hold — no extra round trip, and no
      // dependency on getSession() re-resolving mid-sync
      if (!state.user) throw new Error('Not signed in.');
      var q = table('trades').select('id, data, updated_at, deleted, deleted_at')
        .order('updated_at', { ascending: false })
        .limit(2000);
      return q;
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      var rows = res.data || [];
      var applied = 0;

      return rows.reduce(function (chain, row) {
        return chain.then(function () {
          var remoteUpdated = new Date(row.updated_at).getTime();
          return db.getTrade(row.id).then(function (local) {
            var localUpdated = local ? (local.updatedAt || local.createdAt || 0) : 0;
            // remote wins only if it is genuinely newer
            if (local && localUpdated >= remoteUpdated) return null;

            if (row.deleted) {
              tombstones[row.id] = new Date(row.deleted_at || row.updated_at).getTime();
              delete dirty[row.id];
              return db.deleteTrade(row.id).then(function () { applied++; });
            }
            var t = row.data || {};
            t.id = row.id;
            t.updatedAt = remoteUpdated;
            t.createdAt = t.createdAt || remoteUpdated;
            return db.putTrade(t).then(function () {
              delete dirty[row.id];
              delete tombstones[row.id];
              applied++;
            });
          });
        });
      }, Promise.resolve()).then(function () {
        return pullShots();
      }).then(function () {
        return pullSettings();
      }).then(function () {
        return applied;
      });
    });
  }

  function pullShots() {
    return table('shots').select('trade_id, path, mime, updated_at, deleted')
      .limit(2000)
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) return 0;
        var client = state.client;
        var bucket = client.storage.from(CFG.shotsBucket);
        var jobs = res.data.map(function (row) {
          if (row.deleted) return Promise.resolve(0);
          return db.getMeta('cloud:shot:' + row.trade_id, null).then(function (known) {
            if (known === row.path) return 0;          // already have this file
            return bucket.download(row.path)
              .then(function (blob) { return db.putShot(row.trade_id, blob); })
              .then(function () { return db.setMeta('cloud:shot:' + row.trade_id, row.path); })
              .then(function () { return 1; })
              .catch(function () { return 0; });        // one missing file must not abort the sync
          });
        });
        // wait for every download to settle before the sync is considered done
        return Promise.all(jobs).then(function (counts) {
          return counts.reduce(function (a, b) { return a + b; }, 0);
        });
      });
  }

  function pullSettings() {
    return table('settings').select('key, value, updated_at').limit(200)
      .then(function (res) {
        if (res.error || !res.data) return;
        res.data.forEach(function (row) {
          if (row.key === 'app:settings') {
            db.getMeta('cloud:settings', null).then(function (known) {
              var remoteTs = new Date(row.updated_at).getTime();
              if (known && known.ts >= remoteTs) return;
              db.setMeta('app:settings', row.value).then(function () {
                db.setMeta('cloud:settings', { ts: remoteTs });
              });
            });
          }
        });
      });
  }

  /** Local → remote. */
  function push() {
    return loadClient().then(function () {
      var ids = Object.keys(dirty);
      var tombs = Object.keys(tombstones);
      if (!ids.length && !tombs.length) return 0;

      var rows = ids.map(function (id) {
        return db.getTrade(id).then(function (t) {
          if (!t) return null;
          return {
            id: t.id,
            user_id: state.user.id,
            data: t,
            updated_at: new Date(t.updatedAt || Date.now()).toISOString(),
            deleted: false,
            deleted_at: null
          };
        });
      });

      return Promise.all(rows).then(function (list) {
        list = list.filter(Boolean);
        var ops = [];
        if (list.length) {
          ops.push(table('trades').upsert(list, { onConflict: 'id' }));
        }
        tombs.forEach(function (id) {
          ops.push(table('trades').upsert({
            id: id,
            user_id: state.user.id,
            data: {},
            updated_at: new Date(tombstones[id]).toISOString(),
            deleted: true,
            deleted_at: new Date(tombstones[id]).toISOString()
          }, { onConflict: 'id' }));
        });
        if (!ops.length) return 0;
        return Promise.all(ops);
      }).then(function (results) {
        results.forEach(function (r) { if (r && r.error) throw new Error(r.error.message); });
        return pushShots().then(function () { return pushSettings(); });
      }).then(function () {
        dirty = {};
        tombstones = {};
        return saveDirtyState();
      });
    });
  }

  function pushShots() {
    return db.allTrades().then(function (trades) {
      var withShots = trades.filter(function (t) { return t.shotId; });
      if (!withShots.length) return;
      var client = state.client;
      var bucket = client.storage.from(CFG.shotsBucket);
      var ops = withShots.map(function (t) {
        return db.getShot(t.shotId).then(function (rec) {
          if (!rec || !rec.blob) return null;
          var path = state.user.id + '/' + t.id + '.jpg';
          return bucket.upload(path, rec.blob, { contentType: rec.blob.type || 'image/jpeg', upsert: true })
            .then(function (r) {
              if (r.error) throw new Error(r.error.message);
              return table('shots').upsert({
                id: t.shotId,
                user_id: state.user.id,
                trade_id: t.id,
                path: path,
                mime: rec.blob.type || 'image/jpeg',
                updated_at: new Date().toISOString(),
                deleted: false
              }, { onConflict: 'id' });
            });
        });
      });
      return Promise.all(ops).then(function (rs) {
        rs.forEach(function (r) { if (r && r.error) throw new Error(r.error.message); });
      });
    });
  }

  function pushSettings() {
    return db.getMeta('app:settings', null).then(function (s) {
      if (!s) return;
      return table('settings').upsert({
        key: 'app:settings',
        user_id: state.user.id,
        value: s,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    }).then(function (r) { if (r && r.error) throw new Error(r.error.message); });
  }

  function syncNow() {
    if (!state.user || !state.configured) return Promise.resolve(0);
    if (state.syncing) return Promise.resolve(0);
    state.syncing = true;
    state.error = null;
    emit();

    return push()
      .then(function () { return pull(); })
      .then(function () {
        state.lastSyncAt = Date.now();
        return db.setMeta(LAST_KEY, state.lastSyncAt);
      })
      .then(function () {
        state.syncing = false;
        state.pending = Object.keys(dirty).length + Object.keys(tombstones).length;
        emit();
        return true;
      })
      .catch(function (e) {
        state.syncing = false;
        state.error = e.message;
        emit();
        throw e;
      });
  }

  /* ─────────────────────────── lifecycle ─────────────────────────── */

  function init(store) {
    db = store || global.VJDB;
    state.configured = isConfigured();
    state.online = navigator.onLine !== false;

    global.addEventListener('online', function () { state.online = true; emit(); });
    global.addEventListener('offline', function () { state.online = false; emit(); });

    if (!state.configured) {
      loadDirtyState();
      return Promise.resolve(status());
    }

    return loadDirtyState()
      .then(function () { return loadClient(); })
      .then(function (client) {
        return client.auth.getSession();
      })
      .then(function (r) {
        state.session = r && r.session;
        state.user = state.session ? state.session.user : null;
        emit();
        if (state.user) return syncNow().catch(function () {});
      })
      .catch(function (e) {
        state.error = e.message;
        emit();
      })
      .then(function () { return status(); });
  }

  function startAutoSync() {
    setInterval(function () {
      if (state.user && navigator.onLine !== false) syncNow().catch(function () {});
    }, CFG.syncInterval || 60000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.user) syncNow().catch(function () {});
    });
  }

  global.VJCloud = {
    state: state,
    status: status,
    init: init,
    startAutoSync: startAutoSync,
    isConfigured: isConfigured,
    signInWithGoogle: signInWithGoogle,
    handleDeepLink: handleDeepLink,
    signOut: signOut,
    currentUser: currentUser,
    onAuthChange: onAuthChange,
    syncNow: syncNow,
    markDirty: markDirty,
    markDeleted: markDeleted,
    loadDirtyState: loadDirtyState
  };
})(window);
