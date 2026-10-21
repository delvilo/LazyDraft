#!/usr/bin/env node
/**
 * scripts/release-regexr.mjs
 * Static release manifest generator and Service Worker builder for AI-RegExr.
 *
 * Scans self-contained tool assets and vendor dependencies, computes deterministic
 * content hashes, and writes:
 * 1. ai-regexr/release-manifest.json (without volatile timestamps for reproducibility)
 * 2. ai-regexr/sw.js (with embedded expected SHA-256 hashes and integrity verification)
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const TOOL_DIR = resolve(ROOT_DIR, 'ai-regexr');

/**
 * Recursively collect files in a directory.
 * @param {string} dir
 * @returns {string[]} Absolute file paths
 */
function collectFilesRecursively(dir) {
    if (!existsSync(dir)) return [];
    /** @type {string[]} */
    const results = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectFilesRecursively(fullPath));
        } else if (entry.isFile()) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * Calculates SHA-256 hash of a file or buffer.
 * @param {string | Buffer} input
 * @returns {string} Hex hash
 */
function getSha256(input) {
    const data = typeof input === 'string' ? readFileSync(input) : input;
    return createHash('sha256').update(data).digest('hex');
}

async function buildRelease() {
    console.log('[release-regexr] Scanning tool assets in', TOOL_DIR);

    /** @type {Map<string, { fullPath: string, size: number, sha256: string }>} */
    const assetMap = new Map();

    // 1. Core tool page and stylesheet (must exist, throws if missing)
    const coreFiles = [
        'index.html',
        'css/style.css'
    ];
    for (const rel of coreFiles) {
        const full = join(TOOL_DIR, rel);
        if (!existsSync(full)) {
            throw new Error(`[release-regexr] Required core resource missing: ${rel} at ${full}`);
        }
        const stat = statSync(full);
        assetMap.set(rel, { fullPath: full, size: stat.size, sha256: getSha256(full) });
    }

    // 2. JavaScript modules
    const jsDir = join(TOOL_DIR, 'js');
    if (!existsSync(jsDir)) {
        throw new Error(`[release-regexr] Required js directory missing: ${jsDir}`);
    }
    const jsFiles = collectFilesRecursively(jsDir).filter(f => f.endsWith('.js'));
    for (const file of jsFiles) {
        const rel = relative(TOOL_DIR, file).replace(/\\/g, '/');
        const stat = statSync(file);
        assetMap.set(rel, { fullPath: file, size: stat.size, sha256: getSha256(file) });
    }

    // 3. Vendor assets
    const vendorDir = join(TOOL_DIR, 'vendor');
    if (existsSync(vendorDir)) {
        const vendorFiles = collectFilesRecursively(vendorDir);
        for (const file of vendorFiles) {
            const rel = relative(TOOL_DIR, file).replace(/\\/g, '/');
            const stat = statSync(file);
            assetMap.set(rel, { fullPath: file, size: stat.size, sha256: getSha256(file) });
        }
    }

    // 4. Parent resources with explicit relative paths (must exist, throws if missing)
    const parentResources = [
        '../favicon.ico',
        '../img/notepad-apple-icon.png'
    ];
    for (const rel of parentResources) {
        const full = resolve(TOOL_DIR, rel);
        if (!existsSync(full)) {
            throw new Error(`[release-regexr] Required parent resource missing: ${rel} at ${full}`);
        }
        const stat = statSync(full);
        assetMap.set(rel, { fullPath: full, size: stat.size, sha256: getSha256(full) });
    }

    // Sort manifest keys deterministically
    const sortedKeys = Array.from(assetMap.keys()).sort();

    // Include generator source hash so generator/SW policy changes trigger a new release version
    const generatorSourceHash = getSha256(__filename);

    // Compute combined release hash from individual file hashes and generator source hash
    const hashStream = createHash('sha256');
    hashStream.update(`generator:${generatorSourceHash}\n`);
    for (const key of sortedKeys) {
        const item = assetMap.get(key);
        hashStream.update(`${key}:${item?.sha256}\n`);
    }
    const combinedHash = hashStream.digest('hex');
    const releaseVersion = `regexr-v${combinedHash.slice(0, 12)}`;

    // Generate release-manifest.json content (NO volatile timestamp for strict reproducibility)
    const manifestAssets = sortedKeys.map(key => {
        const item = assetMap.get(key);
        return {
            path: key,
            size: item?.size,
            sha256: item?.sha256
        };
    });

    const manifestData = {
        version: releaseVersion,
        assetCount: sortedKeys.length,
        assets: manifestAssets
    };

    const manifestJsonString = JSON.stringify(manifestData, null, 2) + '\n';
    const manifestSha256 = getSha256(Buffer.from(manifestJsonString, 'utf8'));

    const manifestPath = join(TOOL_DIR, 'release-manifest.json');
    writeFileSync(manifestPath, manifestJsonString, 'utf8');
    console.log(`[release-regexr] Generated ${manifestPath} (version: ${releaseVersion}, ${sortedKeys.length} assets)`);

    // Build precache entries array with explicit url and expected sha256
    /** @type {Array<{ url: string, sha256: string }>} */
    const indexItem = assetMap.get('index.html');
    if (!indexItem) throw new Error('[release-regexr] index.html not found in assetMap');

    const precacheEntries = [
        { url: './', sha256: indexItem.sha256 }
    ];
    for (const key of sortedKeys) {
        const item = assetMap.get(key);
        if (item) {
            precacheEntries.push({ url: key, sha256: item.sha256 });
        }
    }
    precacheEntries.push({ url: 'release-manifest.json', sha256: manifestSha256 });

    // Generate ai-regexr/sw.js with hash verification and install marker
    const swCode = `/**
 * AI-RegExr Independent Scoped Service Worker
 * Generated by scripts/release-regexr.mjs
 * Version: ${releaseVersion}
 */

const CACHE_PREFIX = 'ai-regexr:' + self.registration.scope + ':';
const RELEASE_VERSION = '${releaseVersion}';
const CACHE_NAME = CACHE_PREFIX + RELEASE_VERSION;
const INSTALL_MARKER = '__RELEASE_COMPLETE__';

/** @type {Array<{ url: string, sha256: string }>} */
const PRECACHE_ENTRIES = ${JSON.stringify(precacheEntries, null, 4)};

/** @type {Map<string, string>} */
const PRECACHE_MAP = new Map(PRECACHE_ENTRIES.map(function (entry) {
    return [new URL(entry.url, self.registration.scope).href, entry.sha256];
}));

/**
 * Computes SHA-256 hex string from an ArrayBuffer using Web Crypto.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
async function computeSha256(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);

            // Fetch and verify every asset before storing
            for (const entry of PRECACHE_ENTRIES) {
                const reqUrl = new URL(entry.url, self.registration.scope);
                const request = new Request(reqUrl, { cache: 'reload' });
                const response = await fetch(request);
                if (!response.ok) {
                    throw new Error('Failed to fetch ' + entry.url + ': HTTP ' + response.status);
                }
                const buffer = await response.arrayBuffer();
                const actualHash = await computeSha256(buffer);
                if (actualHash !== entry.sha256) {
                    throw new Error('Integrity check failed for ' + entry.url + ': expected ' + entry.sha256 + ', got ' + actualHash);
                }
                await cache.put(request, new Response(buffer, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                }));
            }

            // Verify every expected asset exists in cache
            for (const entry of PRECACHE_ENTRIES) {
                const reqUrl = new URL(entry.url, self.registration.scope);
                const match = await cache.match(reqUrl.href);
                if (!match) {
                    throw new Error('Verification failed: missing cached asset ' + entry.url);
                }
            }

            // All assets verified; write completion marker
            const markerUrl = new URL(INSTALL_MARKER, self.registration.scope);
            await cache.put(new Request(markerUrl), new Response('OK', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' }
            }));
            // No skipWaiting: allow current tabs to continue running old version undisturbed.
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // Default lifecycle: clean up obsolete tool caches belonging to this scope
            const keys = await caches.keys();
            await Promise.all(
                keys.map((key) => {
                    if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
            // First claim okay: control unmanaged initial clients immediately
            await self.clients.claim();
        })()
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const scope = new URL(self.registration.scope);

    // Only handle requests originating from same origin
    if (url.origin !== scope.origin) return;

    const isNavigation = event.request.mode === 'navigate' &&
        (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');

    const requestHref = event.request.url;
    const isKnownAsset = PRECACHE_MAP.has(requestHref);

    // Bypass requests outside tool scope and not in precached release assets
    if (!isNavigation && !isKnownAsset) {
        if (!url.pathname.startsWith(scope.pathname)) return;
    }

    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);

            // Navigations serve index.html (or ./) from release cache
            if (isNavigation) {
                const cachedIndex = (await cache.match(new URL('index.html', scope).href))
                    || (await cache.match(new URL('./', scope).href));
                if (cachedIndex) return cachedIndex;
                return Response.error();
            }

            // Known release assets must come strictly from release cache (no mixed release fallback)
            if (isKnownAsset) {
                const cached = await cache.match(event.request, { ignoreSearch: false });
                if (cached) return cached;
                return Response.error();
            }

            // Arbitrary URLs inside scope: attempt network fetch
            try {
                return await fetch(event.request);
            } catch (_) {
                return Response.error();
            }
        })()
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CHECK_CACHE_STATUS') {
        (async () => {
            try {
                const hasCache = await caches.has(CACHE_NAME);
                if (!hasCache) {
                    event.ports[0]?.postMessage({
                        type: 'CACHE_STATUS',
                        version: RELEASE_VERSION,
                        ready: false
                    });
                    return;
                }
                const cache = await caches.open(CACHE_NAME);
                const marker = await cache.match(new URL(INSTALL_MARKER, self.registration.scope).href);
                const ready = Boolean(marker && marker.ok);
                event.ports[0]?.postMessage({
                    type: 'CACHE_STATUS',
                    version: RELEASE_VERSION,
                    ready: ready
                });
            } catch (_) {
                event.ports[0]?.postMessage({
                    type: 'CACHE_STATUS',
                    version: RELEASE_VERSION,
                    ready: false
                });
            }
        })();
    }
});
`;

    const swPath = join(TOOL_DIR, 'sw.js');
    writeFileSync(swPath, swCode, 'utf8');
    console.log(`[release-regexr] Generated ${swPath} successfully.`);
}

buildRelease().catch((err) => {
    console.error('[release-regexr] Error:', err);
    process.exit(1);
});
