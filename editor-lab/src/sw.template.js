const RELEASE = __EDITOR_LAB_RELEASE__;
const SCHEMA = __EDITOR_LAB_SCHEMA__;
const base = new URL(self.registration.scope);
const cachePrefix = `${SCHEMA.cachePrefix}${base.href}:`;
const cacheName = `${cachePrefix}${RELEASE.version}`;
const completionURL = new URL('__complete__', base).href;
const entries = new Map(RELEASE.files.map((file) => [file.path, file]));
let preparing;

async function announce(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) if (client.url.startsWith(base.href)) client.postMessage(message);
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function prepare() {
  const cache = await caches.open(cacheName);
  const complete = await cache.match(completionURL);
  if (complete && await complete.text() === RELEASE.version) {
    const paths = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    if (RELEASE.files.every((file) => paths.has(new URL(file.path, base).pathname))) {
      await announce({ type: 'READY', version: RELEASE.version });
      return;
    }
  }
  await cache.delete(completionURL);
  let done = 0;
  const queue = [...RELEASE.files];
  let failure;
  const fill = async () => {
    while (queue.length && !failure) {
      const file = queue.shift();
      try {
        const url = new URL(file.path, base).href;
        let response = await cache.match(url);
        if (response && await digest(await response.clone().arrayBuffer()) !== file.sha256) response = undefined;
        if (!response) {
          response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
          if (!response.ok || await digest(await response.clone().arrayBuffer()) !== file.sha256) {
            throw new Error(`無法完整快取 ${file.path}。`);
          }
          await cache.put(url, response);
        }
        done += 1;
        await announce({ type: 'PROGRESS', done, total: RELEASE.files.length });
      } catch (error) {
        failure = error;
        throw error;
      }
    }
  };
  await Promise.allSettled(Array.from({ length: Math.min(4, queue.length) }, fill));
  if (failure) throw failure;
  await cache.put(completionURL, new Response(RELEASE.version));
  await announce({ type: 'READY', version: RELEASE.version });
}

function prepareAll() {
  if (!preparing) {
    preparing = prepare().catch(async (error) => {
      await announce({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) });
      throw error;
    }).finally(() => { preparing = undefined; });
  }
  return preparing;
}

self.addEventListener('install', (event) => {
  if (self.registration.active) event.waitUntil(prepareAll());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const complete = await (await caches.open(cacheName)).match(completionURL);
    if (complete && await complete.text() === RELEASE.version) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName).map((name) => caches.delete(name)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PREPARE_OFFLINE') {
    event.waitUntil((async () => {
      await self.clients.claim();
      await prepareAll();
    })());
  }
});

function openImages() {
  const { promise, resolve, reject } = Promise.withResolvers();
  const request = indexedDB.open(SCHEMA.database, SCHEMA.databaseVersion);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(SCHEMA.imageStore)) {
      request.result.createObjectStore(SCHEMA.imageStore, { keyPath: 'id' });
    }
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('圖片資料庫升級受到其他分頁阻擋。'));
  request.onsuccess = () => resolve(request.result);
  return promise;
}

async function imageResponse(id) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return new Response('Invalid image identifier', { status: 400 });
  let database;
  try {
    database = await openImages();
    const { promise, resolve, reject } = Promise.withResolvers();
    const transaction = database.transaction(SCHEMA.imageStore, 'readonly');
    const request = transaction.objectStore(SCHEMA.imageStore).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
    const record = await promise;
    if (!record || !(record.blob instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(record.mime)) {
      return new Response('Image not found', { status: 404 });
    }
    return new Response(record.blob, {
      headers: {
        'Content-Type': record.mime,
        'Content-Length': String(record.blob.size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Image storage unavailable', { status: 503 });
  } finally {
    database?.close();
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const relative = url.pathname.slice(base.pathname.length);
  if (relative.startsWith(SCHEMA.assetPath)) {
    event.respondWith(imageResponse(relative.slice(SCHEMA.assetPath.length)));
    return;
  }
  const path = relative === '' || relative.endsWith('/') ? `${relative}index.html` : relative;
  if (!entries.has(path)) return;
  event.respondWith((async () => {
    const response = await (await caches.open(cacheName)).match(new URL(path, base).href);
    return response || fetch(event.request);
  })());
});
