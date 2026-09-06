/* Tema aplikacije: sistemska / svetla / temna.
   Izbira se shrani v localStorage in uveljavi z atributom data-theme na <html>.
   Ta skripta se naloži v <head> (pred slogom), da ob osvežitvi ne utripne
   napačna barva. Ovito v IIFE, ES5 slog kot ostale datoteke. */
(function () {
  'use strict';

  var KEY = 'racuni:tema';
  var META_LIGHT = '#f4f6f9';
  var META_DARK = '#12151b';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'svetla' || v === 'temna' || v === 'sistem') ? v : 'sistem';
    } catch (e) {
      return 'sistem';
    }
  }

  function resolved() {
    var t = stored();
    if (t === 'svetla' || t === 'temna') return t;
    return (mq && mq.matches) ? 'temna' : 'svetla';
  }

  function apply() {
    var r = resolved();
    document.documentElement.setAttribute('data-theme', r);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', r === 'svetla' ? META_LIGHT : META_DARK);
  }

  apply();

  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () {
      if (stored() === 'sistem') { apply(); syncButtons(); }
    });
  }

  function set(choice) {
    if (choice !== 'svetla' && choice !== 'temna' && choice !== 'sistem') return;
    try { localStorage.setItem(KEY, choice); } catch (e) { /* zasebni način: tema se ne shrani */ }
    apply();
    syncButtons();
  }

  var segButtons = [];

  function syncButtons() {
    var cur = stored();
    segButtons.forEach(function (b) {
      var on = b.getAttribute('data-theme-choice') === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function wire() {
    var toggle = document.getElementById('btnSettingsToggle');
    var box = document.getElementById('settingsBox');
    if (toggle && box) {
      toggle.addEventListener('click', function () {
        var open = box.hidden;
        box.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    segButtons = [].slice.call(document.querySelectorAll('#settingsBox [data-theme-choice]'));
    segButtons.forEach(function (b) {
      b.addEventListener('click', function () { set(b.getAttribute('data-theme-choice')); });
    });
    syncButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.Theme = { get: stored, set: set };
})();
