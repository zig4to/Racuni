/* Integracijski test vmesnika brez brskalnika.
 *
 * Posnema DOM (elementi iz index.html), kamero, IndexedDB in Blob, nato požene
 * pravi js/app.js skozi celoten potek: izbrana fotografija -> zaznava -> premik
 * vogala -> obrez in shranjevanje -> galerija -> pregled -> prenos -> izbris.
 *
 * Zagon:  node test/app.node.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var helpers = require('./helpers');
var ROOT = path.join(__dirname, '..');

var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var htmlIds = (html.match(/id="([a-zA-Z]+)"/g) || []).map(function (s) { return s.slice(4, -1); });

var fails = [];
var passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fails.push(name); console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }

/* Čakanje na pogoj namesto fiksnega spanja — obdelava slike traja različno dolgo. */
async function waitFor(cond, ms) {
  var limit = ms || 3000, t0 = Date.now();
  while (Date.now() - t0 < limit) {
    if (cond()) return true;
    await tick(10);
  }
  return false;
}

// ------------------------------------------------------------------ DOM stub
function makeEl(tag, id) {
  var listeners = {};
  var el = {
    tagName: tag, id: id || '', hidden: false, textContent: '', innerHTML: '',
    className: '', style: {}, dataset: {}, children: [], attrs: {}, files: null,
    value: '', checked: false, src: '', parentNode: null,
    classList: {
      add: function (c) { el.className += ' ' + c; },
      remove: function (c) { el.className = el.className.replace(' ' + c, ''); },
      contains: function (c) { return el.className.indexOf(c) >= 0; }
    },
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: function (t, fn) {
      if (!listeners[t]) return;
      listeners[t] = listeners[t].filter(function (f) { return f !== fn; });
    },
    dispatch: function (t, ev) {
      ev = ev || {};
      ev.type = t;
      if (!ev.target) ev.target = el;
      if (!ev.currentTarget) ev.currentTarget = el;
      ev.preventDefault = ev.preventDefault || function () {};
      (listeners[t] || []).slice().forEach(function (fn) { fn(ev); });
    },
    hasListener: function (t) { return !!(listeners[t] && listeners[t].length); },
    appendChild: function (c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild: function (c) { el.children = el.children.filter(function (x) { return x !== c; }); },
    remove: function () { if (el.parentNode) el.parentNode.removeChild(el); },
    setAttribute: function (k, v) { el.attrs[k] = String(v); },
    getAttribute: function (k) { return el.attrs[k]; },
    removeAttribute: function (k) { delete el.attrs[k]; if (k === 'src') el.src = ''; },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: el._dispW || 300, height: el._dispH || 400 };
    },
    setPointerCapture: function () {},
    click: function () { el.dispatch('click'); },
    querySelectorAll: function () { return []; }
  };
  // innerHTML = '' mora počistiti otroke (uporabljeno v renderGallery)
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html || ''; },
    set: function (v) { el._html = v; if (v === '') el.children = []; }
  });
  return el;
}

var elements = {};
var downloads = [];
var handles = [0, 1, 2, 3].map(function (i) {
  var h = makeEl('div');
  h.dataset.i = String(i);
  h.className = 'handle';
  return h;
});

global.window = global;                       // da so DB/Detect vidni kot globali
// navigator in location v Nodu obstajata samo za branje — povozimo ju
Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
Object.defineProperty(global, 'location', { value: { protocol: 'file:' }, configurable: true, writable: true });
/* window prejema dogodke o namestitvi — Node globalu manjka addEventListener */
var winListeners = {};
global.addEventListener = function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); };
global.removeEventListener = function (t, fn) {
  if (winListeners[t]) winListeners[t] = winListeners[t].filter(function (f) { return f !== fn; });
};
function dispatchWindow(t, ev) {
  ev = ev || {};
  ev.type = t;
  ev.preventDefault = ev.preventDefault || function () { ev.defaultPrevented = true; };
  (winListeners[t] || []).slice().forEach(function (fn) { fn(ev); });
  return ev;
}
global.matchMedia = function () { return { matches: false, addListener: function () {}, removeListener: function () {} }; };
global.alert = function (m) { fails.push('alert: ' + m); console.log('FAIL  nepričakovan alert: ' + m); };
global.confirm = function () { return true; };
global.scrollTo = function () {};
global.File = function (parts, name, opts) { this.name = name; this.type = opts && opts.type; };
global.URL = {
  _live: 0,
  createObjectURL: function () { URL._live++; return 'blob:test-' + URL._live; },
  revokeObjectURL: function () { URL._live--; }
};
global.document = {
  body: makeEl('body'),
  createElement: function (tag) {
    if (tag === 'canvas') return helpers.createCanvas(0, 0);
    var el = makeEl(tag);
    if (tag === 'a') {
      el.click = function () { downloads.push({ href: el.href, name: el.download }); };
    }
    return el;
  },
  getElementById: function (id) {
    if (htmlIds.indexOf(id) < 0) return null;   // ni ga v index.html -> app.js pade
    if (!elements[id]) {
      if (id === 'preview') {
        // <canvas> mora znati oboje: risati in se obnašati kot element
        var c = helpers.createCanvas(0, 0);
        var proto = makeEl('canvas', id);
        Object.keys(proto).forEach(function (k) { if (!(k in c)) c[k] = proto[k]; });
        c.getBoundingClientRect = function () {
          return { left: 0, top: 0, width: c._dispW || 300, height: c._dispH || 400 };
        };
        elements[id] = c;
      } else {
        elements[id] = makeEl('div', id);
      }
    }
    return elements[id];
  },
  querySelectorAll: function (sel) { return sel === '.handle' ? handles : []; },
  addEventListener: function () {}
};

// slika, ki jo "posname kamera"
var GT = [[250, 120], [640, 120], [640, 1080], [250, 1080]];
var photo = helpers.scene({ W: 900, H: 1200, bg: [58, 49, 40], quad: GT });
global.createImageBitmap = function () { return Promise.resolve(photo); };

// ------------------------------------------------------------- IndexedDB stub
var stores = {};
global.indexedDB = {
  open: function (name) {
    var req = {};
    setTimeout(function () {
      var data = stores[name] = stores[name] || {};
      var db = {
        objectStoreNames: { contains: function (s) { return !!data[s]; } },
        createObjectStore: function (s) {
          data[s] = {};
          return { createIndex: function () {} };
        },
        transaction: function (s) {
          var t = {};
          var store = {
            put: function (rec) { data[s][rec.id] = rec; },
            get: function (id) {
              var r = {};
              setTimeout(function () { r.result = data[s][id]; if (r.onsuccess) r.onsuccess(); }, 0);
              return r;
            },
            delete: function (id) { delete data[s][id]; },
            openCursor: function () {
              var r = {};
              setTimeout(function () {
                var keys = Object.keys(data[s]);
                var i = 0;
                function step() {
                  if (i >= keys.length) { r.result = null; if (r.onsuccess) r.onsuccess(); return; }
                  var k = keys[i++];
                  r.result = { value: data[s][k], continue: function () { setTimeout(step, 0); } };
                  if (r.onsuccess) r.onsuccess();
                }
                step();
              }, 0);
              return r;
            }
          };
          t.objectStore = function () { return store; };
          setTimeout(function () { if (t.oncomplete) t.oncomplete(); }, 1);
          return t;
        }
      };
      req.result = db;
      if (!data.slike && req.onupgradeneeded) req.onupgradeneeded();
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
};

// ------------------------------------------------------------- naloži aplikacijo
require('../js/db.js');
require('../js/detect.js');
require('../js/app.js');

var el = elements;
var records = function () { return Object.keys((stores['racuni-db'] || {}).slike || {}); };

function quadPoints() {
  return (el.quad.getAttribute('points') || '').trim().split(' ')
    .map(function (p) { return p.split(',').map(Number); });
}

(async function run() {
  console.log('--- CSS: skrito mora biti skrito ---');
  /* Element z atributom hidden postane spet viden, če ga razredno pravilo v CSS
     postavi na display:flex/grid/... Tak spodrsljaj je pokazal prekrivalo
     "Obdelujem…" takoj ob odprtju strani. */
  var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  var hiddenTags = html.match(/<[^>]*\shidden\s*>/g) || [];
  var guard = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css);
  var risky = [];
  hiddenTags.forEach(function (tag) {
    var classes = (tag.match(/class="([^"]+)"/) || ['', ''])[1].split(/\s+/).filter(Boolean);
    var idm = (tag.match(/id="([^"]+)"/) || [])[1];
    classes.forEach(function (c) {
      var rule = new RegExp('\\.' + c + '\\s*\\{[^}]*display\\s*:\\s*(?!none)', 'g');
      if (rule.test(css)) risky.push((idm || '') + ' (.' + c + ')');
    });
  });
  check('CSS vsili display:none za [hidden]', guard);
  check('noben skrit element ne uhaja iz razrednih pravil', guard || risky.length === 0,
        guard ? '(' + hiddenTags.length + ' skritih elementov, ' + risky.length + ' bi jih brez pravila ušlo)'
              : 'ušli bi: ' + risky.join(', '));

  console.log('\n--- vezava vmesnika ---');
  await tick(20);
  /* Nadomestek getElementById zabeleži samo ID-je, ki v index.html res
     obstajajo, zato je to število hkrati preverba, da se vsi razrešijo.
     Ob dodajanju elementa v app.js je treba popraviti tudi to pričakovanje. */
  check('vsi ID-ji iz app.js obstajajo v index.html', Object.keys(el).length === 51,
        '(' + Object.keys(el).length + '/51)');
  check('gumbi imajo pripete poslušalce',
        el.btnCrop.hasListener('click') && el.btnCancel.hasListener('click') &&
        el.btnRotate.hasListener('click') && el.btnDelete.hasListener('click') &&
        el.inputCamera.hasListener('change'));
  check('prazna galerija prikaže poziv', el.emptyState.hidden === false && records().length === 0);

  console.log('\n--- zajem fotografije ---');
  el.inputCamera.files = [{ name: 'IMG_1.jpg', type: 'image/jpeg' }];
  el.inputCamera.dispatch('change', { target: el.inputCamera });
  await waitFor(function () { return el.viewEdit.hidden === false && el.busy.hidden === true; });

  check('po zajemu se odpre urejanje', el.viewEdit.hidden === false && el.viewGallery.hidden === true);
  check('vrtavka se je skrila', el.busy.hidden === true);
  check('vhod je izpraznjen (ista slika znova)', el.inputCamera.value === '');
  check('namig sporoča uspešno zaznavo', /zaznan/i.test(el.hint.textContent), '"' + el.hint.textContent + '"');

  var q = quadPoints();
  var diag = Math.hypot(900, 1200), err = 0;
  for (var i = 0; i < 4; i++) err += Math.hypot(q[i][0] - GT[i][0], q[i][1] - GT[i][1]) / 4;
  check('okvir se ujema z listom', q.length === 4 && err / diag < 0.03,
        'napaka=' + (err / diag * 100).toFixed(2) + '%');
  check('ročice postavljene na vogale',
        handles.every(function (h) { return h.style.left && h.style.top; }),
        handles[0].style.left + ' / ' + handles[0].style.top);
  check('senčenje okoli izreza narisano', /^M0,0 H900 V1200 H0 Z M/.test(el.shade.getAttribute('d')));

  console.log('\n--- ročni popravek vogala ---');
  el.preview._dispW = 900; el.preview._dispH = 1200;   // prikaz 1:1 za enostavno preverbo
  handles[0].dispatch('pointerdown', { pointerId: 1, currentTarget: handles[0] });
  handles[0].dispatch('pointermove', { clientX: 300, clientY: 200 });
  handles[0].dispatch('pointerup', {});
  var moved = quadPoints()[0];
  check('vlečenje vogala premakne okvir', Math.abs(moved[0] - 300) < 1 && Math.abs(moved[1] - 200) < 1,
        'vogal -> ' + moved);
  handles[0].dispatch('pointerdown', { pointerId: 1, currentTarget: handles[0] });
  handles[0].dispatch('pointermove', { clientX: -500, clientY: -500 });   // izven slike
  handles[0].dispatch('pointerup', {});
  var clamped = quadPoints()[0];
  check('vogal ostane znotraj slike', clamped[0] >= 0 && clamped[1] >= 0, 'vogal -> ' + clamped);

  el.btnReset.dispatch('click');            // ponovna zaznava povrne pravi okvir
  await tick(10);
  var q2 = quadPoints(), err2 = 0;
  for (var j = 0; j < 4; j++) err2 += Math.hypot(q2[j][0] - GT[j][0], q2[j][1] - GT[j][1]) / 4;
  check('ponovna zaznava povrne okvir', err2 / diag < 0.03, 'napaka=' + (err2 / diag * 100).toFixed(2) + '%');

  console.log('\n--- obrez in shranjevanje ---');
  el.enhance.checked = true;
  el.btnCrop.dispatch('click');
  var saved = await waitFor(function () { return records().length === 1 && el.viewGallery.hidden === false; });
  check('shranjevanje se konča brez blokade', saved);

  var ids = records();
  var rec = (stores['racuni-db'].slike || {})[ids[0]];
  check('račun shranjen v IndexedDB', ids.length === 1 && !!rec && rec.size > 0,
        rec ? rec.w + 'x' + rec.h + ', ' + rec.size + 'B' : '');
  check('shranjena sta slika in sličica', !!(rec && rec.blob && rec.thumb && rec.thumb._w <= 320));
  check('vrnitev v galerijo', el.viewGallery.hidden === false && el.viewEdit.hidden === true);
  var drawn = await waitFor(function () { return el.grid.children.length === 1; });
  check('galerija prikaže eno kartico', drawn);
  check('poziv o prazni galeriji skrit', el.emptyState.hidden === true);
  check('števec v glavi je slovnično pravilen', /^1 račun · /.test(el.storageInfo.textContent),
        '"' + el.storageInfo.textContent + '"');

  console.log('\n--- pregled, prenos, izbris ---');
  el.grid.children[0].dispatch('click');
  await tick(20);
  check('pregledovalnik se odpre', el.viewer.hidden === false && /^blob:/.test(el.viewerImg.src));
  check('podatki o računu izpisani', /\d{4}.*·.*×.*·/.test(el.viewerMeta.textContent),
        '"' + el.viewerMeta.textContent + '"');
  check('gumb Deli skrit brez podpore', el.btnShare.hidden === true);

  el.btnDownload.dispatch('click');
  check('prenos sproži shranjevanje JPG',
        downloads.length === 1 && /^racun_\d{4}-\d{2}-\d{2}_\d{6}\.jpg$/.test(downloads[0].name),
        downloads.length ? downloads[0].name : '');

  el.btnDelete.dispatch('click');
  await waitFor(function () { return records().length === 0; });
  var cleared = await waitFor(function () { return el.grid.children.length === 0; });
  check('izbris odstrani zapis in kartico',
        cleared && records().length === 0 && el.viewer.hidden === true);
  check('poziv o prazni galeriji spet viden', el.emptyState.hidden === false);

  console.log('\n--- preklic in vrtenje ---');
  el.inputPicker.files = [{ name: 'IMG_2.jpg', type: 'image/jpeg' }];
  el.inputPicker.dispatch('change', { target: el.inputPicker });
  await waitFor(function () { return el.viewEdit.hidden === false && el.busy.hidden === true; });
  el.btnRotate.dispatch('click');
  await tick(20);
  check('vrtenje ne sesuje zaznave', quadPoints().length === 4 && el.busy.hidden === true);
  el.btnCancel.dispatch('click');
  check('preklic vrne v galerijo brez shranjevanja',
        el.viewGallery.hidden === false && records().length === 0);

  console.log('\n--- namestitev (PWA) ---');
  /* Ni več lastnega gumba za namestitev — app.js ne sme prestreci
     beforeinstallprompt, da Chrome sam ponudi svojo namestitev
     (ikona v naslovni vrstici oz. meni ⋮). */
  var bip = dispatchWindow('beforeinstallprompt', { prompt: function () {} });
  check('poziv za namestitev ni prestrežen — brskalnik ga ponudi sam', bip.defaultPrevented !== true);

  console.log('\n--- osvežitev ---');
  var unregistered = 0, cachesCleared = 0, reloaded = 0;
  global.navigator.serviceWorker = {
    getRegistrations: function () {
      return Promise.resolve([{ unregister: function () { unregistered++; return Promise.resolve(); } }]);
    }
  };
  global.caches = {
    keys: function () { return Promise.resolve(['a', 'b']); },
    delete: function () { cachesCleared++; return Promise.resolve(true); }
  };
  global.location.reload = function () { reloaded++; };
  el.btnRefresh.dispatch('click');
  await tick(20);
  check('gumb Osveži odjavi service worker', unregistered === 1);
  check('gumb Osveži počisti predpomnilnike', cachesCleared === 2);
  check('gumb Osveži nato znova naloži stran', reloaded === 1);

  console.log('\nSKUPAJ: ' + passes + '/' + (passes + fails.length));
  if (fails.length) console.log('NEUSPELI: ' + fails.join('; '));
  process.exit(fails.length ? 1 : 0);
})();
