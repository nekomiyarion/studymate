// ============================================================
// Study Mate - Service Worker
// index.htmlを更新するたびにVERSIONを上げてください
// ============================================================
const VERSION = 'v1.0.0';
const CACHE_NAME = `studymate-${VERSION}`;
const UPDATE_CHECK_URL = 'https://nekomiyarion.github.io/studymate/index.html';

// オフライン時にキャッシュするファイル一覧
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './studymate.png',
    // CDNライブラリ（オフライン用）
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/vue@3/dist/vue.global.js',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
];

// ============================================================
// インストール：全リソースをキャッシュに保存
// ============================================================
self.addEventListener('install', (event) => {
    console.log(`[SW] Installing ${CACHE_NAME}`);
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // 個別にfetchしてエラーをスキップ（CDNが失敗しても継続）
            const results = await Promise.allSettled(
                ASSETS_TO_CACHE.map(url =>
                    fetch(url, { cache: 'reload' })
                        .then(res => res.ok ? cache.put(url, res) : Promise.resolve())
                        .catch(() => Promise.resolve())
                )
            );
            console.log('[SW] Cache complete');
        })
    );
    // 古いSWを待たずに即座に有効化
    self.skipWaiting();
});

// ============================================================
// アクティベート：古いキャッシュを削除
// ============================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating ${CACHE_NAME}`);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name.startsWith('studymate-') && name !== CACHE_NAME)
                    .map(name => {
                        console.log(`[SW] Deleting old cache: ${name}`);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// ============================================================
// フェッチ：キャッシュ優先、なければネットワーク
// ============================================================
self.addEventListener('fetch', (event) => {
    // POST等は無視
    if (event.request.method !== 'GET') return;
    
    // Firebase / Google API はキャッシュしない
    const url = event.request.url;
    if (
        url.includes('firebaseapp.com') ||
        url.includes('googleapis.com') ||
        url.includes('gstatic.com') ||
        url.includes('firebase.com') ||
        url.includes('firestore.googleapis.com')
    ) {
        return; // ブラウザのデフォルト処理に任せる
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // キャッシュヒット：バックグラウンドで更新も試みる（Stale-While-Revalidate）
                const fetchPromise = fetch(event.request)
                    .then(networkResponse => {
                        if (networkResponse && networkResponse.ok) {
                            const cloned = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
                        }
                        return networkResponse;
                    })
                    .catch(() => {});
                return cachedResponse;
            }
            // キャッシュなし：ネットワークから取得してキャッシュ保存
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.ok) {
                    const cloned = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
                }
                return networkResponse;
            }).catch(() => {
                // 完全オフライン：index.htmlのキャッシュを返す
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});

// ============================================================
// アップデートチェック（メインスレッドからのメッセージ）
// ============================================================
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CHECK_UPDATE') {
        checkForUpdate(event.source);
    }
});

async function checkForUpdate(client) {
    try {
        // 現在キャッシュされているindex.htmlを取得
        const cachedResponse = await caches.match('./index.html');
        const cachedText = cachedResponse ? await cachedResponse.text() : '';

        // サーバーから最新を取得
        const networkResponse = await fetch(UPDATE_CHECK_URL, {
            cache: 'no-cache',
            headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (!networkResponse.ok) {
            client && client.postMessage({ type: 'UPDATE_RESULT', hasUpdate: false });
            return;
        }
        
        const networkText = await networkResponse.text();
        
        // バージョン番号 or コンテンツで差分検出
        const hasUpdate = cachedText !== networkText;
        
        if (hasUpdate) {
            // 新しいキャッシュに保存
            const cache = await caches.open(CACHE_NAME);
            await cache.put('./index.html', new Response(networkText, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }));
            console.log('[SW] Update found and cached!');
        }
        
        client && client.postMessage({ type: 'UPDATE_RESULT', hasUpdate });
    } catch (e) {
        console.log('[SW] Update check failed (offline?):', e);
        client && client.postMessage({ type: 'UPDATE_RESULT', hasUpdate: false, error: true });
    }
}
