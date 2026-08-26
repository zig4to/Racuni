/* Vmesnik za oblak: prijava, odjava, gumb za sinhronizacijo in stanje.
   Vsa logika je v js/sync.js — tu je samo vezava na DOM. */
(function () {
  'use strict';

  if (!window.Sync) return;

  var el = {};
  ['btnCloud', 'btnCloudLabel', 'cloud', 'btnCloudClose', 'cloudStatus', 'cloudLogin', 'cloudAccount',
   'cloudEmail', 'cloudPass', 'cloudErr', 'btnCloudLogin', 'cloudEmailShown',
   'btnCloudSync', 'btnCloudLogout'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  if (!el.btnCloud || !el.cloud) return;

  /* Dokler v js/sync.js nista vpisana URL_BASE in API_KEY, se aplikacija vede
     natanko tako kot prej — gumb za oblak sploh ne obstaja. */
  if (!Sync.configured()) return;
  el.btnCloud.hidden = false;

  function showError(msg) {
    el.cloudErr.textContent = msg || '';
    el.cloudErr.hidden = !msg;
  }

  /* Ime na gumbu je znak, da je prijava uspela — brez njega bi gumb po
     prijavi kazal isto splosno besedo ne glede na to, kdo je prijavljen.
     Ce Supabase ne pozna imena (user_metadata), ga izpeljemo iz e-poste. */
  function displayName(s) {
    if (s.name) return s.name;
    var local = (s.email || '').split('@')[0];
    var first = local.split(/[^A-Za-zÀ-ſ]+/)[0] || local;
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : (s.email || 'Racun');
  }

  function render() {
    var s = Sync.session();
    el.cloudLogin.hidden = !!s;
    el.cloudAccount.hidden = !s;
    if (s) el.cloudEmailShown.textContent = s.email || '';
    el.btnCloudLabel.textContent = s ? displayName(s) : 'Prijava';
  }

  /* Jasna povratna informacija po "Sinhroniziraj zdaj": zelena kljukica ob
     uspehu, rdeč križec ob napaki — ne le nevtralno besedilo kot prej. */
  Sync.onStatus = function (text, busy, kind) {
    var prefix = kind === 'ok' ? '✓ ' : kind === 'error' ? '✕ ' : '';
    el.cloudStatus.textContent = text ? (prefix + text) : '';
    el.cloudStatus.className = 'muted' +
      (kind === 'ok' ? ' status-ok' : kind === 'error' ? ' status-error' : '');
    el.btnCloud.classList[busy ? 'add' : 'remove']('busy-dot');
  };

  el.btnCloud.addEventListener('click', function () {
    showError('');
    render();
    el.cloud.hidden = false;
  });

  el.btnCloudClose.addEventListener('click', function () { el.cloud.hidden = true; });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.cloud.hidden) el.cloud.hidden = true;
  });

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
    /* Lokalni računi ostanejo — odjava odklopi oblak, ne izbriše galerije. */
    Sync.signOut().then(function () {
      render();
      el.cloud.hidden = true;
    });
  });

  // Ob zagonu in ob vrnitvi povezave poskusimo uskladiti v ozadju.
  render();
  if (Sync.session()) Sync.syncNow();
  window.addEventListener('online', function () { Sync.syncNow(); });
})();
