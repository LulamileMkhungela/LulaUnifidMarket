/* eslint-env serviceworker */
/**
 * ProVeri — service worker.
 *
 * Strategy, per resource class:
 *
 *   app shell + static assets  stale-while-revalidate: instant from cache,
 *                              refreshed in the background for next time
 *   /api/offline-bundle        network-first with a cache fallback — this is
 *                              what makes the marketplace render with zero
 *                              connectivity (catalogue, geography, snapshot)
 *   /api/* read routes         network-first, cache fallback when offline. A
 *                              marketplace must never show yesterday's quotes
 *                              or hide the job you posted a second ago.
 *   /api/* write routes        network-only; failed mutations are queued and
 *                              replayed on reconnect so a pro can submit proof
 *                              of work in a basement with no signal. Sign-in
 *                              requests are never queued — a code that arrives
 *                              an hour later is useless.
 *
 * The worker is served with Cache-Control: no-cache, so a deploy always wins.
 */

const VERSION = 'proveri-v6';   // v6: ProVeri rebrand — two-way reviews, member profiles, job cancel, 3-photo minimum
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const QUEUE_KEY = `${VERSION}-mutation-queue`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles/app.css',
  '/styles/microsite.css',
  '/js/api.js',
  '/js/icons.js',
  '/js/ui.js',
  '/js/app.js',
  '/js/screens-market.js',
  '/js/screens-shop.js',
  '/js/screens-work.js',
  '/js/screens-account.js',
  '/js/screens-verticals.js',
  '/js/screens-trust.js',
  '/js/screens-studio.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/favicon-32.png',
  '/fonts/jakarta-latin.woff2',
  '/fonts/bricolage-latin.woff2',
  '/offline.html',
];

const CACHEABLE_GET = /^\/api\/(snapshot|offline-bundle|categories|metros|provinces|price-band|geography|public|pros|portfolio|jobs|bookings|reviews|vehicles|webstudio|integrations|trust|stats|demo|notifications|tickets|verticals|banks|trade-registers|inbox|customers)/;
const NEVER_QUEUE = /^\/api\/(auth|catalogue\/resolve)/;
const MUTATION = /^(POST|PATCH|PUT|DELETE)$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'REPLAY_QUEUE') replayQueue();
});

/* ---------------- offline mutation queue ---------------- */

async function readQueue() {
  try {
    const raw = await (await self.caches.open(DATA_CACHE)).match('/__proveri-mutation-queue__');
    if (!raw) return [];
    return (await raw.json()) || [];
  } catch {
    return [];
  }
}

async function writeQueue(queue) {
  const cache = await caches.open(DATA_CACHE);
  await cache.put('/__proveri-mutation-queue__', new Response(JSON.stringify(queue), { headers: { 'Content-Type': 'application/json' } }));
}

async function enqueue(request) {
  const queue = await readQueue();
  queue.push({
    url: request.url,
    method: request.method,
    headers: Object.fromEntries([...request.headers.entries()].filter(([key]) => key.toLowerCase() !== 'content-length')),
    body: await request.clone().text(),
    queuedAt: Date.now(),
  });
  await writeQueue(queue.slice(-50));
}

async function replayQueue() {
  const queue = await readQueue();
  if (!queue.length) return { replayed: 0 };
  const results = [];
  for (const item of queue) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json', ...item.headers },
        body: item.body || undefined,
      });
      results.push({ url: item.url, ok: response.ok, status: response.status });
    } catch {
      results.push({ url: item.url, ok: false, status: 0 });
    }
  }
  await writeQueue([]);
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    for (const client of clients) client.postMessage({ type: 'QUEUE_REPLAYED', results });
  });
  return { replayed: results.length, results };
}

/* ---------------- fetch ---------------- */

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Writes: network-only, queued when offline so proof of work never gets lost.
  if (MUTATION.test(request.method) && url.pathname.startsWith('/api/')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request.clone());
        return response;
      } catch (error) {
        if (NEVER_QUEUE.test(url.pathname)) {
          return new Response(JSON.stringify({ offline: true, message: 'You are offline. Reconnect and try again.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        await enqueue(request.clone());
        return new Response(JSON.stringify({
          offline: true,
          queued: true,
          message: 'You are offline. The change is stored on this device and will be sent automatically the moment you reconnect.',
        }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  if (request.method !== 'GET') return;

  // The bundle that powers offline first paint.
  if (url.pathname === '/api/offline-bundle') {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      try {
        const fresh = await fetch(request);
        cache.put(url.pathname, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(url.pathname);
        return cached || new Response(JSON.stringify({ offline: true, cached: false }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Read-only API: network-first, so what you see is what is true; the cached
  // copy is only used when the network is not there.
  if (CACHEABLE_GET.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      const key = url.pathname + url.search;
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(key, response.clone());
        return response;
      } catch {
        const cached = await cache.match(key);
        return cached || new Response(JSON.stringify({ offline: true, message: 'You are offline and this has not been saved on your phone yet.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Navigation: app shell with an offline fallback page.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        cache.put('/index.html', response.clone());
        return response;
      } catch {
        return (await cache.match('/index.html')) || (await cache.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Everything else (assets, icons, fonts): stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => cached || Response.error());
    if (cached) {
      event.waitUntil(network.catch(() => null));
      return cached;
    }
    return network;
  })());
});
