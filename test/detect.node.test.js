/* Test zaznave brez brskalnika: minimalen nadomestek canvasa (samo tisto, kar
   detect.js res uporablja) + sintetične "fotografije" računa z znanimi vogali.
   Zagon:  node test/detect.node.test.js  */
'use strict';

// ----------------------------------------------------------- canvas nadomestek
function createCanvas(w, h) {
  var canvas = { width: w || 0, height: h || 0, _buf: null, _bw: 0, _bh: 0 };

  function buf() {
    if (!canvas._buf || canvas._bw !== canvas.width || canvas._bh !== canvas.height) {
      canvas._buf = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      canvas._bw = canvas.width; canvas._bh = canvas.height;
    }
    return canvas._buf;
  }

  var ctx = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    getImageData: function (x, y, w, h) {
      var src = buf(), out = new Uint8ClampedArray(w * h * 4);
      for (var j = 0; j < h; j++) {
        var s = ((y + j) * canvas.width + x) * 4;
        out.set(src.subarray(s, s + w * 4), j * w * 4);
      }
      return { width: w, height: h, data: out };
    },
    createImageData: function (w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData: function (img, x, y) {
      var dst = buf();
      for (var j = 0; j < img.height; j++) {
        var d = ((y + j) * canvas.width + x) * 4;
        dst.set(img.data.subarray(j * img.width * 4, (j + 1) * img.width * 4), d);
      }
    },
    // podpiramo le obliko drawImage(src, 0, 0, w, h) — pomanjšava s povprečenjem
    drawImage: function (src, dx, dy, dw, dh) {
      var dst = buf();
      var sw = src.width, sh = src.height, sbuf = src._buf;
      dw = dw || sw; dh = dh || sh;
      var kx = sw / dw, ky = sh / dh;
      for (var y = 0; y < dh; y++) {
        var y0 = Math.floor(y * ky), y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((y + 1) * ky)));
        for (var x = 0; x < dw; x++) {
          var x0 = Math.floor(x * kx), x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * kx)));
          var r = 0, g = 0, b = 0, n = 0;
          for (var sy = y0; sy < y1; sy++) {
            for (var sx = x0; sx < x1; sx++) {
              var i = (sy * sw + sx) * 4;
              r += sbuf[i]; g += sbuf[i + 1]; b += sbuf[i + 2]; n++;
            }
          }
          var d = ((dy + y) * canvas.width + (dx + x)) * 4;
          dst[d] = r / n; dst[d + 1] = g / n; dst[d + 2] = b / n; dst[d + 3] = 255;
        }
      }
    }
  };

  canvas.getContext = function () { buf(); return ctx; };
  return canvas;
}

global.window = {};
global.document = { createElement: function () { return createCanvas(0, 0); } };
require('../js/detect.js');
var Detect = global.window.Detect;

// ------------------------------------------------------------ sintetične slike
function fillQuad(buf, W, H, quad, fn) {
  var minY = Math.max(0, Math.floor(Math.min.apply(null, quad.map(function (p) { return p[1]; }))));
  var maxY = Math.min(H - 1, Math.ceil(Math.max.apply(null, quad.map(function (p) { return p[1]; }))));
  for (var y = minY; y <= maxY; y++) {
    var xs = [];
    for (var i = 0; i < 4; i++) {
      var a = quad[i], b = quad[(i + 1) % 4];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort(function (p, q) { return p - q; });
    var x0 = Math.max(0, Math.round(xs[0])), x1 = Math.min(W - 1, Math.round(xs[xs.length - 1]));
    for (var x = x0; x <= x1; x++) fn(buf, (y * W + x) * 4, x, y);
  }
}

function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

function scene(cs) {
  var W = cs.W, H = cs.H;
  var c = createCanvas(W, H);
  c.getContext('2d');
  var buf = c._buf;

  // podlaga s šumom
  for (var i = 0; i < W * H; i++) {
    var n = (Math.random() * 26) | 0;
    buf[i * 4] = cs.bg[0] + n; buf[i * 4 + 1] = cs.bg[1] + n;
    buf[i * 4 + 2] = cs.bg[2] + n; buf[i * 4 + 3] = 255;
  }

  // bel list
  var paper = cs.paper || 245;
  fillQuad(buf, W, H, cs.quad, function (b, i) {
    var n = (Math.random() * 8) | 0;
    b[i] = paper + n; b[i + 1] = paper - 2 + n; b[i + 2] = paper - 6 + n;
  });

  // temne vrstice besedila (preizkus zapolnjevanja lukenj v maski)
  var q = cs.quad;
  for (var k = 0; k < 24; k++) {
    var t0 = 0.06 + k * 0.037, t1 = t0 + 0.016;
    if (t1 > 0.97) break;
    var lA = lerp(q[0], q[3], t0), rA = lerp(q[1], q[2], t0);
    var lB = lerp(q[0], q[3], t1), rB = lerp(q[1], q[2], t1);
    var band = [lerp(lA, rA, 0.08), lerp(lA, rA, 0.92), lerp(lB, rB, 0.92), lerp(lB, rB, 0.08)];
    fillQuad(buf, W, H, band, function (b, i) { b[i] = 30; b[i + 1] = 30; b[i + 2] = 32; });
  }

  // neenakomerna osvetlitev
  if (cs.shade) {
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var f = 1 - cs.shade * ((x / W) * 0.5 + (y / H) * 0.5);
        var j = (y * W + x) * 4;
        buf[j] *= f; buf[j + 1] *= f; buf[j + 2] *= f;
      }
    }
  }
  return c;
}

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
