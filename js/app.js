/* Vezava vmesnika: zajem slike -> zaznava vogalov -> ročni popravek ->
   izrez v JPG -> shramba v IndexedDB -> galerija, prenos, deljenje. */
(function () {
  'use strict';

  var MAX_WORK = 2200;   // največja stranica delovne slike (poraba pomnilnika)
  var JPEG_Q = 0.92;
  var THUMB_W = 320;

  var el = {};
  ['inputCamera', 'inputPicker', 'viewGallery', 'viewEdit', 'grid', 'emptyState',
   'preview', 'overlay', 'shade', 'quad', 'stage', 'hint', 'enhance', 'btnRotate',
   'btnReset', 'btnCancel', 'btnCrop', 'viewer', 'viewerImg', 'viewerMeta', 'btnClose',
   'btnDownload', 'btnShare', 'btnDelete', 'busy', 'busyText', 'storageInfo'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var handles = Array.prototype.slice.call(document.querySelectorAll('.handle'));

  var state = {
    work: null,       // canvas z izvorno (pomanjšano) fotografijo
    corners: null,    // 4 vogali v koordinatah work canvasa
    current: null,    // odprt zapis v pregledovalniku
    objectUrl: null
  };

  // ------------------------------------------------------------- pripomočki
  function busy(on, text) {
    el.busyText.textContent = text || 'Obdelujem…';
    el.busy.hidden = !on;
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtSize(bytes) {
    return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB'
                           : Math.round(bytes / 1024) + ' kB';
  }

  function fileName(ts) {
    var d = new Date(ts);
    function p(n) { return String(n).padStart(2, '0'); }
    return 'racun_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.jpg';
  }

  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        b ? resolve(b) : reject(new Error('Slike ni bilo mogoče pretvoriti v JPG.'));
      }, 'image/jpeg', quality);
    });
  }

  // ---------------------------------------------------------- nalaganje slike
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return decodeViaImg(file); });
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Slike ni bilo mogoče odpreti.')); };
      img.src = url;
    });
  }

  function toWorkCanvas(source) {
    var w = source.width, h = source.height;
    var k = Math.min(1, MAX_WORK / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    if (source.close) source.close();
    return c;
  }

  function handleFile(file) {
    if (!file) return;
    busy(true, 'Iščem račun na sliki…');
    // Odlog, da se vrtavka izriše, preden se zažene težka obdelava.
    setTimeout(function () {
      decode(file).then(function (src) {
        state.work = toWorkCanvas(src);
        runDetection();
        showEdit();
      }).catch(function (err) {
        alert(err.message || 'Napaka pri branju slike.');
      }).then(function () { busy(false); });
    }, 30);
  }

  function runDetection() {
    var res = Detect.findCorners(state.work);
    state.corners = res.corners;
    el.hint.textContent = res.auto
      ? 'Račun zaznan. Povleci vogale, če izrez ni točen.'
      : 'Računa nisem zanesljivo prepoznal — nastavi vogale ročno.';
    drawPreview();
  }

  // --------------------------------------------------------------- urejanje
  function drawPreview() {
    var c = el.preview, w = state.work.width, h = state.work.height;
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(state.work, 0, 0);
    el.overlay.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    updateOverlay();
  }

  function updateOverlay() {
    var w = state.work.width, h = state.work.height, q = state.corners;
    var poly = q.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    el.quad.setAttribute('points', poly);
    el.shade.setAttribute('d',
      'M0,0 H' + w + ' V' + h + ' H0 Z ' +
      'M' + q.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L') + ' Z');

    handles.forEach(function (hEl, i) {
      hEl.style.left = (q[i][0] / w * 100) + '%';
      hEl.style.top = (q[i][1] / h * 100) + '%';
    });
  }

  function startDrag(e) {
    var hEl = e.currentTarget, i = +hEl.dataset.i;
    hEl.setPointerCapture(e.pointerId);
    hEl.classList.add('dragging');

    function move(ev) {
      var r = el.preview.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width * state.work.width;
      var y = (ev.clientY - r.top) / r.height * state.work.height;
      state.corners[i] = [
        Math.max(0, Math.min(state.work.width, x)),
        Math.max(0, Math.min(state.work.height, y))
      ];
      updateOverlay();
    }
    function end() {
      hEl.classList.remove('dragging');
      hEl.removeEventListener('pointermove', move);
      hEl.removeEventListener('pointerup', end);
      hEl.removeEventListener('pointercancel', end);
    }
    hEl.addEventListener('pointermove', move);
    hEl.addEventListener('pointerup', end);
    hEl.addEventListener('pointercancel', end);
    e.preventDefault();
  }
  handles.forEach(function (h) { h.addEventListener('pointerdown', startDrag); });

  function rotate90() {
    var src = state.work;
    var c = document.createElement('canvas');
    c.width = src.height; c.height = src.width;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);
    state.work = c;
    runDetection();
  }

  function cropAndSave() {
    busy(true, 'Obrezujem in shranjujem…');
    setTimeout(function () {
      var canvas;
      try {
        canvas = Detect.crop(state.work, state.corners, { enhance: el.enhance.checked });
      } catch (err) {
        busy(false);
        alert(err.message);
        return;
      }

      var thumb = document.createElement('canvas');
      var tk = Math.min(1, THUMB_W / canvas.width);
      thumb.width = Math.round(canvas.width * tk);
      thumb.height = Math.round(canvas.height * tk);
      thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);

      Promise.all([canvasToBlob(canvas, JPEG_Q), canvasToBlob(thumb, 0.75)])
        .then(function (blobs) {
          var id = Date.now();
          return DB.add({
            id: id, created: id, blob: blobs[0], thumb: blobs[1],
            w: canvas.width, h: canvas.height, size: blobs[0].size
          });
        })
        .then(function () {
          state.work = null; state.corners = null;
          showGallery();
          return renderGallery();
        })
        .catch(function (err) {
          alert('Shranjevanje ni uspelo: ' + (err.message || err));
        })
        .then(function () { busy(false); });
    }, 30);
  }

  // --------------------------------------------------------------- galerija
  function renderGallery() {
    return DB.all().then(function (items) {
      el.grid.innerHTML = '';
      el.emptyState.hidden = items.length > 0;

      items.forEach(function (rec) {
        var card = document.createElement('div');
        card.className = 'card';

        var img = document.createElement('img');
        img.src = URL.createObjectURL(rec.thumb);
        img.alt = 'Račun ' + fmtDate(rec.created);
        img.loading = 'lazy';
        img.onload = function () { URL.revokeObjectURL(img.src); };

        var date = document.createElement('div');
        date.className = 'date';
        date.textContent = fmtDate(rec.created);

        card.appendChild(img);
        card.appendChild(date);
        card.addEventListener('click', function () { openViewer(rec.id); });
        el.grid.appendChild(card);
      });

      updateStorageInfo(items);
    });
  }

  function updateStorageInfo(items) {
    var total = items.reduce(function (s, r) { return s + (r.size || 0); }, 0);
    el.storageInfo.textContent = items.length
      ? items.length + ' računov · ' + fmtSize(total)
      : '';
  }

  // ---------------------------------------------------------- pregledovalnik
  function openViewer(id) {
    DB.get(id).then(function (rec) {
      if (!rec) return;
      state.current = rec;
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = URL.createObjectURL(rec.blob);
      el.viewerImg.src = state.objectUrl;
      el.viewerMeta.textContent = fmtDate(rec.created) + ' · ' + rec.w + '×' + rec.h + ' · ' + fmtSize(rec.size);
      el.btnShare.hidden = !(navigator.canShare && navigator.canShare({
        files: [new File([rec.blob], 'test.jpg', { type: 'image/jpeg' })]
      }));
      el.viewer.hidden = false;
    });
  }

  function closeViewer() {
    el.viewer.hidden = true;
    el.viewerImg.removeAttribute('src');
    if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
    state.current = null;
  }

  function download() {
    if (!state.current) return;
    var url = URL.createObjectURL(state.current.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName(state.current.created);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function share() {
    if (!state.current) return;
    var file = new File([state.current.blob], fileName(state.current.created), { type: 'image/jpeg' });
    navigator.share({ files: [file], title: 'Račun' }).catch(function () { /* preklic */ });
  }

  function removeCurrent() {
    if (!state.current) return;
    if (!confirm('Izbrišem ta račun?')) return;
    var id = state.current.id;
    closeViewer();
    DB.remove(id).then(renderGallery);
  }

  // ------------------------------------------------------------- preklop pogledov
  function showEdit() {
    el.viewGallery.hidden = true;
    el.viewEdit.hidden = false;
    window.scrollTo(0, 0);
  }

  function showGallery() {
    el.viewEdit.hidden = true;
    el.viewGallery.hidden = false;
  }

  // ---------------------------------------------------------------- dogodki
  function onPick(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';   // isto sliko je mogoče izbrati znova
    handleFile(f);
  }

  el.inputCamera.addEventListener('change', onPick);
  el.inputPicker.addEventListener('change', onPick);
  el.btnRotate.addEventListener('click', rotate90);
  el.btnReset.addEventListener('click', runDetection);
  el.btnCrop.addEventListener('click', cropAndSave);
  el.btnCancel.addEventListener('click', function () {
    state.work = null; state.corners = null;
    showGallery();
  });
  el.btnClose.addEventListener('click', closeViewer);
  el.btnDownload.addEventListener('click', download);
  el.btnShare.addEventListener('click', share);
  el.btnDelete.addEventListener('click', removeCurrent);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.viewer.hidden) closeViewer();
  });

  renderGallery();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* neobvezno */ });
  }
})();
