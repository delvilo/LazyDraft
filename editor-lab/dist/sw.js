const RELEASE = {"version":"e5bbbec4f87baa53f505","files":[{"path":"THIRD_PARTY_NOTICES.txt","sha256":"3ba09c465be12e420329e73998854616d04c1ceb8bdd4bd88c3e619894781334"},{"path":"assets/app-C4hp0y_2.css","sha256":"5c9f5d3f26aaa5a28232440f19c0c545deec5298b32a8de67ee4f82ec82cad3b"},{"path":"assets/app-DSlhIy1G.js","sha256":"0d53f7bb1e1c0e5b4807e2c322347d3de3e343c122df2efe1e0ebe7631f4ba3d"},{"path":"assets/editorjs-BWAgBKKF.js","sha256":"e2a54d33542d56b30358703dbc5bb77f41efdd72c43e6a0765b8d9cdc2f9810b"},{"path":"assets/lexical-O6DscQTb.js","sha256":"d5896e60b0f2a31e3120b75a13df7fcf63a23a53a1e108d8f942ffd5770d373f"},{"path":"assets/rolldown-runtime-WkwZ5CU-.js","sha256":"2629f2ad3cb75a57d98de697127f5af7d777ef572bbcdfa6e3ce8f438cd4527e"},{"path":"assets/squire-DWd5RBZ3.js","sha256":"188f90920a59f4c48521dd2898627bec989d51cbae59199103140b0ba7ef1efe"},{"path":"assets/tiptap-BCL9K5RZ.js","sha256":"35383e80236cedcaff49b1bb9c5a9a5d61e0ea4192ff4edd94f9cbc1c23737d7"},{"path":"assets/tiptap-Dee3NewH.css","sha256":"4cb96febb9323596b46d4b33395ce67669419fea7a87ea9606fba066fba37a49"},{"path":"assets/trix-BHHJkEUP.css","sha256":"1b405f01596f90a0b33197c020eed50e6fe6a2f9702877c611e09ef9c6fe6f9c"},{"path":"assets/trix-BsMMgtiE.js","sha256":"5d02cb9318831c81ca3d411676b1656cce938d29bce6248d42e147f406726dc2"},{"path":"assets/trumbowyg-BWon2-xz.js","sha256":"0b60eadc5c494961d135ee8182769ca56ac93904b5e34ef6973d0e63de16cf13"},{"path":"assets/trumbowyg-CrH7d0ev.js","sha256":"722c13974b5eb3d0d097c32f31c9c32ced4aa7c159ab1e05df6a6deeca0abc4d"},{"path":"assets/trumbowyg-rajbXNs8.css","sha256":"fb6bd91a9b7dac4b5e64128dfe516c226c3cdf523e2ae8b28a249f4d5beacfcf"},{"path":"assets/trumbowyg.history-CNWCUj6s.js","sha256":"f7bd2fa9ca3ea43f306d07100d5449975e8ebd8d307db9380ab82bfaf378c894"},{"path":"assets/trumbowyg.preformatted-DuzITMLl.js","sha256":"8d0e42eb1bbf276ccb51ae038b8ce64fe3573fc36d1eafbb4f5095b4f3aebfd3"},{"path":"editorjs/index.html","sha256":"1d6aa8804f1548834e2281958988738f980a70bb11d7329a1ef7a04707130605"},{"path":"index.html","sha256":"f9b25cf35feff080a19a7d1fbef160256a38147189ad10814300009a8efc5a62"},{"path":"lexical/index.html","sha256":"3c6881d2af0f3c538c0bd30fbe9b9578e6b85d6033b2b7e2ccd060c97956edb4"},{"path":"squire/index.html","sha256":"192a55fdd813040c2c6a494c109a16dc1055dac9033b05f9f7499963ba7c29c8"},{"path":"tiptap/index.html","sha256":"3dabbebe3b99176e991a7064cf399b6eafeb503c529beb1ff3691235259bdebb"},{"path":"trix/index.html","sha256":"d2294372446319127201badf22f53bdb59ae4eecf10252f289ff577a4908d86f"},{"path":"trumbowyg/index.html","sha256":"2f154dab28a2721459197a995cb4948fcd616dde00227a1438af3294306edba0"},{"path":"release.json","sha256":"885d4d2cf597e1ca0b36a82440ee5d2a095aa18a6d8b9423473a9975c3dbc453"}]};
const SCHEMA = {"database":"lazydraft-editor-lab-assets","databaseVersion":1,"imageStore":"images","draftPrefix":"lazydraft-editor-lab:v1:draft:","themeKey":"lazydraft-editor-lab:v1:theme","assetPath":"__images/","cachePrefix":"lazydraft-editor-lab:"};
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
