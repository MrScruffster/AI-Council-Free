/* AI Council service worker: makes the app SHELL installable and able to load offline. It is not an offline chat:
   AI answers always need the network (and the user's API key), so anything that is not a plain same-origin page/asset
   request is left completely alone. In particular:
     - /api/*            passes straight through, never cached (the Worker's API, if this page is served from it)
     - other origins     (AI providers, CDNs for Pyodide / Ajv, the counter Worker) pass straight through
     - non-GET requests  pass straight through
   Strategy:
     - the page itself (navigations, index.html): NETWORK-FIRST, so a visitor always gets the newest version when online and the
       saved copy only when offline. (Cache-first here would keep showing an old version after every deploy.)
     - icons and the manifest: cache-first, refreshed in the background.
   Bump CACHE when the list of shell files changes; old caches are deleted on activate. */
const CACHE = "aicouncil-shell-v2";
const SHELL = ["./", "index.html", "manifest.json", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("aicouncil-shell-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // providers, CDNs, the counter Worker: never touched
  if (url.pathname.includes("/api/")) return;         // never cache API traffic

  const isPage = req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html");
  if (isPage) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: "no-cache" });   // revalidate: skip the browser's own 10-minute HTTP cache too
        if (res && res.ok && res.type === "basic") cache.put(req.mode === "navigate" ? "index.html" : req, res.clone());
        return res;
      } catch (_) {
        const saved = (await cache.match(req, { ignoreSearch: true })) || (await cache.match("index.html"));
        if (saved) return saved;
        return new Response("Offline, and this page isn't saved yet.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { event.waitUntil(network); return cached; }   // cache-first; refreshed in the background
      const res = await network;
      return res || new Response("Offline, and this file isn't saved yet.", { status: 503, headers: { "Content-Type": "text/plain" } });
    })
  );
});
