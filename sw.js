// ── Triple.Cell 牌卡抽牌 Service Worker ──
// 每次更新只需改這個版本號，舊的 cache 會自動清除
const CACHE_VERSION = 'v14';
const CACHE_NAME = `triplecell-${CACHE_VERSION}`;

// 安裝時預先快取的核心靜態資源
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/tarot-data.js',
  './js/deity-data.js',
  './icons.png',
];

// ── Install：快取核心資源 ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()) // 立刻取代舊版 SW
  );
});

// ── Activate：清除舊版 cache ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // 立刻接管所有頁面
  );
});

// ── Fetch 策略 ──
self.addEventListener('fetch', event => {
  // 只處理 GET，忽略 POST 等
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 圖片：Cache First（快，圖片不常變）
  if (
    event.request.destination === 'image' ||
    url.pathname.includes('/images/')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML / JS / CSS：Network First（優先取得最新版，離線才用 cache）
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
