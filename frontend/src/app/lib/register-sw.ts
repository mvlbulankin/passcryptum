export const registerServiceWorker = () => {
  if (
    location.host &&
    !location.host.startsWith('localhost') &&
    'serviceWorker' in navigator
  ) {
    // Update on launch (ADR 0005). The worker serves the app shell
    // cache-first, and the browser's own update check is throttled (a
    // registered worker is re-checked on navigation, but at most once every
    // 24 hours), so a device can sit on a days-old cached build. update()
    // asks on every launch: a changed worker installs, skipWaiting activates
    // it, its activate rebuilds the cache, and the NEXT launch serves the
    // fresh shell. Both calls are best-effort — an offline launch must not
    // leave an unhandled rejection in the console, hence void + catch.
    void navigator.serviceWorker
      .register('/sw.js')
      .then(registration => registration.update())
      .catch(() => undefined)
  }
}
