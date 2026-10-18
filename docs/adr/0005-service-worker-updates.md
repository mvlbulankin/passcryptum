# 0005. App updates are pulled by the app; browser soft-updates are too slow to rely on

Date: 2026-10-18
Status: accepted

## Context

The SPA is a single-file build: the whole app is `index.html`, served by a
service worker **cache-first** (instant offline launch; the self-hosted
server may be down). The build stamps `CACHE_VERSION` into `dist/sw.js`
(`swVersionPlugin`), so every build ships worker bytes different from the
previous build's.

The update story assumed browsers re-check `sw.js` on navigation — the 3.0
CHANGELOG even keeps protocol v1 served "for devices that have not refreshed
their service worker". The refresh is throttled rather than absent: per
[MDN Service Worker API][mdn-lifecycle], a registered worker is re-checked on
an in-scope navigation, but at most once every 24 hours, and `update()`'s
fetch bypasses the HTTP cache only after the same 24-hour window. A device
launched a few times over a day therefore sends **zero** update-check
requests (measured: three launches in Chromium, none observed) and keeps
serving whatever build it first cached until the throttle expires. This
shipped: an Android device stuck on a pre-fix-3.0.0 build failed every vault
download (the download bug fixed in `3365b0a`) while fresh desktop browsers
worked, and only a manual site-data clear recovered the phone.

The root cause is confirmed for "updates are too slow to rely on", not for
"the check never exists": the incident device was recovered by hand before
its update traffic could be observed. Update-on-launch below is therefore
adopted for a bounded, deterministic propagation delay — two launches — and
not as a claim that browsers never check.

[mdn-lifecycle]: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

## Decision

- The **app asks for updates itself**: `registerServiceWorker()` calls
  `registration.update()` on every launch (`src/app/lib/register-sw.ts`).
  A changed worker installs, `skipWaiting`s, and its `activate` wipes all
  caches and re-caches the fresh shell. The update lands on the **next**
  launch — two-launch propagation is accepted.
- The backend serves `/sw.js` with `Cache-Control: no-cache`
  (`swJSNoCache` in `backend/server.go`). This is **defense in depth**, not
  the fix: the registration's default `updateViaCache: 'imports'` already
  keeps the worker's own script out of the browser's HTTP cache. What the
  header adds is coverage for intermediaries in front of the backend (the
  Caddy gateway, a CDN, a corporate proxy) and for any client that changes
  that default.
- The shell stays cache-first. Rejected alternative: network-first for the
  shell (one-launch propagation) — it would make every launch wait on the
  network and couple opening the vault to the home server being up.

## Consequences

- One conditional `sw.js` request per launch; offline launches swallow the
  failure of both `register()` and `update()` silently (`void … .catch`).
- The 24-hour throttle no longer bounds propagation, but it does bound
  staleness of the *cache* if `update()` ever stops being called: the browser
  still re-checks on navigation on its own schedule.
- Devices frozen **before** this change (running a build without
  `update()`) stay frozen — they execute the old shell, which never asks
  for updates. One manual clear of site data recovers such a device; from
  then on updates flow automatically.
- `e2e/sw-update.spec.ts` pins the mechanism through the real build: a
  fixture server (the suite's one departure from "no mocks, no dev
  server" — it serves the actual `dist/index.html` and `dist/sw.js`, with
  only the shell marker and `CACHE_VERSION` swapped to emulate a redeploy)
  must see a returning device pick up a new build within two launches.
  Verified: dropping `update()` from `register-sw.ts` turns it red. The
  spec only covers propagation *given* an update call — it does not model
  the 24-hour throttle (a few launches inside one test run cannot cross it),
  so it should not be read as evidence about when the browser checks by
  itself.
- This record amends the consequence stated in
  [ADR-0002](0002-wire-protocol-contract.md) — "the service worker
  refreshes shells" — which held that shell refresh was timely; it is not a
  reversal of ADR-0002's decision to keep protocol v1 servable, which stays
  in force for shells that are still stale.
