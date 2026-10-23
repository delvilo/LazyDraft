import type { EditorId, ImageSource } from './contracts.ts';
import schema from './schema.json';

export interface AssetStore {
  storeImage(file: File): Promise<ImageSource>;
  inlineImages(html: string): Promise<string>;
}

interface StoredImageRecord {
  id: string;
  editor: EditorId;
  name: string;
  mime: string;
  blob: Blob;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB

export function openAssetStore(editor: EditorId, base: URL): AssetStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function getDatabase(): Promise<IDBDatabase> {
    if (dbPromise) {
      return dbPromise;
    }
    const pending = Promise.withResolvers<IDBDatabase>();
    const request = indexedDB.open(schema.database, schema.databaseVersion);
    let cancelled = false;

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(schema.imageStore)) {
        db.createObjectStore(schema.imageStore, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      if (cancelled) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        dbPromise = null;
      };
      pending.resolve(database);
    };
    request.onerror = () => {
      dbPromise = null;
      pending.reject(request.error ?? new Error('無法開啟圖片資料庫。'));
    };
    request.onblocked = () => {
      cancelled = true;
      dbPromise = null;
      pending.reject(new Error('圖片資料庫被其他分頁阻擋，請關閉該分頁後再試。'));
    };
    dbPromise = pending.promise;
    return pending.promise;
  }

  async function storeImage(file: File): Promise<ImageSource> {
    if (file.size > MAX_IMAGE_BYTES) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(2);
      throw new Error(`File "${file.name}" exceeds maximum allowed size of 5 MiB (${sizeMb} MiB).`);
    }
    if (file.size === 0) {
      throw new Error(`File "${file.name}" is empty.`);
    }

    const mime = await detectImageSignature(file);
    const blob = file.slice(0, file.size, mime);
    await verifyDecodability(blob);

    const db = await getDatabase();
    const id = crypto.randomUUID();
    const record: StoredImageRecord = {
      id,
      editor,
      name: file.name,
      mime,
      blob,
    };

    const pending = Promise.withResolvers<void>();
    const tx = db.transaction(schema.imageStore, 'readwrite');
    const store = tx.objectStore(schema.imageStore);

    store.put(record);

    tx.oncomplete = () => pending.resolve();
    tx.onerror = () => pending.reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => pending.reject(tx.error ?? new Error('IndexedDB transaction aborted'));

    await pending.promise;

    const baseHref = base.href.endsWith('/') ? base.href : `${base.href}/`;
    const src = `${baseHref}${schema.assetPath}${id}`;

    return {
      src,
      alt: file.name,
    };
  }

  async function inlineImages(html: string): Promise<string> {
    if (!html || typeof html !== 'string') {
      return '';
    }

    const parser = new DOMParser();
    const isFullDoc = /<html[\s>]/i.test(html);
    const doc = parser.parseFromString(html, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));

    if (images.length === 0) {
      return html;
    }

    const db = await getDatabase();

    for (const img of images) {
      const rawSrc = img.getAttribute('src');
      if (!rawSrc) continue;

      const assetId = extractOwnedAssetId(rawSrc, base);
      if (!assetId) {
        
        continue;
      }

      const record = await getImageRecord(db, assetId);
      if (!record || !record.blob) {
        throw new Error(`Missing owned asset image in IndexedDB: "${assetId}"`);
      }

      const blob = record.blob.type === record.mime ? record.blob : record.blob.slice(0, record.blob.size, record.mime);
      const dataUrl = await blobToDataURL(blob);
      img.setAttribute('src', dataUrl);
    }

    return isFullDoc ? doc.documentElement.outerHTML : doc.body.innerHTML;
  }

  return {
    storeImage,
    inlineImages,
  };
}

async function detectImageSignature(file: File): Promise<string> {
  const headerBuffer = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(headerBuffer);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }

  // WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  throw new Error(`Unsupported image format for "${file.name}". Only PNG, JPEG, WebP, and GIF are allowed.`);
}

async function verifyDecodability(blob: Blob): Promise<void> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const valid = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    if (!valid) {
      throw new Error('Image has zero dimensions');
    }
    return;
  }

  const pending = Promise.withResolvers<void>();
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      pending.resolve();
    } else {
      pending.reject(new Error('Image has zero dimensions'));
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    pending.reject(new Error('Image failed to decode'));
  };
  img.src = url;
  return pending.promise;
}

function extractOwnedAssetId(rawSrc: string, base: URL): string | null {
  if (!rawSrc) return null;
  try {
    const resolved = new URL(rawSrc, document.baseURI);
    if (resolved.origin !== base.origin) {
      return null;
    }
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    const assetPrefix = `${basePath}${schema.assetPath}`;
    if (!resolved.pathname.startsWith(assetPrefix)) {
      return null;
    }
    const id = resolved.pathname.slice(assetPrefix.length);
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function getImageRecord(db: IDBDatabase, id: string): Promise<StoredImageRecord | null> {
  const pending = Promise.withResolvers<StoredImageRecord | null>();
  const tx = db.transaction(schema.imageStore, 'readonly');
  const store = tx.objectStore(schema.imageStore);
  const req = store.get(id);

  req.onsuccess = () => {
    const result = req.result;
    if (isStoredImageRecord(result)) {
      pending.resolve(result);
    } else {
      pending.resolve(null);
    }
  };
  req.onerror = () => pending.reject(req.error ?? new Error(`Failed to read image ${id} from IndexedDB`));
  return pending.promise;
}

function isStoredImageRecord(val: unknown): val is StoredImageRecord {
  return (
    typeof val === 'object' &&
    val !== null &&
    'id' in val &&
    typeof val.id === 'string' &&
    'editor' in val &&
    typeof val.editor === 'string' &&
    'name' in val &&
    typeof val.name === 'string' &&
    'mime' in val &&
    typeof val.mime === 'string' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(val.mime) &&
    'blob' in val &&
    val.blob instanceof Blob
  );
}

function blobToDataURL(blob: Blob): Promise<string> {
  const pending = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      pending.resolve(reader.result);
    } else {
      pending.reject(new Error('FileReader did not return a string'));
    }
  };
  reader.onerror = () => pending.reject(reader.error ?? new Error('Failed to read blob as data URL'));
  reader.readAsDataURL(blob);
  return pending.promise;
}

