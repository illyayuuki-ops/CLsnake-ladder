const CACHE_VERSION = 'v3';
const CACHE_NAME = `snakes-ladders-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './loader2.css',
  './app.js',
  './loade2r.js',
  './game-engine.js',
  './assets/favicon.svg',
  './assets/fonts/dm-sans-latin.woff2',
  './manifest.webmanifest',
  './logo.png',
  './vendor/qrcode.min.js',
];

const BOARD_IMAGES = Array.from({ length: 20 }, (_, i) =>
  `./snakes-and-ladders-board-${String(i + 1).padStart(2, '0')}.jpg`
);

const FANTASY_IMAGES = Array.from({ length: 20 }, (_, i) =>
  `./assets/fantasy/board-${String(i + 1).padStart(2, '0')}.webp`
);

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(APP_SHELL.map(f => cache.add(f)));
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    console.warn('[SW] Some APP_SHELL resources failed to precache:', failed.map((r, i) => `${APP_SHELL[i]}: ${r.reason}`));
  }
}

async function cleanOldCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter(name => name.startsWith('snakes-ladders-') && name !== CACHE_NAME)
      .map(name => caches.delete(name))
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'Network required' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    precacheAppShell().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    cleanOldCaches().then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // networkFirst for app code, HTML, manifest, SW itself
  const isNavigate = request.mode === 'navigate';
  const isScript = request.destination === 'script';
  const isStyle = request.destination === 'style';
  const isManifest = url.pathname.endsWith('/manifest.webmanifest');
  const isSW = url.pathname.endsWith('/sw.js');
  const isIndexHTML = url.pathname === '/' || url.pathname === '/index.html';

  if (isNavigate || isScript || isStyle || isManifest || isSW || isIndexHTML) {
    event.respondWith(networkFirst(request));
    return;
  }

  const isBoardImage = BOARD_IMAGES.some(img => url.pathname.endsWith(img.replace('./', '/')));
  const isFantasyImage = FANTASY_IMAGES.some(img => url.pathname.endsWith(img.replace('./', '/')));
  const isFont = request.destination === 'font';

  if (isBoardImage || isFantasyImage || isFont || request.destination === 'image') {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});