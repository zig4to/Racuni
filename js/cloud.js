/* Vmesnik za oblak: prijava, odjava, gumb za sinhronizacijo in stanje.
   Vsa logika je v js/sync.js — tu je samo vezava na DOM. Odpiranje/zapiranje
   menija samega je v js/app.js (glej window.App.onMenuOpen) — tu upravljamo
   le vsebino cloudBox znotraj njega. */
(function () {
  'use strict';

  if (!window.Sync) return;

  var el = {};
  ['btnMenu', 'cloudBox', 'cloudStatus', 'cloudLogin', 'cloudAccount',
   'cloudEmail', 'cloudPass', 'cloudErr', 'btnCloudLogin', 'cloudEmailShown',
   'btnCloudSync', 'btnCloudLogout'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  if (!el.cloudBox) return;

  /* Dokler v js/sync.js nista vpisana URL_BASE in API_KEY, se aplikacija vede
     natanko tako kot prej — razdelek za oblak v meniju sploh ne obstaja. */
  if (!Sync.configured()) return;
  el.cloudBox.hidden = false;

  function showError(msg) {
    el.cloudErr.textContent = msg || '';
    el.cloudErr.hidden = !msg;
  }

  function render() {
    var s = Sync.session();
    el.cloudLogin.hidden = !!s;
    el.cloudAccount.hidden = !s;
    if (s) el.cloudEmailShown.textContent = s.email || '';
  }

  /* Jasna povratna informacija po "Sinhroniziraj zdaj": zelena kljukica ob
     uspehu, rdeč križec ob napaki — ne le nevtralno besedilo kot prej. */
  Sync.onStatus = function (text, busy, kind) {
    var prefix = kind === 'ok' ? '✓ ' : kind === 'error' ? '✕ ' : '';
    el.cloudStatus.textContent = text ? (prefix + text) : '';
    el.cloudStatus.className = 'muted' +
      (kind === 'ok' ? ' status-ok' : kind === 'error' ? ' status-error' : '');
    if (el.btnMenu) el.btnMenu.classList[busy ? 'add' : 'remove']('busy-dot');
  };

  // Ob vsakem odprtju menija osvežimo stanje prijave (npr. seja je medtem potekla).
  if (window.App && window.App.onMenuOpen) {
    window.App.onMenuOpen.push(function () { showError(''); render(); });
  }

  el.btnCloudLogin.addEventListener('click', function () {
    var email = (el.cloudEmail.value || '').trim();
    var pass = el.cloudPass.value || '';
    if (!email || !pass) { showError('Vpiši e-pošto in geslo.'); return; }

    showError('');
    el.btnCloudLogin.disabled = true;
    Sync.signIn(email, pass).then(function () {
      el.cloudPass.value = '';
      render();
      return Sync.syncNow();
    }).catch(function (err) {
      showError(err.message || 'Prijava ni uspela.');
    }).then(function () {
      el.btnCloudLogin.disabled = false;
    });
  });

  el.btnCloudSync.addEventListener('click', function () { Sync.syncNow(); });

  el.btnCloudLogout.addEventListener('click', function () {
    /* Lokalni računi ostanejo — odjava odklopi oblak, ne izbriše galerije.
       Meni ostane odprt: render() takoj pokaže prijavni obrazec nazaj. */
    Sync.signOut().then(render);
  });

  // Ob zagonu in ob vrnitvi povezave poskusimo uskladiti v ozadju.
  render();
  if (Sync.session()) Sync.syncNow();
  window.addEventListener('online', function () { Sync.syncNow(); });
})();
