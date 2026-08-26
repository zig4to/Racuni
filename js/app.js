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
   'btnDownload', 'btnShare', 'btnDelete', 'busy', 'busyText', 'storageInfo', 'btnInstall',
   'formNew', 'fTrgovina', 'fIzdelek', 'fZnamka', 'fModel', 'fDatum', 'fGarancija', 'btnFormNext',
   'btnFormCancel', 'captureRow', 'btnCamera', 'btnPicker', 'searchInput', 'searchEmpty',
   'vTrgovina', 'vIzdelek', 'vZnamka', 'vModel', 'vDatum', 'vGarancija', 'btnSaveMeta', 'viewerWarranty'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var handles = Array.prototype.slice.call(document.querySelectorAll('.handle'));

  var state = {
    work: null,       // canvas z izvorno (pomanjšano) fotografijo
    corners: null,    // 4 vogali v koordinatah work canvasa
    current: null,    // odprt zapis v pregledovalniku
    objectUrl: null,
    meta: null,       // podatki iz obrazca (trgovina, izdelek, datum nakupa, garancija) — baza sledi kasneje
    pendingAction: null   // 'camera' ali 'picker' — kateri zajem je obrazec odprl
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

  // ------------------------------------------------------- podatki o nakupu
  /* Podatke o nakupu vpišeš pred zajemom (obrazec "Nov račun"), popraviš pa jih
     lahko pozneje v pregledu — zato ista polja obstajajo na dveh mestih. */
  var viewFields = {
    shop: el.vTrgovina, item: el.vIzdelek, brand: el.vZnamka, model: el.vModel,
    date: el.vDatum, warranty: el.vGarancija
  };

  function today() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* Sest polj -> objekt, kakrsen gre v IndexedDB in naprej v oblak. */
  function readFields(f) {
    var years = parseFloat(f.warranty.value);
    return {
      trgovina: (f.shop.value || '').trim(),
      izdelek: (f.item.value || '').trim(),
      znamka: (f.brand.value || '').trim(),
      model: (f.model.value || '').trim(),
      kupljeno: f.date.value || '',
      garancija_let: isNaN(years) ? '' : years
    };
  }

  function writeFields(f, rec) {
    f.shop.value = rec.trgovina || '';
    f.item.value = rec.izdelek || '';
    f.brand.value = rec.znamka || '';
    f.model.value = rec.model || '';
    f.date.value = rec.kupljeno || '';
    f.warranty.value = (rec.garancija_let === 0 || rec.garancija_let) ? rec.garancija_let : '';
  }

  /* Iztek garancije: datum nakupa + leta. Pol leta = 6 mesecev, zato racunamo
     v mesecih; setMonth sam prestopi v naslednje leto. */
  function warrantyEnd(rec) {
    if (!rec.kupljeno || !(rec.garancija_let > 0)) return null;
    var p = String(rec.kupljeno).split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + Math.round(rec.garancija_let * 12));
    return d;
  }

  /* 1 dan, 2 dneva, 3 dni — slovenska dvojina tudi tukaj. */
  function pluralDays(n) {
    var r = n % 100;
    if (r === 1) return n + ' dan';
    if (r === 2) return n + ' dneva';
    return n + ' dni';
  }

  function warrantyInfo(rec) {
    var end = warrantyEnd(rec);
    if (!end) return null;
    var days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    var datum = end.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (days < 0) return { text: 'Garancija je potekla ' + datum, cls: ' potekla', kratko: 'garancija potekla' };
    if (days <= 60) return { text: 'Garancija poteče ' + datum + ' — še ' + pluralDays(days), cls: ' kmalu', kratko: 'še ' + pluralDays(days) };
    return { text: 'Garancija do ' + datum, cls: '', kratko: 'do ' + datum };
  }

  function renderWarranty(rec) {
    var w = warrantyInfo(rec);
    el.viewerWarranty.hidden = !w;
    if (w) {
      el.viewerWarranty.textContent = w.text;
      el.viewerWarranty.className = 'garancija' + w.cls;
    }
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
          /* Podatki iz obrazca, izpolnjenega pred zajemom. Če je bil preskočen
             (npr. zajem sprožen drugače), zapis nastane brez njih in jih je
             mogoče vpisati pozneje v pregledu. */
          var m = state.meta || {};
          return DB.add({
            id: id, created: id, blob: blobs[0], thumb: blobs[1],
            w: canvas.width, h: canvas.height, size: blobs[0].size,
            trgovina: m.trgovina || '',
            izdelek: m.izdelek || '',
            znamka: m.znamka || '',
            model: m.model || '',
            kupljeno: m.datumNakupa || '',
            garancija_let: (m.garancijaLet === 0 || m.garancijaLet) ? m.garancijaLet : ''
          });
        })
        .then(function () {
          state.work = null; state.corners = null;
          resetForm();
          showGallery();
          if (window.Sync) Sync.afterSave();   // v ozadju, vmesnika ne zadrzuje
          return renderGallery();
        })
        .catch(function (err) {
          alert('Shranjevanje ni uspelo: ' + (err.message || err));
        })
        .then(function () { busy(false); });
    }, 30);
  }

  // --------------------------------------------------------------- galerija
  /* Išče po trgovini, izdelku, znamki, modelu in obeh datumih — nakupa in shranjevanja. */
  function matchesSearch(rec, q) {
    if (!q) return true;
    return [rec.trgovina || '', rec.izdelek || '', rec.znamka || '', rec.model || '', rec.kupljeno || '', fmtDate(rec.created)]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }

  function renderGallery() {
    return DB.all().then(function (all) {
      var q = (el.searchInput.value || '').trim().toLowerCase();
      var items = all.filter(function (rec) { return matchesSearch(rec, q); });

      el.grid.innerHTML = '';
      /* Poziv o prazni galeriji velja za res prazno shrambo; kadar filtrira
         iskanje, je pravo sporočilo drugo. */
      el.emptyState.hidden = all.length > 0;
      el.searchEmpty.hidden = !(all.length > 0 && items.length === 0);

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

        /* Naslov kartice: izdelek, sicer trgovina. Brez obojega ostane le datum,
           tako kot pri racunih, shranjenih pred temi polji. */
        var naslov = rec.izdelek || rec.trgovina || '';
        if (naslov) {
          var title = document.createElement('div');
          title.className = 'card-title';
          title.textContent = naslov;
          if (rec.izdelek && rec.trgovina) title.title = rec.izdelek + ' · ' + rec.trgovina;
          card.appendChild(title);
        }

        card.appendChild(date);

        var w = warrantyInfo(rec);
        if (w) {
          var badge = document.createElement('div');
          badge.className = 'card-garancija' + w.cls;
          badge.textContent = w.kratko;
          card.appendChild(badge);
        }

        card.addEventListener('click', function () { openViewer(rec.id); });
        el.grid.appendChild(card);
      });

      // Števec v glavi pove, koliko je shranjenega — ne, koliko jih iskanje pokaže.
      updateStorageInfo(all);
    });
  }

  /* Slovenska ednina/dvojina/množina: 1 račun, 2 računa, 3 računi, 5 računov. */
  function plural(n) {
    var r = n % 100;
    if (r === 1) return n + ' račun';
    if (r === 2) return n + ' računa';
    if (r === 3 || r === 4) return n + ' računi';
    return n + ' računov';
  }

  function updateStorageInfo(items) {
    var total = items.reduce(function (s, r) { return s + (r.size || 0); }, 0);
    el.storageInfo.textContent = items.length
      ? plural(items.length) + ' · ' + fmtSize(total)
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
      writeFields(viewFields, rec);
      renderWarranty(rec);
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

  /* Podatke se da vpisati ali popraviti tudi pozneje — racune, ki so bili
     shranjeni, preden so ta polja obstajala, se tako dopolni za nazaj. */
  function saveMeta() {
    if (!state.current) return;
    var rec = state.current, f = readFields(viewFields);
    rec.trgovina = f.trgovina;
    rec.izdelek = f.izdelek;
    rec.znamka = f.znamka;
    rec.model = f.model;
    rec.kupljeno = f.kupljeno;
    rec.garancija_let = f.garancija_let;
    rec.synced = 0;                       // sprememba mora se v oblak

    el.btnSaveMeta.disabled = true;
    DB.add(rec).then(function () {
      renderWarranty(rec);
      if (window.Sync) Sync.afterSave();
      return renderGallery();
    }).then(function () {
      el.btnSaveMeta.disabled = false;
    });
  }

  function removeCurrent() {
    if (!state.current) return;
    if (!confirm('Izbrišem ta račun?')) return;
    var id = state.current.id;
    closeViewer();
    DB.remove(id).then(function () {
      if (window.Sync) Sync.afterDelete(id);   // izbrise se tudi v oblaku
      return renderGallery();
    });
  }

  // -------------------------------------------------------------- obrazec (nov račun)
  function formFilled() {
    return el.fTrgovina.value.trim() !== '' && el.fIzdelek.value.trim() !== '';
  }

  function updateFormNext() {
    el.btnFormNext.disabled = !formFilled();
  }

  function openForm(action) {
    state.pendingAction = action;
    // Račun navadno slikaš isti dan, ko ga dobiš — datum ponudimo vnaprej.
    if (!el.fDatum.value) el.fDatum.value = today();
    el.captureRow.hidden = true;
    el.formNew.hidden = false;
  }

  function closeForm() {
    state.pendingAction = null;
    el.formNew.hidden = true;
    el.captureRow.hidden = false;
  }

  function confirmForm() {
    state.meta = {
      trgovina: el.fTrgovina.value.trim(),
      izdelek: el.fIzdelek.value.trim(),
      znamka: el.fZnamka.value.trim(),
      model: el.fModel.value.trim(),
      datumNakupa: el.fDatum.value || null,
      garancijaLet: el.fGarancija.value ? Number(el.fGarancija.value) : 0
    };
    var action = state.pendingAction;
    closeForm();
    if (action === 'camera') el.inputCamera.click();
    else if (action === 'picker') el.inputPicker.click();
  }

  function resetForm() {
    el.fTrgovina.value = ''; el.fIzdelek.value = '';
    el.fZnamka.value = ''; el.fModel.value = '';
    el.fDatum.value = ''; el.fGarancija.value = '';
    state.meta = null;
    updateFormNext();
    closeForm();
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

  el.fTrgovina.addEventListener('input', updateFormNext);
  el.fIzdelek.addEventListener('input', updateFormNext);
  el.btnCamera.addEventListener('click', function () { openForm('camera'); });
  el.btnPicker.addEventListener('click', function () { openForm('picker'); });
  el.btnFormNext.addEventListener('click', confirmForm);
  el.btnFormCancel.addEventListener('click', resetForm);
  el.searchInput.addEventListener('input', function () { renderGallery(); });

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
  el.btnSaveMeta.addEventListener('click', saveMeta);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.viewer.hidden) closeViewer();
  });


  // ----------------------------------------------------- namestitev v Chrome
  /* Chrome sproži dogodek beforeinstallprompt, ko so izpolnjeni pogoji za
     namestitev (varen izvor, manifest, ikoni 192/512 px, service worker).
     Poziv prestrežemo, da ga lahko ponudimo v svojem gumbu v glavi. */
  var installEvent = null;

  function isInstalled() {
    try {
      if (window.matchMedia &&
          (window.matchMedia('(display-mode: standalone)').matches ||
           window.matchMedia('(display-mode: window-controls-overlay)').matches)) return true;
    } catch (err) { /* stara okolja brez matchMedia */ }
    return navigator.standalone === true;   // iOS Safari
  }

  el.btnInstall.addEventListener('click', function () {
    var ev = installEvent;
    installEvent = null;                    // poziv je enkraten
    el.btnInstall.hidden = true;
    if (ev) ev.prompt();
  });

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installEvent = e;
      el.btnInstall.hidden = isInstalled();
    });
    window.addEventListener('appinstalled', function () {
      installEvent = null;
      el.btnInstall.hidden = true;
    });
  }

  /* Majhna povrsina za js/sync.js, da po prenosu iz oblaka osvezi galerijo. */
  window.App = { refreshGallery: renderGallery };

  renderGallery();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* neobvezno */ });
  }
})();
