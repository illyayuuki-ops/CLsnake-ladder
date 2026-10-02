const CACHE_VERSION = 'v1';
const CACHE_NAME = `snakes-ladders-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './game-engine.js',
  './assets/favicon.svg',
  './assets/fonts/dm-sans-latin.woff2',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-512-maskable.png',
];

const BOARD_IMAGES = Array.from({ length: 20 }, (_, i) =>
  `./snakes-and-ladders-board-${String(i + 1).padStart(2, '0')}.jpg`
);

const FANTASY_IMAGES = Array.from({ length: 20 }, (_, i) =>
  `./assets/fantasy/board-${String(i + 1).padStart(2, '0')}.webp`
);

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
}

async function cleanOldCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter(name => name.startsWith('snakes-ladders-') && name !== CACHE_NAME)
      .map(name => caches.delete(name))
  );
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

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  const isBoardImage = BOARD_IMAGES.some(img => url.pathname.endsWith(img.replace('./', '/')));
  const isFantasyImage = FANTASY_IMAGES.some(img => url.pathname.endsWith(img.replace('./', '/')));

  if (isBoardImage || isFantasyImage || request.destination === 'image' || request.destination === 'font' || request.destination === 'style' || request.destination === 'script') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached => cached || fetch(request))
    );
    return;
  }

  event.respondWith(cacheFirst(request));
});