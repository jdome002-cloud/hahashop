/* HAHA SHOP service worker — minimal and safe.
 * - Only same-origin GET requests are touched. Everything else (POST/PUT/DELETE, other origins) goes straight to the network.
 * - /api/*, /auth/*, /admin*, /uploads/*, /img/u/* (live product images), /healthz and /sw.js itself are never cached,
 *   so login, sessions, CSRF tokens, balances and purchases always come from the server.
 * - Page navigations: network first; the cached app shell is used only when offline.
 * - Static files (js/css/images/fonts/manifest): served from cache, refreshed in the background (stale-while-revalidate).
 * Bump VERSION whenever static files change to drop old caches.
 */
const VERSION = "hh-v10-1";
const STATIC_CACHE = VERSION + "-static";
const SHELL = "/";
const PRECACHE = [
  "/", "/style.css", "/theme.css", "/fx.css", "/hero.css", "/light.css",
  "/theme-init.js", "/i18n.js", "/image-prep.js", "/script.js", "/fx.js", "/hero.js", "/pwa.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/img/logo-mark-96.webp", "/img/logo-480.webp", "/favicon.ico",
];
const NEVER = [/^\/api\//, /^\/auth\//, /^\/admin/, /^\/uploads\//, /^\/img\/u\//, /^\/healthz/, /^\/sw\.js$/];
const STATIC_RE = /\.(?:js|css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|webmanifest)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hh-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(res) {
  if (!res || res.status !== 200 || res.type !== "basic") return false;
  const cc = res.headers.get("Cache-Control") || "";
  return !/no-store|private/i.test(cc) && !res.headers.has("Set-Cookie");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((re) => re.test(url.pathname))) return;

  // Pages: network first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable(res) && url.pathname === "/") {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || Response.error()))
    );
    return;
  }

  // Static assets: cache first, refresh in the background.
  if (STATIC_RE.test(url.pathname) && !url.search) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => { if (cacheable(res)) cache.put(req, res.clone()); return res; })
            .catch(() => hit || Response.error());
          if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
          return net;
        })
      )
    );
  }
  // Anything else: default browser handling (network).
});
