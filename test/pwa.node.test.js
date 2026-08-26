/* Preveri pogoje, ki jih Chrome zahteva za namestitev spletne aplikacije:
 * manifest s pravimi polji, obstoječe ikone pravih velikosti (192 in 512 px),
 * povezava na manifest v index.html in service worker, ki predpomni vse
 * naštete datoteke.
 *
 * Zagon:  node test/pwa.node.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var fails = [];
var passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fails.push(name); console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

/* Prebere dejansko velikost iz glave PNG (IHDR je vedno prvi kos). */
function pngSize(rel) {
  var buf = fs.readFileSync(path.join(ROOT, rel));
  var sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (var i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (buf.slice(12, 16).toString('ascii') !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

console.log('--- manifest ---');
var manifest = null;
try { manifest = JSON.parse(read('manifest.json')); } catch (e) { /* ujeto spodaj */ }
check('manifest.json je veljaven JSON', !!manifest);
if (!manifest) { console.log('\nSKUPAJ: ' + passes + '/' + (passes + fails.length)); process.exit(1); }

check('ime aplikacije je nastavljeno', !!manifest.name && !!manifest.short_name,
      manifest.short_name);
check('short_name je dovolj kratek za ikono', (manifest.short_name || '').length <= 12,
      (manifest.short_name || '').length + ' znakov');
check('start_url je nastavljen', !!manifest.start_url, manifest.start_url);
check('start_url je znotraj scope',
      String(manifest.start_url).indexOf(String(manifest.scope)) === 0,
      manifest.start_url + ' v ' + manifest.scope);
check('display je standalone ali fullscreen',
      ['standalone', 'fullscreen', 'minimal-ui'].indexOf(manifest.display) >= 0, manifest.display);
check('barvi ozadja in teme sta nastavljeni',
      !!manifest.background_color && !!manifest.theme_color);
check('opis je nastavljen', !!manifest.description);

console.log('\n--- ikone ---');
var icons = manifest.icons || [];
check('manifest našteva ikone', icons.length > 0, icons.length + ' vnosov');

var missing = icons.filter(function (i) { return !exists(i.src); });
check('vse naštete ikone obstajajo', missing.length === 0,
      missing.map(function (i) { return i.src; }).join(', '));

function hasPng(size, purpose) {
  return icons.some(function (i) {
    if (i.type !== 'image/png') return false;
    if ((i.purpose || 'any').split(/\s+/).indexOf(purpose) < 0) return false;
    if (i.sizes !== size + 'x' + size) return false;
    var real = exists(i.src) && pngSize(i.src);
    return !!real && real.w === size && real.h === size;
  });
}

check('PNG 192x192 (purpose any) — Chrome to zahteva', hasPng(192, 'any'));
check('PNG 512x512 (purpose any) — Chrome to zahteva', hasPng(512, 'any'));
check('PNG 512x512 (purpose maskable) za Android', hasPng(512, 'maskable'));

var wrong = icons.filter(function (i) {
  if (i.type !== 'image/png' || !exists(i.src)) return false;
  var real = pngSize(i.src);
  return !real || i.sizes !== real.w + 'x' + real.h;
});
check('navedene velikosti se ujemajo z datotekami', wrong.length === 0,
      wrong.map(function (i) { return i.src + ' je ' + JSON.stringify(pngSize(i.src)); }).join(', '));

console.log('\n--- stran in service worker ---');
var html = read('index.html');
check('index.html se sklicuje na manifest', /<link[^>]+rel="manifest"[^>]+href="manifest\.json"/.test(html));
check('index.html ima meta theme-color', /<meta[^>]+name="theme-color"/.test(html));
check('index.html ima apple-touch-icon', /rel="apple-touch-icon"/.test(html));

var app = read('js/app.js');
check('app.js registrira service worker', /navigator\.serviceWorker\.register\(/.test(app));
/* Ni lastnega gumba za namestitev — app.js ne sme preventDefault-ati
   beforeinstallprompt, sicer bi to bila edina stvar, ki namestitev prepreči. */
check('app.js ne prestreza beforeinstallprompt', !/beforeinstallprompt/.test(app));

check('sw.js obstaja', exists('sw.js'));
var sw = read('sw.js');
check('sw.js ima poslušalca fetch — brez njega ni namestitve',
      /addEventListener\(\s*'fetch'/.test(sw));

var shell = (sw.match(/'\.\/[^']*'/g) || []).map(function (s) { return s.slice(1, -1); });
var shellMissing = shell.filter(function (p) { return p !== './' && !exists(p); });
check('vse datoteke iz predpomnilnika obstajajo', shellMissing.length === 0,
      shellMissing.join(', '));

var iconsInShell = icons.every(function (i) { return shell.indexOf('./' + i.src) >= 0; });
check('ikone so v predpomnilniku za delo brez povezave', iconsInShell);

console.log('\nSKUPAJ: ' + passes + '/' + (passes + fails.length));
if (fails.length) console.log('NEUSPELI: ' + fails.join('; '));
process.exit(fails.length ? 1 : 0);
