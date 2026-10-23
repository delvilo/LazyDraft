importScripts('js/libraries/cache-polyfill.js');

// Keep the existing namespace so renamed releases still remove obsolete caches.
const CACHE_PREFIX = 'notepad:' + self.registration.scope + ':';
const CACHE_VERSION = CACHE_PREFIX + 'v88';
let CACHE_FILES = [
    './',
    'index.html',
    'js/libraries/jquery.min.js',
    'js/libraries/bootstrap.min.js',
    'js/libraries/sweetalert2.all.min.js',
    'js/libraries/marked-18.1.1.umd.js',
    'js/libraries/purify-3.4.17.min.js',
    'js/libraries/prism-bundle.js',
    'js/syntax-worker.js',
    'js/syntax-highlighter.js?v=82',
    'css/syntax-highlight.css?v=80',
    'js/markdown-preview.js?v=78',
    'css/markdown-preview.css?v=79',
    'js/html-preview.js?v=78',
    'css/html-preview.css?v=80',
    'js/tabbypad-bridge.js?v=85',
    'js/ime/v87/boshiamy.js',
    'js/ime/v87/core.js',
    'js/ime/v87/textarea-controller.js',
    'js/ime/v87/candidate-view.js',
    'js/ime/v87/boshiamy-dict.json',
    'js/app.js?v=88',
    'js/utils.js?v=87',
    'js/selector.js?v=78',
    'css/bootstrap.min.css?v=78',
    'css/style.css?v=84',
    'css/boshiamy.css?v=80',
    'css/tabbypad-integration.css?v=78',
    'favicon.ico',
    'favicon-hidden.ico',
    'manifest.json',
    'img/icon-48.png',
    'img/icon-96.png',
    'img/icon-144.png',
    'img/icon-196.png',
    'img/icon-192.png',
    'img/icon-512.png',
    'img/notepad-apple-icon.png',
    'img/icon-mask.svg',
    'img/navbar/copy.svg',
    'img/navbar/delete.svg',
    'img/navbar/download.svg',
    'img/navbar/dark-theme.svg',
    'img/navbar/light-theme.svg',
    'img/navbar/pip.svg',
    'img/navbar/preferences.svg',
    'img/navbar/share.svg',
    'img/navbar/mic.svg',
    'img/navbar/dropdown.svg',
    'img/tooltip.svg',
    'fonts/OpenDyslexic-Regular.otf',
    'fonts/Cookie-Regular.ttf',
    'fonts/SpecialElite-Regular.ttf',
    'fonts/Schoolbell-Regular.ttf',
    'fonts/DepartureMono-Regular.otf'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function (cache) {
            // Reject an incomplete release instead of replacing a working worker.
            return cache.addAll(CACHE_FILES.map(function (url) {
                return new Request(new URL(url, self.registration.scope), { cache: 'reload' });
            }));
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const scope = new URL(self.registration.scope);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
    const relativePath = url.pathname.slice(scope.pathname.length);
    if (relativePath.startsWith('ai-regexr/')) return;

    const isEntryPage = event.request.mode === 'navigate'
        && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
    // Only navigations may discard query parameters. Asset versions must match.
    const cacheKey = isEntryPage ? new URL('index.html', scope).href : event.request;

    event.respondWith(
        fetch(event.request).catch(async function () {
            const cache = await caches.open(CACHE_VERSION);
            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) return cachedResponse;
            if (isEntryPage) {
                const entryPage = await cache.match(new URL('./', scope).href);
                if (entryPage) return entryPage;
            }
            // Never send HTML to a missing script or stylesheet request.
            return Response.error();
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(async function (key) {
                if (key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION) {
                    return caches.delete(key);
                }
                // Migrate this app's entries out of the old origin-wide caches.
                if (/^app-v\d+$/.test(key)) {
                    const cache = await caches.open(key);
                    const requests = await cache.keys();
                    await Promise.all(requests
                        .filter(request => request.url.startsWith(self.registration.scope))
                        .map(request => cache.delete(request)));
                    if ((await cache.keys()).length === 0) return caches.delete(key);
                }
            }));
        }).then(function () {
            return self.clients.claim();
        })
    );
});
