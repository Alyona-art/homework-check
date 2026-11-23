const CACHE = 'homework-check-v3';
const APP_SHELL = [
  '/',
  '/teacher',
  '/student',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/manifest-teacher.webmanifest',
  '/manifest-student.webmanifest',
  '/icons/app-192.png',
  '/icons/app-512.png',
  '/icons/teacher-192.png',
  '/icons/teacher-512.png',
  '/icons/student-192.png',
  '/icons/student-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    const fallbackUrl = url.pathname.startsWith('/teacher')
      ? '/teacher'
      : url.pathname.startsWith('/student')
        ? '/student'
        : '/';
    event.respondWith(networkFirst(request, fallbackUrl));
    return;
  }

  event.respondWith(networkFirst(request));
});
