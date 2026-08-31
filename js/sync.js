/* Sinhronizacija računov s Supabase — brez zunanjih knjižnic, samo fetch.
 *
 * IndexedDB ostane glavni vir resnice: aplikacija dela naprej brez povezave in
 * brez prijave, sinhronizacija le zrcali lokalno stanje v oblak in nazaj.
 *
 * Zakaj brez knjižnice supabase-js: ta shrani sejo v localStorage pod ključ
 * sb-<projekt>-auth-token. Koledar (masCajt) teče na istem izvoru
 * zig4to.github.io in bi to sejo pobral — njegove zahteve bi šle kot vloga
 * "authenticated", za katero tabela kv_store nima pravic, in koledar bi se
 * sesul. Z lastnim ključem seje se to ne more zgoditi.
 */
window.Sync = (function () {
  'use strict';

  // ------------------------------------------------------------ nastavitve
  /* Ključ ni skrivnost — objavljen je v tem JS. Podatke varujejo pravila RLS
     v bazi (glej supabase/schema.sql), ne skrivnost ključa. */
  var URL_BASE = 'https://abjnxhfxjolwwxlckkje.supabase.co';
  var API_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiam54aGZ4am9sd3d4bGNra2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODIzODksImV4cCI6MjEwMzI1ODM4OX0.JfVrPZmacEQ4-Hziue2ZDK77foi5IXuNOU0Edayfqa8';   // javni anon ključ projekta ProjektiBaze

  var BUCKET      = 'racuni';
  var BUCKET_BONI = 'boni';
  var SESSION_KEY = 'racuni-seja';        // lasten ključ, ločen od supabase-js
  var TOMB_KEY      = 'racuni-izbrisani';       // ID-ji računov, izbrisani brez povezave
  var TOMB_KEY_BONI = 'racuni-boni-izbrisani';  // isto, za darilne bone

  var session = null;
  var running = false;

  // ------------------------------------------------------------ pripomočki
  function configured() { return !!(URL_BASE && API_KEY); }

  /* kind: 'ok' | 'error' | 'info' (privzeto) — pove poslušalcu, ali sporočilo
     pomeni uspeh, napako ali je zgolj vmesno stanje (npr. "Nalagam…"). */
  function status(text, busy, kind) {
    if (typeof Sync.onStatus === 'function') Sync.onStatus(text, !!busy, kind || 'info');
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (err) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* poln disk */ }
  }

  function tombstones() { return readJson(TOMB_KEY, []); }

  function addTombstone(id) {
    var t = tombstones();
    if (t.indexOf(id) < 0) { t.push(id); writeJson(TOMB_KEY, t); }
  }

  function dropTombstone(id) {
    writeJson(TOMB_KEY, tombstones().filter(function (x) { return x !== id; }));
  }

  function tombstonesBoni() { return readJson(TOMB_KEY_BONI, []); }

  function addTombstoneBoni(id) {
    var t = tombstonesBoni();
    if (t.indexOf(id) < 0) { t.push(id); writeJson(TOMB_KEY_BONI, t); }
  }

  function dropTombstoneBoni(id) {
    writeJson(TOMB_KEY_BONI, tombstonesBoni().filter(function (x) { return x !== id; }));
  }

  /* Zaporedno izvajanje — slike prenašamo drugo za drugo, da telefon ne odpre
     dvajsetih hkratnih zahtev. */
  function series(items, fn) {
    return items.reduce(function (chain, item, i) {
      return chain.then(function () { return fn(item, i); });
    }, Promise.resolve());
  }

  /* Kot series, a zbere rezultate v polje — za prenos dodatnih strani, kjer
     potrebujemo vsako sliko nazaj, ne le da se je zaporedje izvedlo. */
  function seriesCollect(items, fn) {
    var out = [];
    return items.reduce(function (chain, item, i) {
      return chain.then(function () { return fn(item, i); }).then(function (r) { out.push(r); });
    }, Promise.resolve()).then(function () { return out; });
  }

  function dims(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob).then(function (bm) {
        var d = { w: bm.width, h: bm.height };
        if (bm.close) bm.close();
        return d;
      }).catch(function () { return { w: 0, h: 0 }; });
    }
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ w: 0, h: 0 }); };
      img.src = url;
    });
  }

  // ------------------------------------------------------------------- seja
  function normalise(json) {
    var meta = (json.user && json.user.user_metadata) || {};
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
      user_id: json.user && json.user.id,
      email: json.user && json.user.email,
      /* Supabase nima privzetega imena — če ga uporabnik ni nastavil v
         user_metadata (full_name/name), gumb prikaze izpeljano ime iz e-poste. */
      name: meta.full_name || meta.name || null
    };
  }

  function loadSession() { session = readJson(SESSION_KEY, null); return session; }

  function storeSession(s) {
    session = s;
    if (s) writeJson(SESSION_KEY, s);
    else { try { localStorage.removeItem(SESSION_KEY); } catch (err) { /* nic */ } }
  }

  function token(grant, body) {
    return fetch(URL_BASE + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.error_description || json.msg || 'Prijava ni uspela.');
        return normalise(json);
      });
    });
  }

  function signIn(email, password) {
    if (!configured()) {
      return Promise.reject(new Error('Manjkata URL_BASE in API_KEY v js/sync.js.'));
    }
    return token('password', { email: email, password: password }).then(function (s) {
      storeSession(s);
      return s;
    });
  }

  function signOut() {
    storeSession(null);
    status('');
    return Promise.resolve();
  }

  /* Zeton velja eno uro; osvezimo ga minuto prej, da zahteva vmes ne pade. */
  function fresh() {
    if (!session) return Promise.resolve(null);
    if (session.expires_at - 60 > Date.now() / 1000) return Promise.resolve(session);
    return token('refresh_token', { refresh_token: session.refresh_token })
      .then(function (s) { storeSession(s); return s; })
      .catch(function () { storeSession(null); return null; });   // seja je potekla
  }

  // ---------------------------------------------------------------- zahteve
  function headers(extra) {
    var h = { apikey: API_KEY, Authorization: 'Bearer ' + session.access_token };
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    }
    return h;
  }

  function fail(res, kaj) {
    return res.text().then(function (body) {
      throw new Error(kaj + ' (HTTP ' + res.status + ') ' + body.slice(0, 200));
    });
  }

  function rest(path, opts) {
    opts = opts || {};
    return fetch(URL_BASE + '/rest/v1/' + path, {
      method: opts.method || 'GET',
      headers: headers(opts.headers),
      body: opts.body
    });
  }

  /* page: 1, 2, ... za dodatne strani vecstranskega racuna — prva stran (0/
     neveden) ohrani stara imena datotek, da se nic ne spremeni za obstojece
     enostranske racune. */
  function objectPath(id, thumb, page) {
    return session.user_id + '/' + id + (page ? '_p' + page : '') + (thumb ? '_thumb' : '') + '.jpg';
  }

  /* Darilni boni nimajo "prve strani" kot računi — vse slike so enakovredne,
     zato preprost <id>_<indeks>. */
  function bonObjectPath(id, index, thumb) {
    return session.user_id + '/' + id + '_' + index + (thumb ? '_thumb' : '') + '.jpg';
  }

  var MAX_PAGES = 20;       // vec, kot jih bo kdaj imel realen racun — za varno brisanje ob izbrisu
  var MAX_BON_IMAGES = 20;  // isto, za darilne bone

  function upload(bucket, path, blob) {
    return fetch(URL_BASE + '/storage/v1/object/' + bucket + '/' + path, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }),
      body: blob
    }).then(function (res) {
      if (!res.ok) return fail(res, 'Nalaganje slike ni uspelo');
      return path;
    });
  }

  function download(bucket, path) {
    return fetch(URL_BASE + '/storage/v1/object/' + bucket + '/' + path, {
      headers: headers()
    }).then(function (res) {
      if (!res.ok) return fail(res, 'Prenos slike ni uspel');
      return res.blob();
    });
  }

  function removeObjectsIn(bucket, paths) {
    return series(paths, function (p) {
      return fetch(URL_BASE + '/storage/v1/object/' + bucket + '/' + p, {
        method: 'DELETE', headers: headers()
      });
    });
  }

  function removeObjects(id) {
    /* 404 je v redu — datoteke morda nikoli ni bilo. Tombstone ne nosi
       stevila strani, zato poskusimo pobrisati vse mozne strani do
       MAX_PAGES — odvecni klici samo vrnejo 404. */
    var paths = [objectPath(id, false), objectPath(id, true)];
    for (var i = 1; i < MAX_PAGES; i++) {
      paths.push(objectPath(id, false, i), objectPath(id, true, i));
    }
    return removeObjectsIn(BUCKET, paths);
  }

  function removeBonObjects(id) {
    var paths = [];
    for (var i = 0; i < MAX_BON_IMAGES; i++) paths.push(bonObjectPath(id, i, false), bonObjectPath(id, i, true));
    return removeObjectsIn(BUCKET_BONI, paths);
  }

  // -------------------------------------------------------------- prenos gor
  function pushOne(rec) {
    var extra = rec.extraPages || [];
    var uploads = [
      function () { return upload(BUCKET, objectPath(rec.id, false), rec.blob); },
      function () { return upload(BUCKET, objectPath(rec.id, true), rec.thumb); }
    ];
    extra.forEach(function (p, i) {
      uploads.push(function () { return upload(BUCKET, objectPath(rec.id, false, i + 1), p.blob); });
      uploads.push(function () { return upload(BUCKET, objectPath(rec.id, true, i + 1), p.thumb); });
    });

    return series(uploads, function (fn) { return fn(); })
      .then(function () {
        return rest('racuni', {
          method: 'POST',
          /* merge-duplicates: isti klic ustvari zapis ali posodobi obstojecega.
             Potrebno je, ker se trgovina, izdelek, datum in garancija lahko
             popravijo, ko je zapis ze v oblaku. */
          headers: {
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify({
            id: rec.id,
            user_id: session.user_id,
            created: new Date(rec.created).toISOString(),
            w: rec.w, h: rec.h, size: rec.size,
            path: objectPath(rec.id, false),
            thumb_path: objectPath(rec.id, true),
            pages: extra.length + 1,
            trgovina: rec.trgovina || null,
            izdelek: rec.izdelek || null,
            znamka: rec.znamka || null,
            model: rec.model || null,
            kupljeno: rec.kupljeno || null,
            garancija_let: (rec.garancija_let === 0 || rec.garancija_let) ? rec.garancija_let : null
          })
        });
      })
      .then(function (res) {
        if (!res.ok) return fail(res, 'Shranjevanje zapisa ni uspelo');
        rec.synced = 1;
        return DB.add(rec);
      });
  }

  function push(local) {
    var todo = local.filter(function (r) { return !r.synced; });
    if (!todo.length) return Promise.resolve(0);
    return series(todo, function (rec, i) {
      status('Nalagam ' + (i + 1) + '/' + todo.length + '…', true);
      return pushOne(rec);
    }).then(function () { return todo.length; });
  }

  // -------------------------------------------------------------- prenos dol
  function meta(row) {
    return {
      trgovina: row.trgovina || '',
      izdelek: row.izdelek || '',
      znamka: row.znamka || '',
      model: row.model || '',
      kupljeno: row.kupljeno || '',
      garancija_let: (row.garancija_let === null || row.garancija_let === undefined)
        ? '' : Number(row.garancija_let)
    };
  }

  function sameMeta(a, b) {
    return (a.trgovina || '') === (b.trgovina || '') &&
           (a.izdelek || '') === (b.izdelek || '') &&
           (a.znamka || '') === (b.znamka || '') &&
           (a.model || '') === (b.model || '') &&
           (a.kupljeno || '') === (b.kupljeno || '') &&
           String(a.garancija_let === undefined ? '' : a.garancija_let) ===
           String(b.garancija_let === undefined ? '' : b.garancija_let);
  }

  function pull(local) {
    var mine = {}, gone = tombstones();
    local.forEach(function (r) { mine[r.id] = r; });

    return rest('racuni?select=id,w,h,size,path,thumb_path,trgovina,izdelek,znamka,model,' +
                'kupljeno,garancija_let,pages&order=id.desc')
      .then(function (res) {
        if (!res.ok) return fail(res, 'Branje seznama ni uspelo');
        return res.json();
      })
      .then(function (rows) {
        var todo = [], osvezi = [], zunaj = {};
        rows.forEach(function (row) {
          zunaj[row.id] = true;
          if (gone.indexOf(row.id) >= 0) return;          // izbrisan tukaj
          var lokalni = mine[row.id];
          if (!lokalni) { todo.push(row); return; }
          /* Zapis ze imamo. Ce lokalno ni nepotrjenih sprememb in se podatki
             razlikujejo, jih je nekdo popravil na drugi napravi — prevzamemo
             oblak. Ce lokalno ceka na oddajo (synced=0), obvelja lokalno in
             se odda ob prenosu navzgor. */
          if (lokalni.synced && !sameMeta(lokalni, meta(row))) osvezi.push(row);
        });

        /* Ze usklajen zapis, ki ga med oblakovimi vrsticami ni vec — nekdo ga
           je izbrisal drugje (npr. rocno v Supabase). Brez tega bi tak racun
           tu ostal za vedno, saj pull sicer samo dodaja/posodablja. Ce zapis
           se ceka na prvo oddajo (synced=0), ga pustimo pri miru. */
        var izbrisani = local.filter(function (r) { return r.synced && !zunaj[r.id]; });

        if (!todo.length && !osvezi.length && !izbrisani.length) return 0;

        return series(izbrisani, function (r) { return DB.remove(r.id); }).then(function () {
          return series(osvezi, function (row) {
            var rec = mine[row.id], m = meta(row);
            rec.trgovina = m.trgovina;
            rec.izdelek = m.izdelek;
            rec.znamka = m.znamka;
            rec.model = m.model;
            rec.kupljeno = m.kupljeno;
            rec.garancija_let = m.garancija_let;
            return DB.add(rec);
          });
        }).then(function () {
          return series(todo, function (row, i) {
            status('Prenašam ' + (i + 1) + '/' + todo.length + '…', true);
            return Promise.all([download(BUCKET, row.path), download(BUCKET, row.thumb_path)])
              .then(function (blobs) {
                var m = meta(row);
                var rec = {
                  id: row.id, created: row.id,
                  blob: blobs[0], thumb: blobs[1],
                  w: row.w, h: row.h, size: row.size, synced: 1,
                  trgovina: m.trgovina, izdelek: m.izdelek,
                  znamka: m.znamka, model: m.model,
                  kupljeno: m.kupljeno, garancija_let: m.garancija_let
                };
                var n = row.pages || 1;
                if (n <= 1) return rec;
                /* Dodatne strani — dimenzije v tabeli niso zabelezene (samo za
                   prvo stran), zato jih po prenosu ugotovimo iz same slike. */
                var idxs = [];
                for (var k = 1; k < n; k++) idxs.push(k);
                return seriesCollect(idxs, function (pageIdx) {
                  return Promise.all([
                    download(BUCKET, objectPath(row.id, false, pageIdx)),
                    download(BUCKET, objectPath(row.id, true, pageIdx))
                  ]).then(function (pblobs) {
                    return dims(pblobs[0]).then(function (d) {
                      return { blob: pblobs[0], thumb: pblobs[1], w: d.w, h: d.h, size: pblobs[0].size };
                    });
                  });
                }).then(function (extraPages) {
                  rec.extraPages = extraPages;
                  return rec;
                });
              })
              .then(function (rec) { return DB.add(rec); });
          });
        }).then(function () { return todo.length + osvezi.length + izbrisani.length; });
      });
  }

  // ------------------------------------------------------------------ brisi
  /* Izbrise, ki niso uspeli (brez povezave), poskusimo ob naslednji priloznosti.
     Brez tega bi jih naslednji prenos navzdol znova potegnil nazaj. */
  function flushDeletes() {
    var gone = tombstones();
    if (!gone.length) return Promise.resolve();
    return series(gone, function (id) {
      return removeObjects(id)
        .then(function () { return rest('racuni?id=eq.' + id, { method: 'DELETE' }); })
        .then(function (res) { if (res.ok) dropTombstone(id); })
        .catch(function () { /* ostane v seznamu za naslednjic */ });
    });
  }

  // ==================================================== darilni boni: prenos
  /* Ista zgradba kot pri računih (pushOne/push, meta/pull, flushDeletes) — le
     da je rec.images že enoten seznam (brez posebne "prve strani"), zato je
     nalaganje/prenos preprostejši, in da se w/h/size shranijo naravnost v
     stolpec images (jsonb), ne izpeljejo iz prenesene slike. */
  function pushOneBon(rec) {
    var uploads = [];
    rec.images.forEach(function (im, i) {
      uploads.push(function () { return upload(BUCKET_BONI, bonObjectPath(rec.id, i, false), im.blob); });
      uploads.push(function () { return upload(BUCKET_BONI, bonObjectPath(rec.id, i, true), im.thumb); });
    });

    return series(uploads, function (fn) { return fn(); })
      .then(function () {
        return rest('darilni_boni', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify({
            id: rec.id,
            user_id: session.user_id,
            created: new Date(rec.created).toISOString(),
            trgovina: rec.trgovina || null,
            vrednost: (rec.vrednost === 0 || rec.vrednost) ? rec.vrednost : null,
            potece: rec.potece || null,
            images: rec.images.map(function (im) { return { w: im.w, h: im.h, size: im.size }; })
          })
        });
      })
      .then(function (res) {
        if (!res.ok) return fail(res, 'Shranjevanje bona ni uspelo');
        rec.synced = 1;
        return DB.addBon(rec);
      });
  }

  function pushBoni(local) {
    var todo = local.filter(function (r) { return !r.synced; });
    if (!todo.length) return Promise.resolve(0);
    return series(todo, function (rec, i) {
      status('Nalagam bon ' + (i + 1) + '/' + todo.length + '…', true);
      return pushOneBon(rec);
    }).then(function () { return todo.length; });
  }

  function bonMeta(row) {
    return {
      trgovina: row.trgovina || '',
      vrednost: (row.vrednost === null || row.vrednost === undefined) ? '' : Number(row.vrednost),
      potece: row.potece || ''
    };
  }

  function sameBonMeta(a, b) {
    return (a.trgovina || '') === (b.trgovina || '') &&
           String(a.vrednost === undefined ? '' : a.vrednost) === String(b.vrednost === undefined ? '' : b.vrednost) &&
           (a.potece || '') === (b.potece || '');
  }

  function pullBoni(local) {
    var mine = {}, gone = tombstonesBoni();
    local.forEach(function (r) { mine[r.id] = r; });

    return rest('darilni_boni?select=id,trgovina,vrednost,potece,images&order=id.desc')
      .then(function (res) {
        if (!res.ok) return fail(res, 'Branje seznama bonov ni uspelo');
        return res.json();
      })
      .then(function (rows) {
        var todo = [], osvezi = [], zunaj = {};
        rows.forEach(function (row) {
          zunaj[row.id] = true;
          if (gone.indexOf(row.id) >= 0) return;
          var lokalni = mine[row.id];
          if (!lokalni) { todo.push(row); return; }
          if (lokalni.synced && !sameBonMeta(lokalni, bonMeta(row))) osvezi.push(row);
        });

        var izbrisani = local.filter(function (r) { return r.synced && !zunaj[r.id]; });

        if (!todo.length && !osvezi.length && !izbrisani.length) return 0;

        return series(izbrisani, function (r) { return DB.removeBon(r.id); }).then(function () {
          return series(osvezi, function (row) {
            var rec = mine[row.id], m = bonMeta(row);
            rec.trgovina = m.trgovina;
            rec.vrednost = m.vrednost;
            rec.potece = m.potece;
            return DB.addBon(rec);
          });
        }).then(function () {
          return series(todo, function (row, i) {
            status('Prenašam bon ' + (i + 1) + '/' + todo.length + '…', true);
            var imgsMeta = row.images || [];
            return seriesCollect(imgsMeta, function (im, idx) {
              return Promise.all([
                download(BUCKET_BONI, bonObjectPath(row.id, idx, false)),
                download(BUCKET_BONI, bonObjectPath(row.id, idx, true))
              ]).then(function (blobs) {
                return { blob: blobs[0], thumb: blobs[1], w: im.w, h: im.h, size: im.size || blobs[0].size };
              });
            }).then(function (images) {
              var m = bonMeta(row);
              return DB.addBon({
                id: row.id, created: row.id, synced: 1,
                trgovina: m.trgovina, vrednost: m.vrednost, potece: m.potece,
                images: images
              });
            });
          });
        }).then(function () { return todo.length + osvezi.length + izbrisani.length; });
      });
  }

  function flushDeletesBoni() {
    var gone = tombstonesBoni();
    if (!gone.length) return Promise.resolve();
    return series(gone, function (id) {
      return removeBonObjects(id)
        .then(function () { return rest('darilni_boni?id=eq.' + id, { method: 'DELETE' }); })
        .then(function (res) { if (res.ok) dropTombstoneBoni(id); })
        .catch(function () { /* ostane v seznamu za naslednjic */ });
    });
  }

  // ------------------------------------------------------------------ potek
  function syncNow() {
    if (!configured()) { status('Sinhronizacija ni nastavljena.', false, 'error'); return Promise.resolve(); }
    if (!session) { status('Nisi prijavljen.', false, 'error'); return Promise.resolve(); }
    if (running) return Promise.resolve();
    if (navigator.onLine === false) { status('Ni povezave.', false, 'error'); return Promise.resolve(); }

    running = true;
    status('Sinhroniziram…', true);

    return fresh().then(function (s) {
      if (!s) { status('Seja je potekla — prijavi se znova.', false, 'error'); return null; }
      return flushDeletes()
        .then(function () { return flushDeletesBoni(); })
        .then(function () { return DB.all(); })
        .then(function (local) { return pull(local); })
        .then(function (down) {
          return DB.allBoni().then(function (localBoni) { return pullBoni(localBoni); })
            .then(function (downBoni) {
              return DB.all().then(function (after) {
                return push(after).then(function (up) {
                  return DB.allBoni().then(function (afterBoni) {
                    return pushBoni(afterBoni).then(function (upBoni) {
                      return { down: down + downBoni, up: up + upBoni };
                    });
                  });
                });
              });
            });
        })
        .then(function (n) {
          if (n.down || n.up) {
            status('Sinhronizirano (↓' + n.down + ' ↑' + n.up + ').', false, 'ok');
            if (n.down && window.App) App.refreshGallery();
            if (n.down && window.Boni) Boni.refreshGallery();
          } else {
            status('Vse je usklajeno.', false, 'ok');
          }
          return n;
        });
    }).catch(function (err) {
      status('Napaka: ' + (err.message || err), false, 'error');
    }).then(function (n) {
      running = false;
      return n;
    });
  }

  // ---------------------------------------------- kljuke, ki jih klice app.js
  function afterSave() { return syncNow(); }

  function afterDelete(id) {
    addTombstone(id);
    if (!configured() || !session) return Promise.resolve();
    return fresh()
      .then(function (s) { return s ? flushDeletes() : null; })
      .catch(function () { /* poskusimo ob naslednji sinhronizaciji */ });
  }

  // -------------------------------------------- kljuke, ki jih klice boni.js
  function afterSaveBon() { return syncNow(); }

  function afterDeleteBon(id) {
    addTombstoneBoni(id);
    if (!configured() || !session) return Promise.resolve();
    return fresh()
      .then(function (s) { return s ? flushDeletesBoni() : null; })
      .catch(function () { /* poskusimo ob naslednji sinhronizaciji */ });
  }

  loadSession();

  var Sync = {
    signIn: signIn,
    signOut: signOut,
    syncNow: syncNow,
    afterSave: afterSave,
    afterDelete: afterDelete,
    afterSaveBon: afterSaveBon,
    afterDeleteBon: afterDeleteBon,
    session: function () { return session; },
    configured: configured,
    onStatus: null
  };
  return Sync;
})();
