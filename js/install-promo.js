/* Ponudba namestitve aplikacije (PWA) ob odprtju.
   Samostojno: ujame beforeinstallprompt, zgradi lastno okno in slog,
   sam se sproži ob nalaganju strani.

   Vedenje:
   - okno se pokaže ob odprtju aplikacije, prvih 5-krat (nato utihne);
   - "Prekliči" ali Escape ustavi prikazovanje;
   - ne pokaže se, če je aplikacija (verjetno) že nameščena
     (standalone način ali navigator.getInstalledRelatedApps);
   - iOS: pokaže ročna navodila; po prvem zaprtju utihne;
   - brez namestljive poti (npr. namizni Firefox): okna ni. */
(function () {
  "use strict";

  var LS_COUNT = "install-promo-open-count";
  var LS_DONE = "install-promo-done";
  var LS_INSTALLED = "install-promo-installed";
  var LS_IOS_OFF = "install-promo-ios-off";
  var SS_COUNTED = "install-promo-counted";
  var MAX = 5;

  var deferred = null;
  var modal = null;
  var iosVariant = false;
  var pending = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* zasebni način */ } }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches ||
           window.matchMedia("(display-mode: minimal-ui)").matches ||
           window.navigator.standalone === true;
  }
  function isIOS() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  }
  function probablyInstalled() {
    return isStandalone() || lsGet(LS_INSTALLED) === "1";
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    if (pending) {
      pending = false;
      if (!probablyInstalled() && lsGet(LS_DONE) !== "1") setTimeout(triggerOpen, 150);
    }
  });

  window.addEventListener("appinstalled", function () {
    deferred = null;
    lsSet(LS_INSTALLED, "1");
    lsSet(LS_DONE, "1");
    if (modal) modal.hidden = true;
  });

  if (navigator.getInstalledRelatedApps) {
    try {
      navigator.getInstalledRelatedApps().then(function (apps) {
        if (apps && apps.length) lsSet(LS_INSTALLED, "1");
      }).catch(function () {});
    } catch (e) { /* ni pomembno */ }
  }

  function buildModal() {
    if (modal) return modal;
    var ic = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>';
    var style = document.createElement("style");
    style.textContent =
      ".ip-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(8,10,20,.55);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}" +
      ".ip-overlay[hidden]{display:none}" +
      ".ip-box{width:100%;max-width:360px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:24px 22px;border-radius:16px;background:#12131a;color:#f4f5f7;border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 60px -12px rgba(0,0,0,.6);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
      ".ip-box h2{margin:0;font-size:1.1rem;font-weight:600}" +
      ".ip-box p{margin:0;font-size:.9rem;line-height:1.5;color:rgba(244,245,247,.72)}" +
      ".ip-ico svg{width:32px;height:32px;display:block}" +
      ".ip-primary{margin-top:4px;display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border:0;border-radius:999px;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer}" +
      ".ip-primary svg{width:17px;height:17px}" +
      ".ip-cancel{padding:6px 10px;border:0;background:none;color:rgba(244,245,247,.6);font:inherit;font-size:.8rem;cursor:pointer}" +
      ".ip-cancel:hover{color:#f4f5f7}" +
      ".ip-cancel[hidden]{display:none}" +
      "@media (prefers-color-scheme:light){.ip-box{background:#fff;color:#1a1c22;border-color:rgba(0,0,0,.12)}.ip-box p{color:rgba(26,28,34,.66)}.ip-cancel{color:rgba(26,28,34,.55)}.ip-cancel:hover{color:#1a1c22}}";
    document.head.appendChild(style);

    var ov = document.createElement("div");
    ov.className = "ip-overlay";
    ov.hidden = true;
    ov.innerHTML =
      '<div class="ip-box" role="dialog" aria-modal="true" aria-label="Namesti aplikacijo">' +
        '<span class="ip-ico">' + ic + "</span>" +
        "<h2>Namesti aplikacijo</h2>" +
        '<p class="ip-text"></p>' +
        '<button class="ip-primary" type="button">' + ic + '<span class="ip-label">Namesti</span></button>' +
        '<button class="ip-cancel" type="button">Prekliči</button>' +
      "</div>";
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(); });
    ov.querySelector(".ip-cancel").addEventListener("click", closeModal);
    ov.querySelector(".ip-primary").addEventListener("click", onPrimary);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal && !modal.hidden) closeModal();
    });
    modal = ov;
    return ov;
  }

  function openModal() {
    var ov = buildModal();
    iosVariant = !deferred && isIOS();
    var label = ov.querySelector(".ip-label");
    var cancel = ov.querySelector(".ip-cancel");
    if (iosVariant) {
      ov.querySelector(".ip-text").textContent = "V Safariju: Deli → Dodaj na začetni zaslon.";
      label.textContent = "Razumem";
      cancel.hidden = true;
    } else {
      ov.querySelector(".ip-text").textContent = "Za najboljšo izkušnjo namesti aplikacijo na svojo napravo.";
      label.textContent = "Namesti";
      cancel.hidden = false;
    }
    ov.hidden = false;
    ov.querySelector(".ip-primary").focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    lsSet(LS_DONE, "1");
    if (iosVariant) lsSet(LS_IOS_OFF, "1");
  }

  function onPrimary() {
    closeModal();
    if (!deferred) return;
    deferred.prompt();
    if (deferred.userChoice && deferred.userChoice.finally) {
      deferred.userChoice.finally(function () { deferred = null; });
    } else {
      deferred = null;
    }
  }

  function triggerOpen() {
    var n = (parseInt(lsGet(LS_COUNT), 10) || 0) + 1;
    lsSet(LS_COUNT, String(n));
    if (n > MAX) { lsSet(LS_DONE, "1"); return; }
    if (n >= MAX) lsSet(LS_DONE, "1");
    setTimeout(openModal, 500);
  }

  function run() {
    if (probablyInstalled()) return;
    if (lsGet(LS_DONE) === "1") return;
    if (isIOS() && lsGet(LS_IOS_OFF) === "1") return;
    try {
      if (sessionStorage.getItem(SS_COUNTED)) return;
      sessionStorage.setItem(SS_COUNTED, "1");
    } catch (e) { /* zasebni način */ }
    if (!deferred && !isIOS()) { pending = true; return; }
    triggerOpen();
  }

  window.InstallPromo = { run: run, afterLogin: run, _open: openModal };

  // Samodejni sprožilec: prvih 5 odprtij aplikacije.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
