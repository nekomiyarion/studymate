// ============================================================
// Study Mate - Service Worker
// オフライン対応 + バックグラウンド同期
// ============================================================

const CACHE_NAME = 'studymate-v1';
const OFFLINE_QUEUE_KEY = 'studymate_offline_queue';

// キャッシュするリソース（アプリシェル）
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './studymate.png',
];

// Firebase SDK など外部CDNもキャッシュ対象
const CDN_CACHE_NAME = 'studymate-cdn-v1';
const CDN_HOSTS = [
  'www.gstatic.com',
  'cdn.tailwindcss.com',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ka-f.fontawesome.com',
];

// ── インストール：アプリシェルをキャッシュ ──
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure (OK):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── アクティベート：古いキャッシュを削除 ──
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== CDN_CACHE_NAME)
            .map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ── フェッチ：Cache-First（アプリシェル）/ Network-First（Firebase API）──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Firebase Firestore/Auth のリクエストはキャッシュしない（動的データ）
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com')) {
    // そのままネットワークへ（オフライン時はfailする→アプリ側のlocalStorageで対応）
    return;
  }

  // CDNリソース：Cache-First（長期キャッシュ）
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CDN_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((res) => {
            if (res && res.status === 200) {
              cache.put(event.request, res.clone());
            }
            return res;
          }).catch(() => cached); // オフライン時はキャッシュを返す
        });
      })
    );
    return;
  }

  // アプリシェル（index.html など）：Cache-First、なければネットワーク
  if (url.origin === self.location.origin || event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cached) => {
          // ネットワークから最新を取得しキャッシュ更新（バックグラウンド）
          const networkFetch = fetch(event.request).then((res) => {
            if (res && res.status === 200) {
              cache.put(event.request, res.clone());
            }
            return res;
          }).catch(() => null);

          // キャッシュがあれば即返し、バックグラウンドで更新
          return cached || networkFetch || caches.match('./index.html');
        });
      })
    );
    return;
  }
});

// ── メッセージ受信：アップデートチェック ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    // index.html をネットワークから取得して変化があれば通知
    fetch('./index.html', { cache: 'no-store' }).then((res) => {
      return res.text();
    }).then((newHtml) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return cache.match('./index.html').then((cached) => {
          if (!cached) return;
          return cached.text().then((cachedHtml) => {
            if (newHtml !== cachedHtml) {
              // キャッシュ更新
              caches.open(CACHE_NAME).then(c => {
                c.put('./index.html', new Response(newHtml, {
                  headers: { 'Content-Type': 'text/html' }
                }));
              });
              // クライアントに通知
              self.clients.matchAll().then((clients) => {
                clients.forEach(client => {
                  client.postMessage({ type: 'UPDATE_RESULT', hasUpdate: true });
                });
              });
            }
          });
        });
      });
    }).catch(() => {});
  }

  // 強制キャッシュクリア
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.source.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});

// ── バックグラウンド同期（sync イベント）──
self.addEventListener('sync', (event) => {
  if (event.tag === 'studymate-sync') {
    console.log('[SW] Background sync triggered');
    // 同期処理はクライアント側（index.html）で行うため、クライアントに通知
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach(client => {
          client.postMessage({ type: 'DO_SYNC' });
        });
      })
    );
  }
});
