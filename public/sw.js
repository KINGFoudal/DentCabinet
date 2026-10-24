/* Service worker Nimba Dentaire : rend l'application utilisable hors ligne.
 *
 * - /_next/static et les icônes : cache d'abord (fichiers versionnés).
 * - Pages et données RSC du même domaine : réseau d'abord, cache en secours.
 * - Les appels Supabase (autre domaine) et /api ne sont jamais mis en cache :
 *   les données hors ligne sont dans IndexedDB.
 */
const VERSION = "v1";
const STATIC_CACHE = `nimba-static-${VERSION}`;
const PAGE_CACHE = `nimba-pages-${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// L'application envoie la liste des pages à préparer pour le hors ligne après la connexion.
self.addEventListener("message", (event) => {
  if (event.data?.type === "warm" && Array.isArray(event.data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        await Promise.all(
          event.data.urls.map((u) =>
            fetch(u, { credentials: "same-origin" })
              .then((r) => (r.ok ? cache.put(u, r) : undefined))
              .catch(() => undefined),
          ),
        );
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    if (req.mode === "navigate") {
      const shell = await cache.match("/app");
      if (shell) return shell;
    }
    throw e;
  }
}
