// オフラインでも開けるようにするための Service Worker。
// ページはネットワーク優先(新しい版をすぐ反映)、ハッシュ付きの assets はキャッシュ優先
const CACHE = 'danceclip';
// module script は Origin 付きで要求されるので、Vary: Origin があると素直な照合では外れる
const MATCH = { ignoreVary: true };
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png', './THIRD_PARTY_LICENSES.txt'];

async function buildFiles() {
  const res = await fetch('./precache.json', { cache: 'no-store' });
  return res.ok ? (await res.json()).map((f) => './' + f) : [];
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll([...SHELL, ...(await buildFiles())]);
    })(),
  );
});

// 古い版の assets を消す
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      const keep = new Set([...SHELL, ...(await buildFiles())].map((u) => new URL(u, self.registration.scope).href));
      const c = await caches.open(CACHE);
      for (const req of await c.keys()) if (new URL(req.url).pathname.includes('/assets/') && !keep.has(req.url)) await c.delete(req);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
          return res;
        } catch {
          return (await caches.match(req, MATCH)) || (await caches.match('./index.html', MATCH)) || Response.error();
        }
      })(),
    );
    return;
  }

  e.respondWith(
    (async () => {
      const hit = await caches.match(req, MATCH);
      const refresh = fetch(req)
        .then(async (res) => {
          if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        if (!url.pathname.includes('/assets/')) e.waitUntil(refresh);
        return hit;
      }
      return (await refresh) || Response.error();
    })(),
  );
});
