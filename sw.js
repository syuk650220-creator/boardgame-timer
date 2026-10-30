'use strict';
/* =========================================================
 * サービスワーカー（オフライン対応）
 *  - https で公開したときだけ使われます（PC から配信している間は使われません）
 *  - ネットにつながるときは最新のファイルを取りに行き、
 *    つながらないとき（機内モードなど）は保存しておいたファイルで起動します
 * ========================================================= */

const CACHE_NAME = 'bgtimer-v1';
const NETWORK_TIMEOUT_MS = 3000;

const APP_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/util.js',
  './js/settings.js',
  './js/sound.js',
  './js/timer.js',
  './js/picker.js',
  './js/device.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    throw err;
  }
}

// ※ ページ移動のリクエストは fetch(request, { signal }) の形にできないため、時間切れは Promise で判定する
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      response => { clearTimeout(timer); resolve(response); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}
