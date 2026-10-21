// PayPerWatch service worker: keeps the app shell (and the Downloads page) available offline.
// Videos themselves live in IndexedDB; this only caches pages and static assets.
const CACHE = "ppw-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/library"]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return; // never cache money or video

  // Hashed build assets and fonts: cache-first.
  if (url.pathname.startsWith("/_next/static/") || /\.(woff2?|otf|ico|svg|png)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network-first; offline falls back to the cached page, then to Downloads.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === "/library") caches.open(CACHE).then((c) => c.put("/library", res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/library"))),
    );
  }
});
