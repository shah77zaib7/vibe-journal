/* ============================================================================
   VibeJournal — native (Capacitor/SQLite) storage backend
   Implements the same contract as the IndexedDB backend in db.js so the rest
   of the app never needs to know where it is running.
   ========================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'vibejournal';
  var TAG = 'VJNativeStore';

  var conn = null;         // SQLiteConnection
  var db = null;           // SQLiteDBConnection
  var ready = null;        // promise
  var failure = null;      // why it failed, if it did

  function isNative() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }

  /**
   * Open the database.
   *
   * This REJECTS on failure. It used to resolve with null, and every method
   * below returned a harmless default when that happened — so a broken
   * plugin looked exactly like a working app that happened to have no
   * trades. That is how the Android app came to store nothing at all.
   * A failure must be loud, so the app can fall back to the browser store
   * and say so.
   */
  function init() {
    if (ready) return ready;
    if (!isNative()) return Promise.reject(new Error('Not running natively.'));

    ready = Promise.resolve()
      .then(function () {
        var bridge = global.VJNative && global.VJNative.sqlitePlugin
          ? global.VJNative.sqlitePlugin()
          : null;
        if (!bridge) throw new Error('The Capacitor SQLite bridge is not available.');
        return global.VJNative.loadSqlite().then(function (mod) {
          return { bridge: bridge, mod: mod };
        });
      })
      .then(function (r) {
        if (!r.mod) throw new Error('The SQLite plugin bundle failed to load.');
        var sqlite = new r.mod.SQLiteConnection(r.bridge);
        // NOTE: there is no init() — neither on the wrapper class nor on the
        // native bridge. The flow starts at checkConnectionsConsistency.
        return sqlite.checkConnectionsConsistency()
          .then(function () { return sqlite.isConnection(DB_NAME, false); })
          .then(function (chk) {
            if (chk && chk.result) return sqlite.retrieveConnection(DB_NAME, false);
            return sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
              .then(function () { return sqlite.retrieveConnection(DB_NAME, false); });
          })
          .then(function (c) {
            conn = c;
            return c.open();
          })
          .then(function () {
            // executeSet, NOT execute: on Android the plugin's execute()
            // takes a single SQL STRING, so passing an array returns null
            // and the plugin dies on statements.replace(...) — a NullPointer
            // Exception that took the whole database down. executeSet takes
            // the {statement, values} shape and works on every platform.
            return conn.executeSet([
              { statement: 'PRAGMA foreign_keys = ON', values: [] },
              { statement: 'CREATE TABLE IF NOT EXISTS trades (' +
                  'id TEXT PRIMARY KEY NOT NULL, dt INTEGER NOT NULL, symbol TEXT, direction TEXT, ' +
                  'entry REAL, sl REAL, tp REAL, lots REAL, riskMode TEXT, risk REAL, riskAmount REAL, ' +
                  'plannedRR REAL, strategy TEXT, result TEXT, pnl REAL, notes TEXT, tags TEXT, ' +
                  'shotId TEXT, createdAt INTEGER, updatedAt INTEGER)', values: [] },
              { statement: 'CREATE INDEX IF NOT EXISTS idx_trades_dt ON trades(dt)', values: [] },
              { statement: 'CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)', values: [] },
              { statement: 'CREATE TABLE IF NOT EXISTS shots (id TEXT PRIMARY KEY NOT NULL, data TEXT, type TEXT)', values: [] },
              { statement: 'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT)', values: [] }
            ]);
          })
          .then(function () { return conn; });
      })
      .catch(function (e) {
        failure = e;
        ready = null;                 // allow one retry later
        if (global.console) console.error(TAG, 'init failed —', e);
        throw e;
      });

    return ready;
  }

  function toB64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function fromB64(b64, type) {
    var bin = atob(b64 || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'image/jpeg' });
  }


  function rowToTrade(r) {
    if (!r) return null;
    var t = {};
    for (var k in r) {
      if (Object.prototype.hasOwnProperty.call(r, k)) t[k] = r[k];
    }
    t.dt = Number(t.dt);
    t.entry = t.entry == null ? null : Number(t.entry);
    t.sl = t.sl == null ? null : Number(t.sl);
    t.tp = t.tp == null ? null : Number(t.tp);
    t.lots = t.lots == null ? null : Number(t.lots);
    t.risk = t.risk == null ? null : Number(t.risk);
    t.riskAmount = t.riskAmount == null ? null : Number(t.riskAmount);
    t.plannedRR = t.plannedRR == null ? null : Number(t.plannedRR);
    t.pnl = t.pnl == null ? null : Number(t.pnl);
    t.createdAt = t.createdAt == null ? null : Number(t.createdAt);
    t.updatedAt = t.updatedAt == null ? null : Number(t.updatedAt);
    try { t.tags = t.tags ? JSON.parse(t.tags) : []; } catch (e) { t.tags = []; }
    return t;
  }

  function tradeToParams(t) {
    return [
      t.id, t.dt, t.symbol || null, t.direction || null,
      t.entry == null ? null : t.entry, t.sl == null ? null : t.sl, t.tp == null ? null : t.tp,
      t.lots == null ? null : t.lots, t.riskMode || null,
      t.risk == null ? null : t.risk, t.riskAmount == null ? null : t.riskAmount,
      t.plannedRR == null ? null : t.plannedRR,
      t.strategy || null, t.result || null, t.pnl == null ? null : t.pnl,
      t.notes || null, JSON.stringify(t.tags || []), t.shotId || null,
      t.createdAt || null, t.updatedAt || null
    ];
  }

  var COLS = ['id', 'dt', 'symbol', 'direction', 'entry', 'sl', 'tp', 'lots', 'riskMode', 'risk',
              'riskAmount', 'plannedRR', 'strategy', 'result', 'pnl', 'notes', 'tags', 'shotId',
              'createdAt', 'updatedAt'];

  function placeholders(n) { return new Array(n).fill('?').join(','); }

  /* ---------------- API ---------------- */

  function allTrades() {
    return init().then(function (c) {
      if (!c) return [];
      return c.query('SELECT * FROM trades ORDER BY dt DESC').then(function (res) {
        return (res.values || []).map(rowToTrade);
      });
    });
  }

  function getTrade(id) {
    return init().then(function (c) {
      if (!c) return null;
      return c.query('SELECT * FROM trades WHERE id = ?', [id]).then(function (res) {
        return res.values && res.values.length ? rowToTrade(res.values[0]) : null;
      });
    });
  }

  function putTrade(t) {
    return init().then(function (c) {
      if (!c) return t;
      var sql = 'INSERT OR REPLACE INTO trades (' + COLS.join(',') + ') VALUES (' + placeholders(COLS.length) + ')';
      return c.run(sql, tradeToParams(t)).then(function () { return t; });
    });
  }

  function deleteTrade(id) {
    return init().then(function (c) {
      if (!c) return;
      return c.run('DELETE FROM trades WHERE id = ?', [id])
        .then(function () { return c.run('DELETE FROM shots WHERE id = ?', [id]); });
    });
  }

  function bulkPutTrades(list) {
    return init().then(function (c) {
      if (!c || !list.length) return;
      var stmts = list.map(function (t) {
        return {
          statement: 'INSERT OR REPLACE INTO trades (' + COLS.join(',') + ') VALUES (' + placeholders(COLS.length) + ')',
          values: tradeToParams(t)
        };
      });
      return c.executeSet(stmts);
    });
  }

  function bulkDeleteTrades(ids) {
    return init().then(function (c) {
      if (!c || !ids.length) return;
      return c.executeSet(ids.map(function (id) {
        return { statement: 'DELETE FROM trades WHERE id = ?', values: [id] };
      }));
    });
  }

  function tradeCount() {
    return init().then(function (c) {
      if (!c) return 0;
      return c.query('SELECT COUNT(*) AS n FROM trades').then(function (res) {
        return res.values && res.values.length ? Number(res.values[0].n) : 0;
      });
    });
  }

  function putShot(id, blob) {
    return init().then(function (c) {
      if (!c) return;
      return toB64(blob).then(function (b64) {
        return c.run('INSERT OR REPLACE INTO shots (id, data, type) VALUES (?,?,?)',
          [id, b64, blob.type || 'image/jpeg']);
      });
    });
  }

  function getShot(id) {
    return init().then(function (c) {
      if (!c) return null;
      return c.query('SELECT * FROM shots WHERE id = ?', [id]).then(function (res) {
        if (!res.values || !res.values.length) return null;
        var r = res.values[0];
        return { id: r.id, blob: fromB64(r.data, r.type) };
      });
    });
  }

  function deleteShot(id) {
    return init().then(function (c) {
      if (!c) return;
      return c.run('DELETE FROM shots WHERE id = ?', [id]);
    });
  }

  function allShots() {
    return init().then(function (c) {
      if (!c) return [];
      return c.query('SELECT * FROM shots').then(function (res) {
        return (res.values || []).map(function (r) {
          return { id: r.id, blob: fromB64(r.data, r.type) };
        });
      });
    });
  }

  function getMeta(key, fallback) {
    return init().then(function (c) {
      if (!c) return fallback;
      return c.query('SELECT value FROM meta WHERE key = ?', [key]).then(function (res) {
        if (!res.values || !res.values.length) return fallback;
        var v = res.values[0].value;
        try { return JSON.parse(v); } catch (e) { return v; }
      });
    });
  }

  function setMeta(key, value) {
    return init().then(function (c) {
      if (!c) return value;
      return c.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)',
        [key, JSON.stringify(value === undefined ? null : value)]).then(function () { return value; });
    });
  }

  function allMeta() {
    return init().then(function (c) {
      if (!c) return {};
      return c.query('SELECT key, value FROM meta').then(function (res) {
        var out = {};
        (res.values || []).forEach(function (r) {
          try { out[r.key] = JSON.parse(r.value); } catch (e) { out[r.key] = r.value; }
        });
        return out;
      });
    });
  }

  function clearAll() {
    return init().then(function (c) {
      if (!c) return;
      return c.executeSet([
        { statement: 'DELETE FROM trades', values: [] },
        { statement: 'DELETE FROM shots', values: [] },
        { statement: 'DELETE FROM meta', values: [] }
      ]);
    });
  }

  global.VJNativeStore = {
    // a function, not a value — the bridge may not be present at parse time
    available: isNative,
    isAvailable: isNative,
    init: init,
    // the reason the native store could not open, if it could not
    failure: function () { return failure; },
    allTrades: allTrades,
    getTrade: getTrade,
    putTrade: putTrade,
    deleteTrade: deleteTrade,
    bulkPutTrades: bulkPutTrades,
    bulkDeleteTrades: bulkDeleteTrades,
    tradeCount: tradeCount,
    putShot: putShot,
    getShot: getShot,
    deleteShot: deleteShot,
    allShots: allShots,
    getMeta: getMeta,
    setMeta: setMeta,
    allMeta: allMeta,
    clearAll: clearAll
  };
})(window);
