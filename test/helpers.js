/* Skupni pripomočki za teste brez brskalnika:
   - createCanvas: minimalen nadomestek <canvas> (samo tisto, kar koda res uporablja)
   - scene: sintetična "fotografija" računa z znanimi vogali */
'use strict';

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
    // podpiramo obliko drawImage(src, dx, dy, dw, dh) — pomanjšava s povprečenjem
    drawImage: function (src, dx, dy, dw, dh) {
      var dst = buf();
      var sw = src.width, sh = src.height, sbuf = src._buf;
      dx = dx || 0; dy = dy || 0;
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
    },
    // uporabljeno le pri rotaciji; za teste zadošča zapis brez transformacije
    translate: function () {}, rotate: function () {}, save: function () {}, restore: function () {}
  };

  canvas.getContext = function () { buf(); return ctx; };
  canvas.toBlob = function (cb, type, q) {
    var px = canvas.width * canvas.height;
    setTimeout(function () {
      cb({ size: Math.round(px * (q || 0.9) * 0.35), type: type || 'image/jpeg', _w: canvas.width, _h: canvas.height });
    }, 0);
  };
  return canvas;
}

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

  for (var i = 0; i < W * H; i++) {              // podlaga s šumom
    var n = (Math.random() * 26) | 0;
    buf[i * 4] = cs.bg[0] + n; buf[i * 4 + 1] = cs.bg[1] + n;
    buf[i * 4 + 2] = cs.bg[2] + n; buf[i * 4 + 3] = 255;
  }

  var paper = cs.paper || 245;
  fillQuad(buf, W, H, cs.quad, function (b, i) {  // bel list
    var n = (Math.random() * 8) | 0;
    b[i] = paper + n; b[i + 1] = paper - 2 + n; b[i + 2] = paper - 6 + n;
  });

  var q = cs.quad;                                // temne vrstice besedila
  for (var k = 0; k < 24; k++) {
    var t0 = 0.06 + k * 0.037, t1 = t0 + 0.016;
    if (t1 > 0.97) break;
    var lA = lerp(q[0], q[3], t0), rA = lerp(q[1], q[2], t0);
    var lB = lerp(q[0], q[3], t1), rB = lerp(q[1], q[2], t1);
    var band = [lerp(lA, rA, 0.08), lerp(lA, rA, 0.92), lerp(lB, rB, 0.92), lerp(lB, rB, 0.08)];
    fillQuad(buf, W, H, band, function (b, i) { b[i] = 30; b[i + 1] = 30; b[i + 2] = 32; });
  }

  if (cs.shade) {                                 // neenakomerna osvetlitev
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

module.exports = { createCanvas: createCanvas, scene: scene, fillQuad: fillQuad };
