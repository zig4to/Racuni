/* Izriše ikone PNG iz iste risbe kot icon.svg — brez zunanjih odvisnosti.
   Zagon: node tools/make-icons.js
   Chrome za namestitev zahteva rastrski ikoni 192x192 in 512x512. */
var zlib = require('zlib'), fs = require('fs'), path = require('path');

var OUT = path.join(__dirname, '..', 'icons');
var SS = 4;                        // nadvzorčenje za mehke robove

var BG = [0x12, 0x15, 0x1b];
var PAPER = [0xf3, 0xf5, 0xf8];
var GREEN = [0x4a, 0xde, 0x80];
var DARKGREEN = [0x06, 0x28, 0x1a];

/* Risba je v koordinatah SVG viewBox 0..192; njen dejanski obseg je
   x 56..170, y 34..170 (listek + zelen krog) — sredina (113, 102). */
var ART = { cx: 113, cy: 102 };

// --------------------------------------------------------------- geometrija
function insideRoundRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  var cx = Math.min(Math.max(x, r), w - r);
  var cy = Math.min(Math.max(y, r), h - r);
  var dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insidePolygon(x, y, pts) {
  var hit = false;
  for (var i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    var xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function insideCircle(x, y, cx, cy, r) {
  var dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/* Odsek z zaobljenima koncema: razdalja do daljice <= polovica debeline. */
function insideCapsule(x, y, x1, y1, x2, y2, halfW) {
  var vx = x2 - x1, vy = y2 - y1;
  var len2 = vx * vx + vy * vy;
  var t = len2 ? ((x - x1) * vx + (y - y1) * vy) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  var dx = x - (x1 + t * vx), dy = y - (y1 + t * vy);
  return dx * dx + dy * dy <= halfW * halfW;
}

// ------------------------------------------------------------------ risanje
/* Platno RGBA s premnoženo prosojnostjo (nezapolnjeno = prosojno). */
function Bitmap(size) {
  this.size = size;
  this.px = new Uint8Array(size * size * 4);
}

Bitmap.prototype.fill = function (test, color) {
  var n = this.size, p = this.px;
  for (var y = 0; y < n; y++) {
    for (var x = 0; x < n; x++) {
      if (test(x + 0.5, y + 0.5)) {
        var o = (y * n + x) * 4;
        p[o] = color[0]; p[o + 1] = color[1]; p[o + 2] = color[2]; p[o + 3] = 255;
      }
    }
  }
};

/* Povpreči nadvzorčeno sliko na končno velikost in odpravi premnoženje. */
function downsample(big, size) {
  var out = new Uint8Array(size * size * 4), n = big.size, f = n / size, area = f * f;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var r = 0, g = 0, b = 0, a = 0;
      for (var sy = 0; sy < f; sy++) {
        for (var sx = 0; sx < f; sx++) {
          var o = ((y * f + sy) * n + (x * f + sx)) * 4;
          if (big.px[o + 3]) { r += big.px[o]; g += big.px[o + 1]; b += big.px[o + 2]; a += 255; }
        }
      }
      var d = (y * size + x) * 4;
      if (a) {
        out[d] = Math.round(r / (a / 255)); out[d + 1] = Math.round(g / (a / 255));
        out[d + 2] = Math.round(b / (a / 255)); out[d + 3] = Math.round(a / area);
      }
    }
  }
  return out;
}

/* maskable = polno ozadje brez zaobljenih vogalov, risba pomanjšana v varno cono. */
function drawIcon(size, maskable) {
  var n = size * SS, bmp = new Bitmap(n), unit = n / 192;
  var scale = maskable ? 0.82 : 1;
  var ox = maskable ? ART.cx : 96, oy = maskable ? ART.cy : 96;
  function X(u) { return ((u - ox) * scale + 96) * unit; }
  function Y(v) { return ((v - oy) * scale + 96) * unit; }
  var S = scale * unit;                          // za polmere in debeline

  if (maskable) {
    bmp.fill(function () { return true; }, BG);
  } else {
    bmp.fill(function (x, y) { return insideRoundRect(x, y, n, n, 40 * unit); }, BG);
  }

  // listek računa (zobat spodnji rob)
  var src = [56, 34, 136, 34, 136, 146, 123, 137, 110, 146, 96, 137, 83, 146, 69, 137, 56, 146];
  var poly = [];
  for (var i = 0; i < src.length; i += 2) poly.push(X(src[i]), Y(src[i + 1]));
  bmp.fill(function (x, y) { return insidePolygon(x, y, poly); }, PAPER);

  // vrstice besedila
  [[72, 60, 120, 60], [72, 80, 120, 80], [72, 100, 102, 100]].forEach(function (l) {
    bmp.fill(function (x, y) {
      return insideCapsule(x, y, X(l[0]), Y(l[1]), X(l[2]), Y(l[3]), 3.5 * S);
    }, BG);
  });

  // zelen krog s kljukico
  bmp.fill(function (x, y) { return insideCircle(x, y, X(140), Y(140), 30 * S); }, GREEN);
  [[128, 140, 137, 149], [137, 149, 155, 131]].forEach(function (l) {
    bmp.fill(function (x, y) {
      return insideCapsule(x, y, X(l[0]), Y(l[1]), X(l[2]), Y(l[3]), 4 * S);
    }, DARKGREEN);
  });

  return downsample(bmp, size);
}

// ----------------------------------------------------------------- zapis PNG
var CRC = (function () {
  var t = new Int32Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  var head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.slice(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(size, rgba) {
  var stride = size * 4;
  var raw = Buffer.alloc((stride + 1) * size);
  for (var y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;                                   // filter: brez
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bitna globina
  ihdr[9] = 6;    // barvni tip: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --------------------------------------------------------------------- zagon
[
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true }
].forEach(function (spec) {
  var buf = encodePng(spec.size, drawIcon(spec.size, spec.maskable));
  fs.writeFileSync(path.join(OUT, spec.file), buf);
  console.log('  icons/' + spec.file + '  (' + spec.size + 'x' + spec.size + ', ' + Math.round(buf.length / 1024) + ' kB)');
});
