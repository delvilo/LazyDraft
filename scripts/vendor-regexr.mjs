/**
 * @fileoverview Vendor reproducibility tooling for AI-RegExr.
 *
 * Default execution (`npm run vendor` or `node scripts/vendor-regexr.mjs`):
 *   Verifies checked-in vendor artifacts and shim source against the committed manifest.
 *
 * Rebuild execution (`npm run vendor -- --build` or `node scripts/vendor-regexr.mjs --build`):
 *   Downloads pinned PCRE2 source from git (tag pcre2-10.49, commit 6f9d7c1373262c541324a16a358785b33ef116cf),
 *   builds libpcre2-8.a with emcmake cmake, compiles scripts/pcre2_shim.c with emcc,
 *   regenerates ai-regexr/vendor/pcre2/pcre2.js, copies LICENCE.md, and updates vendor-manifest.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const VENDOR_ROOT = path.join(REPO_ROOT, 'ai-regexr', 'vendor');
const PCRE2_TARGET_DIR = path.join(VENDOR_ROOT, 'pcre2');
const MANIFEST_PATH = path.join(VENDOR_ROOT, 'vendor-manifest.json');
const SHIM_SOURCE_PATH = path.join(__dirname, 'pcre2_shim.c');

const PINNED_CONFIG = {
    name: 'pcre2',
    version: '10.49',
    gitRepository: 'https://github.com/PCRE2Project/pcre2.git',
    gitTag: 'pcre2-10.49',
    gitCommit: '6f9d7c1373262c541324a16a358785b33ef116cf',
    compiler: 'emcc (Emscripten 6.0.13)',
    license: 'BSD-3-Clause WITH PCRE2-exception',
    filesToVendor: [
        'pcre2.js',
        'pcre2.d.ts',
        'LICENCE.md'
    ]
};

/**
 * Computes SHA-256 hash in hex for given buffer or string.
 * @param {Buffer | string} data
 * @returns {string}
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Verifies checked-in vendor artifacts against committed manifest.
 */
function verifyVendorArtifacts() {
    console.log('[vendor-regexr] Verifying vendor artifacts against manifest...');

    if (!fs.existsSync(MANIFEST_PATH)) {
        throw new Error(`Committed manifest missing: ${MANIFEST_PATH}`);
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

    // 1. Verify shim source
    if (!fs.existsSync(SHIM_SOURCE_PATH)) {
        throw new Error(`Shim source missing: ${SHIM_SOURCE_PATH}`);
    }
    const shimContent = fs.readFileSync(SHIM_SOURCE_PATH);
    const actualShimHash = sha256(shimContent);
    if (manifest.shim && manifest.shim.sha256 && actualShimHash !== manifest.shim.sha256) {
        throw new Error(`Shim source SHA-256 mismatch!\nExpected: ${manifest.shim.sha256}\nActual:   ${actualShimHash}`);
    }
    console.log(`[vendor-regexr] ✔ Verified shim source: scripts/pcre2_shim.c (${actualShimHash.substring(0, 16)}...)`);

    // 2. Verify vendor files
    for (const relPath of Object.keys(manifest.files)) {
        const fullPath = path.join(REPO_ROOT, 'ai-regexr', relPath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Vendor file missing: ${fullPath}`);
        }
        const content = fs.readFileSync(fullPath);
        const expected = manifest.files[relPath];
        const actualHash = sha256(content);

        if (content.length !== expected.size) {
            throw new Error(`Size mismatch for ${relPath}: expected ${expected.size}, got ${content.length}`);
        }
        if (actualHash !== expected.sha256) {
            throw new Error(`SHA-256 mismatch for ${relPath}!\nExpected: ${expected.sha256}\nActual:   ${actualHash}`);
        }
        console.log(`[vendor-regexr] ✔ Verified ${relPath} (${content.length} bytes, ${actualHash.substring(0, 16)}...)`);
    }

    console.log('[vendor-regexr] All vendor artifacts verified successfully against committed manifest.');
}

/**
 * Rebuilds PCRE2 WASM binary from pinned source and updates manifest.
 */
function rebuildFromSource() {
    // EMSDK is optional when the pinned compiler is already on PATH. Never
    // depend on session-specific /tmp directories or mutate an existing checkout.
    const env = { ...process.env };
    if (env.EMSDK) {
        env.PATH = path.join(env.EMSDK, 'upstream', 'emscripten') + path.delimiter + env.PATH;
    }
    const compiler = execFileSync('emcc', ['--version'], { env, encoding: 'utf8' }).split('\n')[0];
    const compilerVersion = compiler.match(/\s(\d+\.\d+\.\d+)\s/)?.[1];
    if (compilerVersion !== '6.0.13') throw new Error(`Expected Emscripten 6.0.13, found ${compiler}`);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'regexr-pcre2-build-'));
    const source = path.join(temporary, 'source');
    const build = path.join(temporary, 'build');
    const output = path.join(temporary, 'pcre2.js');
    try {
        execFileSync('git', ['clone', '--branch', PINNED_CONFIG.gitTag, '--depth', '1', PINNED_CONFIG.gitRepository, source], { stdio: 'inherit' });
        const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        if (commit !== PINNED_CONFIG.gitCommit) throw new Error(`PCRE2 source commit mismatch: ${commit}`);
        execFileSync('emcmake', [
            'cmake', '-S', source, '-B', build,
            '-DPCRE2_BUILD_PCRE2_8=ON', '-DPCRE2_BUILD_PCRE2_16=OFF', '-DPCRE2_BUILD_PCRE2_32=OFF',
            '-DPCRE2_BUILD_PCRE2GREP=OFF', '-DPCRE2_BUILD_TESTS=OFF', '-DPCRE2_SUPPORT_JIT=OFF',
            '-DBUILD_SHARED_LIBS=OFF', '-DCMAKE_BUILD_TYPE=Release'
        ], { env, stdio: 'inherit' });
        execFileSync('cmake', ['--build', build, '--parallel', '4'], { env, stdio: 'inherit' });
        execFileSync('emcc', [
            SHIM_SOURCE_PATH, path.join(build, 'libpcre2-8.a'),
            '-I', path.join(source, 'src'), '-I', build, '-I', path.join(build, 'interface'),
            '-sMODULARIZE=1', '-sEXPORT_NAME=PCRE2Module', '-sEXPORT_ES6=1', '-sSINGLE_FILE=1',
            '-sEXPORTED_FUNCTIONS=["_malloc","_free","_pcre2_shim_compile","_pcre2_shim_free","_pcre2_shim_match_ranges","_pcre2_shim_match_single","_pcre2_shim_error_message","_pcre2_shim_version"]',
            '-sEXPORTED_RUNTIME_METHODS=["cwrap","ccall","UTF8ToString","stringToUTF8","lengthBytesUTF8","HEAPU8","HEAPU32"]',
            '-sALLOW_MEMORY_GROWTH=1', '-sENVIRONMENT=web,worker,node', '--no-entry', '-O3', '-o', output
        ], { env, stdio: 'inherit' });
        fs.mkdirSync(PCRE2_TARGET_DIR, { recursive: true });
        fs.copyFileSync(output, path.join(PCRE2_TARGET_DIR, 'pcre2.js'));
        fs.copyFileSync(path.join(source, 'LICENCE.md'), path.join(PCRE2_TARGET_DIR, 'LICENCE.md'));
        const files = {};
        for (const file of PINNED_CONFIG.filesToVendor) {
            const content = fs.readFileSync(path.join(PCRE2_TARGET_DIR, file));
            files[`vendor/pcre2/${file}`] = { size: content.length, sha256: sha256(content) };
        }
        const manifest = {
            package: {
                name: PINNED_CONFIG.name, version: PINNED_CONFIG.version,
                gitRepository: PINNED_CONFIG.gitRepository, gitTag: PINNED_CONFIG.gitTag,
                gitCommit: commit, compiler: PINNED_CONFIG.compiler, license: PINNED_CONFIG.license
            },
            shim: { source: 'scripts/pcre2_shim.c', sha256: sha256(fs.readFileSync(SHIM_SOURCE_PATH)) },
            files
        };
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
        console.log(`[vendor-regexr] Built ${PINNED_CONFIG.name} ${PINNED_CONFIG.version} using ${compiler}`);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

// Main execution
const isBuild = process.argv.includes('--build');

if (isBuild) {
    rebuildFromSource();
} else {
    verifyVendorArtifacts();
}
