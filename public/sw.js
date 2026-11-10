/*
 * CLUB JOIA 300 service worker.
 *
 * Caching policy (deliberately conservative — this is a private members app):
 *   - Static, non-personal assets (/_next/static, /brand, /icons, fonts): cache-first.
 *   - The public programme JSON (/api/events/<slug>/programme): network-first, cached for offline.
 *   - Page navigations: network only; on failure show the cached /offline page.
 *   - Everything else — especially /api/tickets/<n>/qr (QR tokens), /api/files, /api/me — is
 *     NEVER cached. QR credentials only ever live in page memory.
 *   - Push notifications: shows the notification and focuses / opens the deep link on click.
 */
const VERSION = "joia-v1";
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/brand/club-joia-logo-white.svg", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/"));

const isPublicProgramme = (url) => url.origin === self.location.origin && /^\/api\/events\/[^/]+\/programme$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(STATIC_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (isPublicProgramme(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(DATA_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.json({ error: "offline" }, { status: 503 }))),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
  // All other requests go straight to the network (no caching).
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CLUB JOIA 300", body: event.data ? event.data.text() : "" };
  }
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/notifications";
  event.waitUntil(
    self.registration.showNotification(data.title || "CLUB JOIA 300", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag: data.tag,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
