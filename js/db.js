/* ============================================================================
   VibeJournal — persistence layer (IndexedDB)
   Everything stays on-device. No network calls, ever.
   ========================================================================== */
(function (global) {
  'use strict';

  var DB_NAME = 'vibejournal';
  var DB_VERSION = 1;
  var S_TRADES = 'trades';
  var S_SHOTS = 'shots';
  var S_META = 'meta';

  var _db = null;
  var _opening = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    if (_opening) return _opening;

    _opening = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = e.target.result;

        if (!db.objectStoreNames.contains(S_TRADES)) {
          var t = db.createObjectStore(S_TRADES, { keyPath: 'id' });
          t.createIndex('by_dt', 'dt');
          t.createIndex('by_symbol', 'symbol');
          t.createIndex('by_strategy', 'strategy');
          t.createIndex('by_result', 'result');
          t.createIndex('by_direction', 'direction');
        }
        if (!db.objectStoreNames.contains(S_SHOTS)) {
          db.createObjectStore(S_SHOTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(S_META)) {
          db.createObjectStore(S_META, { keyPath: 'key' });
        }
      };

      req.onsuccess = function () {
        _db = req.result;
        _db.onversionchange = function () { try { _db.close(); } catch (e) {} _db = null; };
        resolve(_db);
      };
      req.onerror = function () { reject(req.error || new Error('Could not open the local database.')); };
      req.onblocked = function () { reject(new Error('Database upgrade blocked by another open tab.')); };
    });

    return _opening;
  }

  function tx(stores, mode) {
    return open().then(function (db) {
      return db.transaction(stores, mode);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function done(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error || new Error('Transaction aborted')); };
    });
  }

  /* ---------------- trades ---------------- */

  function allTrades() {
    return tx([S_TRADES], 'readonly').then(function (t) {
      return wrap(t.objectStore(S_TRADES).getAll());
    }).then(function (rows) {
      rows.sort(function (a, b) { return b.dt - a.dt; });
      return rows;
    });
  }

  function getTrade(id) {
    return tx([S_TRADES], 'readonly').then(function (t) {
      return wrap(t.objectStore(S_TRADES).get(id));
    });
  }

  function putTrade(trade) {
    return tx([S_TRADES], 'readwrite').then(function (t) {
      t.objectStore(S_TRADES).put(trade);
      return done(t);
    }).then(function () { return trade; });
  }

  function deleteTrade(id) {
    return tx([S_TRADES, S_SHOTS], 'readwrite').then(function (t) {
      t.objectStore(S_TRADES).delete(id);
      t.objectStore(S_SHOTS).delete(id);
      return done(t);
    });
  }

  function bulkPutTrades(trades) {
    if (!trades.length) return Promise.resolve();
    return tx([S_TRADES], 'readwrite').then(function (t) {
      var store = t.objectStore(S_TRADES);
      trades.forEach(function (tr) { store.put(tr); });
      return done(t);
    });
  }

  function bulkDeleteTrades(ids) {
    if (!ids.length) return Promise.resolve();
    return tx([S_TRADES, S_SHOTS], 'readwrite').then(function (t) {
      var a = t.objectStore(S_TRADES), b = t.objectStore(S_SHOTS);
      ids.forEach(function (id) { a.delete(id); b.delete(id); });
      return done(t);
    });
  }

  function tradeCount() {
    return tx([S_TRADES], 'readonly').then(function (t) {
      return wrap(t.objectStore(S_TRADES).count());
    });
  }

  /* ---------------- screenshots ---------------- */

  function putShot(id, blob) {
    return tx([S_SHOTS], 'readwrite').then(function (t) {
      t.objectStore(S_SHOTS).put({ id: id, blob: blob, type: blob.type || 'image/png' });
      return done(t);
    });
  }

  function getShot(id) {
    return tx([S_SHOTS], 'readonly').then(function (t) {
      return wrap(t.objectStore(S_SHOTS).get(id));
    });
  }

  function deleteShot(id) {
    return tx([S_SHOTS], 'readwrite').then(function (t) {
      t.objectStore(S_SHOTS).delete(id);
      return done(t);
    });
  }

  function allShots() {
    return tx([S_SHOTS], 'readonly').then(function (t) {
      return wrap(t.objectStore(S_SHOTS).getAll());
    });
  }

  /* ---------------- meta / settings ---------------- */

  function getMeta(key, fallback) {
    return tx([S_META], 'readonly').then(function (t) {
      return wrap(t.objectStore(S_META).get(key));
    }).then(function (row) {
      return row && row.value !== undefined ? row.value : fallback;
    });
  }

  function setMeta(key, value) {
    return tx([S_META], 'readwrite').then(function (t) {
      t.objectStore(S_META).put({ key: key, value: value });
      return done(t);
    }).then(function () { return value; });
  }

  function allMeta() {
    return tx([S_META], 'readonly').then(function (t) {
      return wrap(t.objectStore(S_META).getAll());
    }).then(function (rows) {
      var out = {};
      rows.forEach(function (r) { out[r.key] = r.value; });
      return out;
    });
  }

  /* ---------------- maintenance ---------------- */

  function clearAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var names = [S_TRADES, S_SHOTS, S_META];
        var t = db.transaction(names, 'readwrite');
        names.forEach(function (n) { t.objectStore(n).clear(); });
        done(t).then(resolve, reject);
      });
    });
  }

  function estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return { usage: 0, quota: 0 }; });
    }
    return Promise.resolve({ usage: 0, quota: 0 });
  }

  function requestPersistent() {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persisted().then(function (already) {
        if (already) return true;
        return navigator.storage.persist();
      }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  global.VJDBWeb = {
    open: open,
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
    clearAll: clearAll,
    estimate: estimate,
    requestPersistent: requestPersistent
  };


  /* ==========================================================================
     Facade — pick the backend.
     In the browser that is IndexedDB. Inside the Android app it is SQLite
     (js/native-store.js), which lives in the app's private data directory and
     therefore cannot be evicted by the OS the way WebView storage can.
     Every method below keeps the exact same contract as before.
     ========================================================================== */

  function nativeAvailable() {
    var ns = global.VJNativeStore;
    if (!ns) return false;
    // `available` may be a function or a plain flag — handle both
    return typeof ns.available === 'function' ? !!ns.available() : !!ns.available;
  }

  function pick() {
    return nativeAvailable() ? global.VJNativeStore : global.VJDBWeb;
  }

  function proxy(name) {
    return function () {
      var args = arguments;
      return pick()[name].apply(pick(), args);
    };
  }

  global.VJDB = {
    isNative: nativeAvailable,
    backend: function () { return nativeAvailable() ? 'sqlite' : 'indexeddb'; },
    open: proxy('open'),
    allTrades: proxy('allTrades'),
    getTrade: proxy('getTrade'),
    putTrade: proxy('putTrade'),
    deleteTrade: proxy('deleteTrade'),
    bulkPutTrades: proxy('bulkPutTrades'),
    bulkDeleteTrades: proxy('bulkDeleteTrades'),
    tradeCount: proxy('tradeCount'),
    putShot: proxy('putShot'),
    getShot: proxy('getShot'),
    deleteShot: proxy('deleteShot'),
    allShots: proxy('allShots'),
    getMeta: proxy('getMeta'),
    setMeta: proxy('setMeta'),
    allMeta: proxy('allMeta'),
    clearAll: proxy('clearAll'),
    estimate: function () {
      if (nativeAvailable()) return Promise.resolve({ usage: 0, quota: 0 });
      return global.VJDBWeb.estimate();
    },
    requestPersistent: function () {
      if (nativeAvailable()) return Promise.resolve(true);
      return global.VJDBWeb.requestPersistent();
    }
  };
})(window);
