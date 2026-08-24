/* Zaznava in izrez belega lista (računa) s fotografije.
 *
 * Zaznava: pomanjšava -> maska svetlih in nenasičenih pikslov (Otsu prag) ->
 *          največja povezana komponenta -> zapolnitev lukenj (temno besedilo) ->
 *          konveksna ovojnica -> štirikotnik z največjo ploščino -> 4 vogali.
 * Izrez:   homografija štirikotnik -> pravokotnik + bilinearno vzorčenje,
 *          s čimer se popravi tudi perspektiva (račun ni fotografiran naravnost).
 */
window.Detect = (function () {
  'use strict';

  var ANALYZE_W = 420;   // širina delovne kopije za analizo
  var MAX_OUT = 1500;    // največja stranica izrezane slike
  var HULL_PTS = 26;     // koliko točk ovojnice gre v iskanje štirikotnika

  // ---------------------------------------------------------------- pomožno
  function otsu(hist, total) {
    var sum = 0, i;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = -1, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  }

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // ------------------------------------------------------ maska belega lista
  function buildMask(img, w, h) {
    var d = img.data, n = w * h;
    var luma = new Uint8Array(n), sat = new Float32Array(n);
    var hist = new Uint32Array(256);
    for (var i = 0; i < n; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var y = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
      luma[i] = y; hist[y]++;
      sat[i] = mx ? (mx - mn) / mx : 0;
    }
    var thr = otsu(hist, n);

    function make(t) {
      var m = new Uint8Array(n), c = 0;
      for (var i = 0; i < n; i++) {
        if (luma[i] > t && sat[i] < 0.42) { m[i] = 1; c++; }
      }
      return { mask: m, frac: c / n };
    }

    var res = make(thr);
    // Če je bel del zelo majhen (temna fotografija), prag rahlo spustimo.
    if (res.frac < 0.03) res = make(Math.max(60, thr * 0.75));
    // Če je skoraj vsa slika "bela" (račun na beli mizi), zaznava ni zanesljiva.
    if (res.frac > 0.94) return null;
    return res.mask;
  }

  function morph(mask, w, h, grow) {
    var out = new Uint8Array(mask.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var hit = grow ? 0 : 1;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx, ny = y + dy;
            var v = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? 0 : mask[ny * w + nx];
            if (grow) { if (v) hit = 1; } else if (!v) { hit = 0; }
          }
        }
        out[y * w + x] = hit;
      }
    }
    return out;
  }

  // -------------------------------------------- največja povezana komponenta
  function largestBlob(mask, w, h) {
    var lab = new Int32Array(mask.length).fill(-1);
    var stack = new Int32Array(mask.length);
    var best = -1, bestSize = 0, label = 0;
    for (var s = 0; s < mask.length; s++) {
      if (!mask[s] || lab[s] !== -1) continue;
      var top = 0, size = 0;
      stack[top++] = s; lab[s] = label;
      while (top) {
        var p = stack[--top]; size++;
        var x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && lab[p - 1] === -1) { lab[p - 1] = label; stack[top++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && lab[p + 1] === -1) { lab[p + 1] = label; stack[top++] = p + 1; }
        if (y > 0 && mask[p - w] && lab[p - w] === -1) { lab[p - w] = label; stack[top++] = p - w; }
        if (y < h - 1 && mask[p + w] && lab[p + w] === -1) { lab[p + w] = label; stack[top++] = p + w; }
      }
      if (size > bestSize) { bestSize = size; best = label; }
      label++;
    }
    if (best < 0 || bestSize < mask.length * 0.02) return null;

    var blob = new Uint8Array(mask.length);
    for (var i = 0; i < mask.length; i++) blob[i] = lab[i] === best ? 1 : 0;
    return blob;
  }

  /* Luknje v listu (vrstice besedila, žigi) zapolnimo: kar ni povezano z robom
     slike in ni del lista, spada v list. */
  function fillHoles(blob, w, h) {
    var seen = new Uint8Array(blob.length);
    var stack = [];
    function push(p) { if (!blob[p] && !seen[p]) { seen[p] = 1; stack.push(p); } }
    for (var x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      var p = stack.pop(), px = p % w, py = (p / w) | 0;
      if (px > 0) push(p - 1);
      if (px < w - 1) push(p + 1);
      if (py > 0) push(p - w);
      if (py < h - 1) push(p + w);
    }
    var out = new Uint8Array(blob.length);
    for (var i = 0; i < blob.length; i++) out[i] = (blob[i] || !seen[i]) ? 1 : 0;
    return out;
  }

  // ------------------------------------------------------ konveksna ovojnica
  function boundaryPoints(blob, w, h) {
    var pts = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x;
        if (!blob[p]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
            !blob[p - 1] || !blob[p + 1] || !blob[p - w] || !blob[p + w]) {
          pts.push([x, y]);
        }
      }
    }
    return pts;
  }

  function convexHull(pts) {
    if (pts.length < 4) return pts.slice();
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }
    var lower = [], i;
    for (i = 0; i < p.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop();
      lower.push(p[i]);
    }
    var upper = [];
    for (i = p.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
      upper.push(p[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function sampleHull(hull, max) {
    if (hull.length <= max) return hull;
    var out = [], step = hull.length / max;
    for (var i = 0; i < max; i++) out.push(hull[Math.floor(i * step)]);
    return out;
  }

  function polyArea(q) {
    var a = 0;
    for (var i = 0; i < q.length; i++) {
      var j = (i + 1) % q.length;
      a += q[i][0] * q[j][1] - q[j][0] * q[i][1];
    }
    return Math.abs(a) / 2;
  }

  /* Med točkami ovojnice poiščemo štirikotnik z največjo ploščino — to je
     najboljši približek lista tudi pri perspektivnem popačenju. */
  function biggestQuad(hull) {
    var n = hull.length;
    if (n < 4) return null;
    var best = null, bestA = 0;
    for (var i = 0; i < n - 3; i++) {
      for (var j = i + 1; j < n - 2; j++) {
        for (var k = j + 1; k < n - 1; k++) {
          for (var l = k + 1; l < n; l++) {
            var q = [hull[i], hull[j], hull[k], hull[l]];
            var a = polyArea(q);
            if (a > bestA) { bestA = a; best = q; }
          }
        }
      }
    }
    return best;
  }

  /* Vogali v vrstnem redu: zgoraj-levo, zgoraj-desno, spodaj-desno, spodaj-levo. */
  function orderCorners(q) {
    var cx = 0, cy = 0, i;
    for (i = 0; i < 4; i++) { cx += q[i][0] / 4; cy += q[i][1] / 4; }
    var sorted = q.slice().sort(function (a, b) {
      return Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx);
    });
    var start = 0, bestSum = Infinity;
    for (i = 0; i < 4; i++) {
      var s = sorted[i][0] + sorted[i][1];
      if (s < bestSum) { bestSum = s; start = i; }
    }
    return [sorted[start], sorted[(start + 1) % 4], sorted[(start + 2) % 4], sorted[(start + 3) % 4]];
  }

  /* Verodostojnost najdenega štirikotnika: pravi rob lista se mora po svetlosti
     razlikovati od podlage. Če razlike ni (npr. bel račun na beli mizi), zaznavi
     ne zaupamo in raje prosimo uporabnika, naj vogale nastavi sam. */
  function borderContrast(img, w, h, quad) {
    var d = img.data;
    function luma(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return -1;
      var i = (y * w + x) * 4;
      return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    var cx = 0, cy = 0, i;
    for (i = 0; i < 4; i++) { cx += quad[i][0] / 4; cy += quad[i][1] / 4; }
    var off = Math.max(3, Math.min(w, h) * 0.03);

    var inSum = 0, outSum = 0, n = 0;
    for (i = 0; i < 4; i++) {
      var a = quad[i], b = quad[(i + 1) % 4];
      for (var s = 1; s < 10; s++) {
        var px = a[0] + (b[0] - a[0]) * s / 10;
        var py = a[1] + (b[1] - a[1]) * s / 10;
        var vx = px - cx, vy = py - cy;
        var len = Math.hypot(vx, vy) || 1;
        vx /= len; vy /= len;                        // normala navzven
        var vin = luma(px - vx * off, py - vy * off);
        var vout = luma(px + vx * off, py + vy * off);
        if (vin < 0 || vout < 0) continue;           // vzorec izven slike
        inSum += vin; outSum += vout; n++;
      }
    }
    if (n < 8) return 0;
    return inSum / n - outSum / n;
  }

  function defaultCorners(w, h) {
    var mx = w * 0.08, my = h * 0.08;
    return [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];
  }

  /**
   * Poišče 4 vogale računa na podanem canvasu.
   * @returns {{corners:Array, auto:boolean}} vogali v koordinatah canvasa
   */
  function findCorners(canvas) {
    var w0 = canvas.width, h0 = canvas.height;
    var scale = Math.min(1, ANALYZE_W / w0);
    var w = Math.max(40, Math.round(w0 * scale)), h = Math.max(40, Math.round(h0 * scale));

    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h);

    var img = ctx.getImageData(0, 0, w, h);
    var mask = buildMask(img, w, h);
    if (!mask) return { corners: defaultCorners(w0, h0), auto: false };

    mask = morph(mask, w, h, true);   // zapri drobne vrzeli
    mask = morph(mask, w, h, false);  // odstrani šum

    var blob = largestBlob(mask, w, h);
    if (!blob) return { corners: defaultCorners(w0, h0), auto: false };
    blob = fillHoles(blob, w, h);

    var hull = sampleHull(convexHull(boundaryPoints(blob, w, h)), HULL_PTS);
    var quad = biggestQuad(hull);
    if (!quad) return { corners: defaultCorners(w0, h0), auto: false };

    // Premajhen štirikotnik ni verodostojen — raje ponudimo privzeti okvir.
    var area = polyArea(quad);
    if (area < w * h * 0.05) return { corners: defaultCorners(w0, h0), auto: false };

    /* Če izrez pokrije skoraj celo sliko ali rob lista ni razpoznaven od
       podlage, zaznavi ne zaupamo — uporabnik naj vogale potrdi ročno. */
    var trusted = area < w * h * 0.92 && borderContrast(img, w, h, quad) > 12;
    if (!trusted && area >= w * h * 0.92) {
      return { corners: defaultCorners(w0, h0), auto: false };
    }

    var ordered = orderCorners(quad).map(function (p) {
      return [
        Math.min(w0, Math.max(0, p[0] / scale)),
        Math.min(h0, Math.max(0, p[1] / scale))
      ];
    });
    return { corners: ordered, auto: trusted };
  }

  // ------------------------------------------------ homografija in vzorčenje
  /* Reši H tako, da preslika točke `from` v `to` (8 neznank, Gaussova eliminacija). */
  function homography(from, to) {
    var A = [], i, r, c;
    for (i = 0; i < 4; i++) {
      var x = from[i][0], y = from[i][1], u = to[i][0], v = to[i][1];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
    }
    for (i = 0; i < 8; i++) {
      var piv = i;
      for (r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
      if (Math.abs(A[i][i]) < 1e-10) return null;
      for (r = 0; r < 8; r++) {
        if (r === i) continue;
        var f = A[r][i] / A[i][i];
        for (c = i; c < 9; c++) A[r][c] -= f * A[i][c];
      }
    }
    var h = [];
    for (i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]);
    return h;
  }

  /* Beli list posvetlimo in nevtraliziramo barvni odtenek osvetlitve. */
  function enhance(data, n) {
    var histR = new Uint32Array(256), histG = new Uint32Array(256), histB = new Uint32Array(256);
    var histY = new Uint32Array(256), i;
    for (i = 0; i < n; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      histR[r]++; histG[g]++; histB[b]++;
      histY[(r * 0.299 + g * 0.587 + b * 0.114) | 0]++;
    }
    function pct(hist, p) {
      var target = n * p, acc = 0;
      for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
      return 255;
    }
    var lo = pct(histY, 0.02);
    var hi = [pct(histR, 0.96), pct(histG, 0.96), pct(histB, 0.96)];
    var lut = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    for (var ch = 0; ch < 3; ch++) {
      var span = Math.max(24, hi[ch] - lo);
      for (var v2 = 0; v2 < 256; v2++) {
        var out = (v2 - lo) * 252 / span;
        lut[ch][v2] = out < 0 ? 0 : out > 255 ? 255 : out;
      }
    }
    for (i = 0; i < n; i++) {
      data[i * 4] = lut[0][data[i * 4]];
      data[i * 4 + 1] = lut[1][data[i * 4 + 1]];
      data[i * 4 + 2] = lut[2][data[i * 4 + 2]];
    }
  }

  /**
   * Izreže štirikotnik iz slike in ga poravna v pravokotnik.
   * @param {HTMLCanvasElement} src
   * @param {Array} corners  4 vogali (TL, TR, BR, BL)
   * @param {{enhance:boolean}} opts
   * @returns {HTMLCanvasElement}
   */
  function crop(src, corners, opts) {
    var tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];
    var wOut = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
    var hOut = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
    wOut = Math.max(40, wOut); hOut = Math.max(40, hOut);

    var k = Math.min(1, MAX_OUT / Math.max(wOut, hOut));
    wOut = Math.round(wOut * k); hOut = Math.round(hOut * k);

    var H = homography([[0, 0], [wOut, 0], [wOut, hOut], [0, hOut]], corners); // izhod -> vir
    if (!H) throw new Error('Neveljaven izrez — popravi vogale.');

    var sctx = src.getContext('2d', { willReadFrequently: true });
    var sImg = sctx.getImageData(0, 0, src.width, src.height);
    var s = sImg.data, sw = src.width, sh = src.height;

    var outCanvas = document.createElement('canvas');
    outCanvas.width = wOut; outCanvas.height = hOut;
    var octx = outCanvas.getContext('2d');
    var out = octx.createImageData(wOut, hOut);
    var o = out.data;

    for (var y = 0; y < hOut; y++) {
      for (var x = 0; x < wOut; x++) {
        var den = H[6] * x + H[7] * y + 1;
        var sx = (H[0] * x + H[1] * y + H[2]) / den;
        var sy = (H[3] * x + H[4] * y + H[5]) / den;

        if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1;
        if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;

        var x0 = sx | 0, y0 = sy | 0;
        var x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        var fx = sx - x0, fy = sy - y0;
        var i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
        var i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        var di = (y * wOut + x) * 4;

        for (var ch = 0; ch < 3; ch++) {
          var top = s[i00 + ch] + (s[i10 + ch] - s[i00 + ch]) * fx;
          var bot = s[i01 + ch] + (s[i11 + ch] - s[i01 + ch]) * fx;
          o[di + ch] = top + (bot - top) * fy;
        }
        o[di + 3] = 255;
      }
    }

    if (opts && opts.enhance) enhance(o, wOut * hOut);
    octx.putImageData(out, 0, 0);
    return outCanvas;
  }

  return { findCorners: findCorners, crop: crop, defaultCorners: defaultCorners };
})();
