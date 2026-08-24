/* Test zaznave brez brskalnika: nadomestek canvasa (test/helpers.js) +
   sintetične "fotografije" računa z znanimi vogali.
   Zagon:  node test/detect.node.test.js  */
'use strict';

var helpers = require('./helpers');
var createCanvas = helpers.createCanvas;
var scene = helpers.scene;

global.window = {};
global.document = { createElement: function () { return createCanvas(0, 0); } };
require('../js/detect.js');
var Detect = global.window.Detect;

// ------------------------------------------------------------------ primeri
var cases = [
  { name: 'Naravnost, temna miza', W: 900, H: 1200, bg: [58, 49, 40],
    quad: [[250, 120], [640, 120], [640, 1080], [250, 1080]] },
  { name: 'Zavrten ~10 stopinj', W: 900, H: 1200, bg: [43, 43, 48],
    quad: [[300, 130], [670, 200], [520, 1090], [150, 1020]] },
  { name: 'Perspektiva (od zgoraj)', W: 900, H: 1200, bg: [74, 58, 42],
    quad: [[330, 110], [600, 130], [720, 1060], [180, 1050]] },
  { name: 'Slaba svetloba + senca', W: 900, H: 1200, bg: [32, 36, 44], shade: 0.5, paper: 205,
    quad: [[280, 150], [640, 140], [660, 1050], [260, 1060]] },
  { name: 'Majhen racun sredi slike', W: 900, H: 1200, bg: [51, 44, 38],
    quad: [[420, 300], [700, 320], [690, 900], [400, 880]] },
  { name: 'Vodoravno polozen racun', W: 1200, H: 900, bg: [40, 40, 44],
    quad: [[120, 260], [1080, 220], [1080, 660], [120, 640]] }
];

var pass = 0;
cases.forEach(function (cs) {
  var img = scene(cs);
  var t0 = Date.now();
  var det = Detect.findCorners(img);
  var t1 = Date.now();

  // vogali so lahko zamaknjeni v ciklu (npr. pri ležečem računu) — primerjamo
  // z vsemi štirimi rotacijami zaporedja in vzamemo najboljše ujemanje
  var diag = Math.hypot(cs.W, cs.H), bestErr = Infinity;
  for (var r = 0; r < 4; r++) {
    var e = 0;
    for (var i = 0; i < 4; i++) {
      var d = det.corners[(i + r) % 4], g = cs.quad[i];
      e += Math.hypot(d[0] - g[0], d[1] - g[1]) / 4;
    }
    if (e < bestErr) bestErr = e;
  }
  var rel = bestErr / diag;

  var cropped = Detect.crop(img, det.corners, { enhance: true });
  var t2 = Date.now();
  var cd = cropped.getContext('2d').getImageData(0, 0, cropped.width, cropped.height).data;
  var sum = 0, cnt = 0;
  for (var p = 0; p < cropped.width * cropped.height; p += 5) { sum += cd[p * 4]; cnt++; }
  var luma = sum / cnt;

  var ok = det.auto && rel < 0.03 && luma > 140;
  if (ok) pass++;
  console.log(
    (ok ? 'PASS  ' : 'FAIL  ') + cs.name.padEnd(28) +
    ' auto=' + det.auto +
    '  napaka=' + (rel * 100).toFixed(2) + '%' +
    '  svetlost=' + luma.toFixed(0) +
    '  izhod=' + cropped.width + 'x' + cropped.height +
    '  (zaznava ' + (t1 - t0) + 'ms, izrez ' + (t2 - t1) + 'ms)'
  );
});

// --------------------------------------------------------- robustni primeri
var extra = 0, extraTotal = 3;

// 1) račun na beli mizi: sprejemljivo je oboje — pravilna zaznava ali
//    umik na privzeti okvir, ki ga uporabnik popravi ročno
var wq = [[150, 100], [450, 100], [450, 700], [150, 700]];
var white = scene({ W: 600, H: 800, bg: [238, 238, 236], quad: wq });
var r1 = Detect.findCorners(white);
var e1 = 0;
for (var w1 = 0; w1 < 4; w1++) e1 += Math.hypot(r1.corners[w1][0] - wq[w1][0], r1.corners[w1][1] - wq[w1][1]) / 4;
var rel1 = e1 / Math.hypot(600, 800);
if (r1.corners.length === 4 && (!r1.auto || rel1 < 0.05)) {
  extra++;
  console.log('PASS  Bela podlaga (auto=' + r1.auto + ', napaka=' + (rel1 * 100).toFixed(2) + '%)');
} else {
  console.log('FAIL  Bela podlaga: napacen izrez (auto=' + r1.auto + ', napaka=' + (rel1 * 100).toFixed(2) + '%)');
}

// 2) povsem temna slika brez lista
var dark = createCanvas(400, 400); dark.getContext('2d');
for (var i = 0; i < 400 * 400; i++) { dark._buf[i * 4 + 3] = 255; }
var r2 = Detect.findCorners(dark);
if (r2.corners.length === 4) { extra++; console.log('PASS  Prazna temna slika -> privzeti okvir'); }
else console.log('FAIL  Prazna temna slika');

// 3) izrojeni vogali (vsi v isti tocki) -> razumljiva napaka, ne sesutje
try {
  Detect.crop(dark, [[10, 10], [10, 10], [10, 10], [10, 10]], { enhance: false });
  console.log('FAIL  Izrojeni vogali bi morali javiti napako');
} catch (err) {
  extra++; console.log('PASS  Izrojeni vogali -> "' + err.message + '"');
}

console.log('\nSKUPAJ: ' + (pass + extra) + '/' + (cases.length + extraTotal));
process.exit((pass === cases.length && extra === extraTotal) ? 0 : 1);
