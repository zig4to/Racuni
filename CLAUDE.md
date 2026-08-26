# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A dependency-free browser app (PWA): the user photographs a paper receipt, the app finds the
white sheet in the photo, crops it with perspective correction, and stores the JPG in IndexedDB.
Everything runs client-side; no photo ever leaves the device. UI language is Slovenian.

## Commands

```bash
npm start              # node serve.js — static server on :8080, prints LAN IPs too
npm test               # all three suites in sequence (~68 checks, no deps)
npm run test:detect    # node test/detect.node.test.js — corner detection only
npm run test:app       # node test/app.node.test.js — full UI flow only
npm run test:pwa       # node test/pwa.node.test.js — installability only
npm run icons          # regenerate icons/*.png from tools/make-icons.js
```

There is no build step, no bundler, no linter, no `node_modules`. Test suites are plain
`node file.js` scripts that exit non-zero on failure; there is no per-test filter — run the
suite that covers the area you touched.

`test/test.html` runs the detection cases in a real browser and renders the images, useful
when a numeric failure in `test:detect` needs eyeballing.

Note: `node`/`npm` are not on PATH in this environment, so the suites cannot be run here —
say so rather than claiming tests pass.

## Architecture

Three globals loaded by plain `<script>` tags in `index.html`, in this order:

| File | Exposes | Role |
|---|---|---|
| `js/db.js` | `window.DB` | IndexedDB `racuni-db` / store `slike` |
| `js/detect.js` | `window.Detect` | sheet detection + perspective crop |
| `js/app.js` | `window.App` | IIFE that wires the DOM, runs on load |
| `js/sync.js` | `window.Sync` | Supabase sync — auth, storage, push/pull. No DOM. |
| `js/cloud.js` | (nothing) | login overlay + sync button wiring |

`sync.js` talks to Supabase over plain `fetch` rather than `supabase-js`, deliberately: the
library persists its session under `sb-<ref>-auth-token`, and the calendar app (masCajt) is
served from the same origin `zig4to.github.io`. It would adopt that session, send its requests
as role `authenticated`, and break — `kv_store` there is granted to `anon` only. Do not swap in
the library without giving it a custom `storageKey`.

`app.js` touches sync only through `if (window.Sync)` guards, so `test:app` runs unchanged with
`sync.js` unloaded. Keep it that way: the test stubs have no `fetch` and no `localStorage`.

Each is an ES5-style IIFE assigning to `window`. No modules, no imports — adding a file means
adding a `<script>` tag *and* an entry in the service worker shell (see below).

### Pipeline and its size constants

`app.js` decodes the picked file → `toWorkCanvas` downscales to `MAX_WORK` 2200 px →
`Detect.findCorners` internally downscales again to `ANALYZE_W` 420 px for analysis and scales
the resulting corners back up → user may drag handles → `Detect.crop` warps to at most
`MAX_OUT` 1500 px → JPG at `JPEG_Q` 0.92 plus a `THUMB_W` 320 px thumbnail → `DB.add`.

Corners are **always** `[TL, TR, BR, BL]` in the coordinate space of `state.work`, both in and
out of `Detect`. `orderCorners` enforces that ordering after quad search; `crop` builds the
homography output→source and samples bilinearly.

`findCorners` returns `{corners, auto}`. `auto:false` means "not confident" — the app keeps the
corners but changes the hint to ask for manual adjustment. Confidence is gated on
`borderContrast` (sheet edge must differ in luma from the background) and on the quad not
covering nearly the whole frame. A white receipt on a white table is expected to fail this and
fall back to `defaultCorners`; that is by design, not a bug to fix.

`biggestQuad` is O(n⁴) over the hull points, which is why `sampleHull` caps them at
`HULL_PTS` 26. Raising that constant is quartic, not linear.

### DB records

`{ id, created, blob (JPG), thumb (JPG), w, h, size, synced, trgovina, izdelek, znamka, model,
kupljeno, garancija_let }`, where `id === created === Date.now()` and doubles as the primary key
and the gallery sort key.

The last seven are additive and optional — IndexedDB is schemaless per record, so receipts saved
before those fields existed simply lack them and render blank. That is why `VERSION` in
`js/db.js` is still 1. Only adding an *index* would require bumping it and handling
`onupgradeneeded`.

`synced` drives sync: `0`/absent means pending upload. Editing the six purchase fields sets it
back to `0`, and `sync.js` upserts with `Prefer: resolution=merge-duplicates` — which is why the
`racuni` table needs an UPDATE grant and policy, not just INSERT.

Warranty expiry is derived, never stored: `kupljeno + garancija_let` computed in `warrantyEnd()`
in `js/app.js`. Storing it would go stale.

## Tests run without a browser — and that constrains the source

There is no jsdom or headless browser. `test/helpers.js` hand-implements a canvas substitute
covering **only the subset of the 2D context the app actually calls** (`getImageData`,
`createImageData`, `putImageData`, the 5-argument `drawImage`, `toBlob`), plus `scene()`, which
synthesizes receipt photos with known ground-truth corners.

`test/app.node.test.js` goes further: it stubs the DOM, `indexedDB`, `URL`, `File`, `navigator`,
`matchMedia`, `createImageBitmap`, sets `global.window = global`, and then loads the *real*
`js/app.js` and drives it end to end.

Practical consequences when editing `js/`:

- Using a browser API the stubs do not implement makes `test:app` crash, not fail gracefully.
  Extend the stub in the same change.
- The stubbed `getElementById` returns `null` for any id not present in `index.html`, so a new
  element must be added to `index.html` in the same commit as the code that looks it up.
- The detect suite loads `js/detect.js` after setting `global.window = {}` and a
  `document.createElement` returning a fake canvas — detection code must not reach for anything
  else off `document` or `window`.

Detection assertions: corner error under 3 % of the image diagonal against the synthetic ground
truth, and the crop must come out bright (`luma > 140`).

## PWA invariants (enforced by test/pwa.node.test.js)

- Every path listed in `SHELL` in `sw.js` must exist in the repo. Adding, renaming, or removing
  an app file means updating `SHELL`.
- **Bump `VERSION` in `sw.js` on any shell-file change** — the worker is cache-first, so without
  a version bump returning visitors keep the old files. (See commit 7a73779 for a case where
  this was the actual fix.)
- Every icon listed in `manifest.json` must exist, and its declared `sizes` must match the real
  PNG dimensions read from the IHDR header. After editing the artwork run `npm run icons`.
- `icon.svg` and the drawing code in `tools/make-icons.js` are two hand-maintained copies of the
  same artwork — change both together or they drift.
- Chrome only offers installation on a secure origin (`https://` or `localhost`). Over the LAN
  IP printed by `serve.js` the install button will never appear; that is not a regression.

`serve.js` serves `manifest.json` as `application/manifest+json` explicitly — Chrome ignores it
otherwise.

## Conventions

- All user-facing strings, code comments, and commit messages are in Slovenian. Keep them that
  way, including new ones.
- Slovenian has singular/dual/plural; the `plural()` helper in `js/app.js` handles counts.
- ES5 style throughout (`var`, function expressions, no arrow functions or `const`) — match it.
- Paths are relative everywhere so the app works from a GitHub Pages subdirectory.
