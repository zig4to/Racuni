/* Shramba računov v brskalniku (IndexedDB).
   Zapis: { id, created, blob (JPG), thumb (JPG), w, h, size } */
window.DB = (function () {
  'use strict';

  var NAME = 'racuni-db', VERSION = 1, STORE = 'slike';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('created', 'created');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function add(rec) {
    return tx('readwrite', function (store) { store.put(rec); return rec; });
  }

  function all() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (cur) { out.push(cur.value); cur.continue(); }
          else resolve(out.sort(function (a, b) { return b.id - a.id; }));
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function get(id) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function remove(id) {
    return tx('readwrite', function (store) { store.delete(id); });
  }

  return { add: add, all: all, get: get, remove: remove };
})();
