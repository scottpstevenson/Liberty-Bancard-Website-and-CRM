// RELEASE_SHA is injected at build time via vite define; falls back to a
// timestamp so that local dev always gets a fresh cache without a build step.
/* global __RELEASE_SHA__ */
const _sha =
  (typeof __RELEASE_SHA__ !== "undefined" && __RELEASE_SHA__) ||
  "dev-" + self.registration.scope.replace(/[^a-z0-9]/gi, "").slice(-8) + "-" + Date.now();

const CACHE_NAME = "lb-mobile-" + _sha;
// Private CRM reads are never stored by this worker. A URL-keyed copy of /api/contacts, /api/deals, /api/tasks or
// /api/appointments would outlive logout and an actor change on a shared device and could be shown to the next
// person. The only cache this worker owns is the public app shell below; any "lb-api-*" cache left by an earlier
// release is deleted on activation and on request (PURGE_PRIVATE_CACHES).
const PRIVATE_CACHE_PREFIX = "lb-api-";

const STATIC_ASSETS = ["/mobile", "/mobile/login", "/favicon.png"];
const PRIVATE_APIS = ["/api/contacts", "/api/deals", "/api/tasks", "/api/appointments"];

function purgePrivateCaches() {
  return caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k.startsWith(PRIVATE_CACHE_PREFIX)).map((k) => caches.delete(k)))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        // Delete ALL caches from previous releases (including every private API cache), keeping only this shell cache.
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Track chunk-load failures to provide a one-time bounded recovery.
// Key: URL, value: timestamp of first 404 for that asset.
const _chunkFailures = new Map();
const CHUNK_RECOVERY_WINDOW_MS = 10_000; // 10 s — try reload once per asset

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ── Private CRM reads: network only, never stored or replayed ────────────
  // An unreachable network is an explicit 503 so the UI shows an unavailable state, never stale or empty data.
  if (PRIVATE_APIS.some((api) => url.pathname === api || url.pathname.startsWith(api + "/"))) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(
        JSON.stringify({ error: "protected_read_unavailable" }),
        { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      ))
    );
    return;
  }

  // ── Navigation requests: network-first, offline fallback to shell ────────
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/mobile").then((r) => r || fetch(event.request))
      )
    );
    return;
  }

  // ── Hashed JS/CSS chunks: serve from network; on 404 attempt one reload ──
  if (
    event.request.method === "GET" &&
    /\.(js|css)$/.test(url.pathname) &&
    url.pathname.includes("/assets/")
  ) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.status === 404) {
          const key = url.href;
          const now = Date.now();
          const firstFailAt = _chunkFailures.get(key);
          if (!firstFailAt) {
            _chunkFailures.set(key, now);
            // Tell all clients to reload once to pick up the new shell.
            self.clients.matchAll({ type: "window" }).then((clients) => {
              clients.forEach((c) => c.postMessage({ type: "CHUNK_NOT_FOUND" }));
            });
          }
          // Return the 404 so ErrorBoundary can display a truthful error
          // rather than an infinite spinner.
          return res;
        }
        return res;
      })
    );
    return;
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  // Sent on logout and on a change of signed-in person; clears any private cache an older release left behind.
  if (event.data?.type === "PURGE_PRIVATE_CACHES") event.waitUntil(purgePrivateCaches());
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Liberty Bancard";
  const options = {
    body: data.body || "You have a new notification",
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: data.url ? { url: data.url } : {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/mobile";
  event.waitUntil(clients.openWindow(url));
});
