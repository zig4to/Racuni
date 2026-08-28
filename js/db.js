/* Shramba v brskalniku (IndexedDB), dve neodvisni shrambi v isti bazi:
   'slike' — { id, created, blob (JPG), thumb (JPG), w, h, size } — računi
   'boni'  — { id, created, trgovina, vrednost, potece, images: [{blob, thumb, w, h, size}, ...] } — darilni boni */
window.DB = (function () {
  'use strict';

  var NAME = 'racuni-db', VERSION = 2, STORE = 'slike', STORE_BONI = 'boni';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        // Vsaka shramba se doda le, če je (na tej napravi) še ni — obstoječih 'slike' ne prizadene.
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('created', 'created');
        }
        if (!db.objectStoreNames.contains(STORE_BONI)) {
          db.createObjectStore(STORE_BONI, { keyPath: 'id' }).createIndex('created', 'created');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function allFrom(store) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var req = db.transaction(store, 'readonly').objectStore(store).openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (cur) { out.push(cur.value); cur.continue(); }
          else resolve(out.sort(function (a, b) { return b.id - a.id; }));
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getFrom(store, id) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(store, 'readonly').objectStore(store).get(id);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function add(rec) {
    return tx(STORE, 'readwrite', function (store) { store.put(rec); return rec; });
  }
  function all() { return allFrom(STORE); }
  function get(id) { return getFrom(STORE, id); }
  function remove(id) {
    return tx(STORE, 'readwrite', function (store) { store.delete(id); });
  }

  function addBon(rec) {
    return tx(STORE_BONI, 'readwrite', function (store) { store.put(rec); return rec; });
  }
  function allBoni() { return allFrom(STORE_BONI); }
  function getBon(id) { return getFrom(STORE_BONI, id); }
  function removeBon(id) {
    return tx(STORE_BONI, 'readwrite', function (store) { store.delete(id); });
  }

  return {
    add: add, all: all, get: get, remove: remove,
    addBon: addBon, allBoni: allBoni, getBon: getBon, removeBon: removeBon
  };
})();
