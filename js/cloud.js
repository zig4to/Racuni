/* Vmesnik za oblak: prijava, odjava, gumb za sinhronizacijo in stanje.
   Vsa logika je v js/sync.js — tu je samo vezava na DOM. Odpiranje/zapiranje
   menija samega je v js/app.js (glej window.App.onMenuOpen) — tu upravljamo
   le razdelek za oblak znotraj njega: vrstica na vrhu menija (btnCloudToggle)
   se strni/razširi neodvisno in kaže ime prijavljenega uporabnika namesto
   splošne besede "Oblak" — dokler prijave ni, kaže "Prijava". */
(function () {
  'use strict';

  if (!window.Sync) return;

  var el = {};
  ['btnMenu', 'cloudMenuSection', 'btnCloudToggle', 'cloudToggleLabel', 'cloudBox',
   'cloudStatus', 'cloudLogin', 'cloudAccount',
   'cloudEmail', 'cloudPass', 'cloudErr', 'btnCloudLogin', 'cloudEmailShown',
   'btnCloudSync', 'btnCloudLogout'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  if (!el.cloudMenuSection) return;

  /* Dokler v js/sync.js nista vpisana URL_BASE in API_KEY, se aplikacija vede
     natanko tako kot prej — razdelek za oblak v meniju sploh ne obstaja. */
  if (!Sync.configured()) return;
  el.cloudMenuSection.hidden = false;

  function showError(msg) {
    el.cloudErr.textContent = msg || '';
    el.cloudErr.hidden = !msg;
  }

  /* Ime na vrstici je znak, da je prijava uspela — brez njega bi vrstica po
     prijavi kazala isto splošno besedo ne glede na to, kdo je prijavljen.
     Če Supabase ne pozna imena (user_metadata), ga izpeljemo iz e-pošte. */
  function displayName(s) {
    if (s.name) return s.name;
    var local = (s.email || '').split('@')[0];
    var first = local.split(/[^A-Za-zÀ-ſ]+/)[0] || local;
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : (s.email || 'Račun');
  }

  function render() {
    var s = Sync.session();
    el.cloudLogin.hidden = !!s;
    el.cloudAccount.hidden = !s;
    if (s) el.cloudEmailShown.textContent = s.email || '';
    el.cloudToggleLabel.textContent = s ? displayName(s) : 'Prijava';
  }

  function toggleCloudBox() {
    el.cloudBox.hidden = !el.cloudBox.hidden;
    el.btnCloudToggle.setAttribute('aria-expanded', el.cloudBox.hidden ? 'false' : 'true');
  }

  el.btnCloudToggle.addEventListener('click', toggleCloudBox);

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
       Razdelek ostane razširjen: render() takoj pokaže prijavni obrazec nazaj. */
    Sync.signOut().then(render);
  });

  // Ob zagonu in ob vrnitvi povezave poskusimo uskladiti v ozadju.
  render();
  if (Sync.session()) Sync.syncNow();
  window.addEventListener('online', function () { Sync.syncNow(); });
})();
