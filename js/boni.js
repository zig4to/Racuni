/* Darilni boni — ločena zbirka od računov (glej window.DB.*Bon* v js/db.js).
   Ista ideja kot pri računih (slikaj/izberi -> shrani -> galerija -> pregled),
   brez zaznave/obreza (Detect ni potreben — bon ni bel list na mizi) in z
   možnostjo dodajanja več slik naenkrat enemu bonu.
   Vstopna točka je gumb "Darilni boni" v glavnem meniju (glej window.App v
   js/app.js), stran sama pa nadomesti #viewGallery, dokler je odprta. */
(function () {
  'use strict';

  if (!window.DB) return;

  var MAX_SIDE = 1600;   // dovolj za berljivo sliko bona, brez obreza ni treba vec
  var JPEG_Q = 0.9;
  var THUMB_W = 320;

  var el = {};
  ['btnOpenBoni', 'menuDropdown', 'btnMenu', 'viewGallery', 'viewBoni', 'btnBoniBack',
   'btnBonAdd', 'inputBonImages', 'formBon', 'bonPending', 'bTrgovina', 'bVrednost', 'bPotece',
   'btnBonFormCancel', 'btnBonFormSave', 'boniEmpty', 'boniGrid',
   'boniViewer', 'btnBoniViewerClose', 'boniViewerMeta', 'boniViewerExpiry',
   'btnBoniPagePrev', 'btnBoniPageNext', 'boniViewerImg', 'boniPageIndicator',
   'vbTrgovina', 'vbVrednost', 'vbPotece', 'btnBonAddImage', 'btnBonSaveMeta', 'bonSaveMetaStatus',
   'btnBonDownload', 'btnBonDelete', 'busy', 'busyText'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  if (!el.viewBoni || !el.btnOpenBoni) return;

  var state = {
    pending: [],     // {blob, thumb, w, h, size} slik za nov (še ne shranjen) bon
    current: null,   // odprt zapis v boniViewer
    pageIndex: 0,
    objectUrl: null,
    addTarget: null  // null = slike gredo v state.pending (nov bon); id = dodajanje k obstoječemu bonu
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

  function fmtEUR(v) {
    if (v === '' || v == null || isNaN(v)) return '';
    var n = Number(v);
    return (Math.round(n * 100) % 100 === 0 ? n.toFixed(0) : n.toFixed(2)) + ' €';
  }

  /* 1 dan, 2 dneva, 3 dni — slovenska dvojina. */
  function pluralDays(n) {
    var r = n % 100;
    if (r === 1) return n + ' dan';
    if (r === 2) return n + ' dneva';
    return n + ' dni';
  }

  /* Za razliko od garancije pri računih (izpeljana iz datuma nakupa + let) je
     tu datum poteka vpisan neposredno — sicer ista logika/pragovi. */
  function expiryInfo(rec) {
    if (!rec.potece) return null;
    var p = String(rec.potece).split('-');
    if (p.length !== 3) return null;
    var end = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(end.getTime())) return null;
    var days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    var datum = end.toLocaleDateString('sl-SI', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (days < 0) return { text: 'Bon je potekel ' + datum, cls: ' potekla', kratko: 'potekel' };
    if (days <= 60) return { text: 'Bon poteče ' + datum + ' — še ' + pluralDays(days), cls: ' kmalu', kratko: 'še ' + pluralDays(days) };
    return { text: 'Bon velja do ' + datum, cls: '', kratko: 'do ' + datum };
  }

  // ---------------------------------------------------------- nalaganje slike
  /* Enak vzorec kot v js/app.js (decode/toCanvas/canvasToBlob), le brez
     zaznave beline in brez ročnega popravka vogalov — bon je preprosta
     fotografija/posnetek zaslona, ne račun na mizi. */
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return decodeViaImg(file); });
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
  function toCanvas(source) {
    var w = source.width, h = source.height;
    var k = Math.min(1, MAX_SIDE / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    if (source.close) source.close();
    return c;
  }
  function makeThumbCanvas(canvas) {
    var t = document.createElement('canvas');
    var k = Math.min(1, THUMB_W / canvas.width);
    t.width = Math.round(canvas.width * k);
    t.height = Math.round(canvas.height * k);
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    return t;
  }
  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        b ? resolve(b) : reject(new Error('Slike ni bilo mogoče pretvoriti v JPG.'));
      }, 'image/jpeg', quality);
    });
  }
  function processFile(file) {
    return decode(file).then(function (src) {
      var canvas = toCanvas(src);
      var thumbCanvas = makeThumbCanvas(canvas);
      return Promise.all([canvasToBlob(canvas, JPEG_Q), canvasToBlob(thumbCanvas, JPEG_Q)]).then(function (r) {
        return { blob: r[0], thumb: r[1], w: canvas.width, h: canvas.height, size: r[0].size };
      });
    });
  }

  // -------------------------------------------------------- obrazec: nov bon
  function renderPending() {
    el.bonPending.innerHTML = '';
    state.pending.forEach(function (img, i) {
      var box = document.createElement('div');
      box.className = 'pending-thumb';

      var im = document.createElement('img');
      im.src = URL.createObjectURL(img.thumb);
      im.onload = function () { URL.revokeObjectURL(im.src); };
      box.appendChild(im);

      var rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.title = 'Odstrani';
      rm.addEventListener('click', function () {
        state.pending.splice(i, 1);
        renderPending();
        updateBonFormNext();
      });
      box.appendChild(rm);

      el.bonPending.appendChild(box);
    });
  }

  function updateBonFormNext() {
    el.btnBonFormSave.disabled = !(el.bTrgovina.value.trim() !== '' && state.pending.length > 0);
  }

  function resetBonForm() {
    state.pending = [];
    el.bTrgovina.value = '';
    el.bVrednost.value = '';
    el.bPotece.value = '';
    el.bonPending.innerHTML = '';
    el.formBon.hidden = true;
    updateBonFormNext();
  }

  function onBonImages(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';   // iste slike je mogoče izbrati znova
    if (!files.length) return;

    var appendTo = state.addTarget;
    state.addTarget = null;

    busy(true, 'Dodajam slik' + (files.length > 1 ? 'e' : 'o') + ' …');
    Promise.all(files.map(processFile)).then(function (imgs) {
      if (appendTo) {
        return DB.getBon(appendTo).then(function (rec) {
          if (!rec) return;
          rec.images = rec.images.concat(imgs);
          return DB.addBon(rec).then(function () {
            state.current = rec;
            showBonPage();
            return renderBoniGallery();
          });
        });
      }
      state.pending = state.pending.concat(imgs);
      renderPending();
      el.formBon.hidden = false;
      updateBonFormNext();
    }).catch(function (err) {
      alert('Napaka pri branju slike: ' + (err.message || err));
    }).then(function () { busy(false); });
  }

  // --------------------------------------------------------------- galerija
  function renderBoniGallery() {
    return DB.allBoni().then(function (all) {
      el.boniGrid.innerHTML = '';
      el.boniEmpty.hidden = all.length > 0;

      all.forEach(function (rec) {
        if (!rec.images || !rec.images.length) return;   // varovalo, ne bi se smelo zgoditi
        var card = document.createElement('div');
        card.className = 'card';

        var img = document.createElement('img');
        img.src = URL.createObjectURL(rec.images[0].thumb);
        img.alt = 'Darilni bon' + (rec.trgovina ? ' — ' + rec.trgovina : '');
        img.loading = 'lazy';
        img.onload = function () { URL.revokeObjectURL(img.src); };
        card.appendChild(img);

        var top = document.createElement('div');
        top.className = 'card-top';

        var title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = rec.trgovina || 'Neimenovana trgovina';
        top.appendChild(title);

        var exp = expiryInfo(rec);
        if (exp) {
          var badge = document.createElement('div');
          badge.className = 'card-garancija' + exp.cls;
          badge.textContent = exp.kratko;
          top.appendChild(badge);
          // Zelena obroba, dokler bon velja, rdeča, ko je potekel — enako kot pri garanciji računov.
          if (exp.cls === ' potekla') card.classList.add('garancija-potekla');
          else card.classList.add('garancija-velja');
        }
        card.appendChild(top);

        var date = document.createElement('div');
        date.className = 'date';
        date.textContent = (rec.vrednost === 0 || rec.vrednost) ? fmtEUR(rec.vrednost) : fmtDate(rec.created);
        card.appendChild(date);

        if (rec.images.length > 1) {
          var pages = document.createElement('div');
          pages.className = 'card-pages';
          pages.textContent = rec.images.length + ' sl.';
          card.appendChild(pages);
        }

        card.addEventListener('click', function () { openBonViewer(rec.id); });
        el.boniGrid.appendChild(card);
      });
    });
  }

  // ---------------------------------------------------------- pregledovalnik
  function openBonViewer(id) {
    DB.getBon(id).then(function (rec) {
      if (!rec) return;
      state.current = rec;
      state.pageIndex = 0;
      showBonPage();
      el.vbTrgovina.value = rec.trgovina || '';
      el.vbVrednost.value = (rec.vrednost === 0 || rec.vrednost) ? rec.vrednost : '';
      el.vbPotece.value = rec.potece || '';
      renderExpiry(rec);
      el.boniViewer.hidden = false;
    });
  }

  function renderExpiry(rec) {
    var exp = expiryInfo(rec);
    el.boniViewerExpiry.hidden = !exp;
    if (exp) {
      el.boniViewerExpiry.textContent = exp.text;
      el.boniViewerExpiry.className = 'garancija' + exp.cls;
    }
  }

  function showBonPage() {
    var imgs = state.current.images, p = imgs[state.pageIndex];
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(p.blob);
    el.boniViewerImg.src = state.objectUrl;
    el.boniViewerMeta.textContent = fmtDate(state.current.created) + ' · ' + p.w + '×' + p.h + ' · ' + fmtSize(p.size);

    var multi = imgs.length > 1;
    el.btnBoniPagePrev.hidden = el.btnBoniPageNext.hidden = el.boniPageIndicator.hidden = !multi;
    if (multi) {
      el.boniPageIndicator.textContent = (state.pageIndex + 1) + ' / ' + imgs.length;
      el.btnBoniPagePrev.disabled = state.pageIndex === 0;
      el.btnBoniPageNext.disabled = state.pageIndex === imgs.length - 1;
    }
  }

  function prevBonPage() { if (state.pageIndex > 0) { state.pageIndex--; showBonPage(); } }
  function nextBonPage() { if (state.pageIndex < state.current.images.length - 1) { state.pageIndex++; showBonPage(); } }

  function closeBonViewer() {
    el.boniViewer.hidden = true;
    el.boniViewerImg.removeAttribute('src');
    if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
    state.current = null;
  }

  var saveStatusTimer = null;
  function showBonSaveConfirmation() {
    clearTimeout(saveStatusTimer);
    el.bonSaveMetaStatus.hidden = false;
    el.bonSaveMetaStatus.classList.remove('fade');
    saveStatusTimer = setTimeout(function () {
      el.bonSaveMetaStatus.classList.add('fade');
      saveStatusTimer = setTimeout(function () { el.bonSaveMetaStatus.hidden = true; }, 400);
    }, 2200);
  }

  function saveBonMeta() {
    if (!state.current) return;
    var rec = state.current;
    var v = parseFloat(el.vbVrednost.value);
    rec.trgovina = (el.vbTrgovina.value || '').trim();
    rec.vrednost = isNaN(v) ? '' : v;
    rec.potece = el.vbPotece.value || '';

    el.btnBonSaveMeta.disabled = true;
    DB.addBon(rec).then(function () {
      renderExpiry(rec);
      showBonSaveConfirmation();
      return renderBoniGallery();
    }).then(function () { el.btnBonSaveMeta.disabled = false; });
  }

  function removeBon() {
    if (!state.current) return;
    if (!confirm('Izbrišem ta darilni bon?')) return;
    var id = state.current.id;
    closeBonViewer();
    DB.removeBon(id).then(renderBoniGallery);
  }

  function bonFileName(rec, idx) {
    var d = new Date(rec.created);
    function p(n) { return String(n).padStart(2, '0'); }
    var shop = rec.trgovina ? rec.trgovina.replace(/[^\wА-я]+/g, '_') + '_' : '';
    return 'bon_' + shop + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      (rec.images.length > 1 ? '_' + (idx + 1) : '') + '.jpg';
  }

  function downloadBon() {
    if (!state.current) return;
    var imgs = state.current.images, p = imgs[state.pageIndex];
    var url = URL.createObjectURL(p.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = bonFileName(state.current, state.pageIndex);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ------------------------------------------------------------- preklop pogledov
  function showBoni() {
    el.viewGallery.hidden = true;
    el.viewBoni.hidden = false;
    window.scrollTo(0, 0);
  }
  function showGalleryBack() {
    el.viewBoni.hidden = true;
    el.viewGallery.hidden = false;
  }

  // ---------------------------------------------------------------- dogodki
  el.btnOpenBoni.addEventListener('click', function () {
    el.menuDropdown.hidden = true;
    if (el.btnMenu) el.btnMenu.setAttribute('aria-expanded', 'false');
    showBoni();
    renderBoniGallery();
  });
  el.btnBoniBack.addEventListener('click', showGalleryBack);

  el.btnBonAdd.addEventListener('click', function () {
    state.addTarget = null;
    el.inputBonImages.click();
  });
  el.inputBonImages.addEventListener('change', onBonImages);
  el.bTrgovina.addEventListener('input', updateBonFormNext);
  el.btnBonFormCancel.addEventListener('click', resetBonForm);
  el.btnBonFormSave.addEventListener('click', function () {
    if (!(el.bTrgovina.value.trim() && state.pending.length)) return;
    var v = parseFloat(el.bVrednost.value);
    var rec = {
      id: Date.now(),
      created: Date.now(),
      trgovina: el.bTrgovina.value.trim(),
      vrednost: isNaN(v) ? '' : v,
      potece: el.bPotece.value || '',
      images: state.pending.slice()
    };
    el.btnBonFormSave.disabled = true;
    DB.addBon(rec).then(function () {
      resetBonForm();
      return renderBoniGallery();
    }).catch(function (err) {
      alert('Shranjevanje ni uspelo: ' + (err.message || err));
    }).then(function () { el.btnBonFormSave.disabled = false; });
  });

  el.btnBoniViewerClose.addEventListener('click', closeBonViewer);
  el.btnBoniPagePrev.addEventListener('click', prevBonPage);
  el.btnBoniPageNext.addEventListener('click', nextBonPage);
  el.btnBonAddImage.addEventListener('click', function () {
    state.addTarget = state.current ? state.current.id : null;
    el.inputBonImages.click();
  });
  el.btnBonSaveMeta.addEventListener('click', saveBonMeta);
  el.btnBonDownload.addEventListener('click', downloadBon);
  el.btnBonDelete.addEventListener('click', removeBon);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.boniViewer.hidden) closeBonViewer();
  });
})();
