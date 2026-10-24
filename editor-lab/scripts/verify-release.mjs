import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogue } from '../src/catalogue.ts';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const release = JSON.parse(await readFile(resolve(dist, 'release.json'), 'utf8'));
const files = new Map(release.files.map((file) => [file.path, file]));
assert.equal(files.size, release.files.length, 'Release paths must be unique');
let totalBytes = 0;
let totalGzipBytes = 0;
for (const file of files.values()) {
  assert.ok(!file.path.startsWith('/') && !file.path.split('/').includes('..'), `Unsafe release path: ${file.path}`);
  const bytes = await readFile(resolve(dist, file.path));
  assert.equal(bytes.length, file.bytes, `${file.path}: byte count`);
  assert.equal(gzipSync(bytes, { level: 9 }).length, file.gzipBytes, `${file.path}: gzip byte count`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path}: integrity`);
  totalBytes += bytes.length;
  totalGzipBytes += file.gzipBytes;
}
assert.equal(totalBytes, release.totalBytes);
assert.equal(totalGzipBytes, release.totalGzipBytes);
const ignored = new Set(['sw.js', 'release.json', 'measurements.json']);
async function verifyCoverage(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = resolve(directory, item.name);
    const path = relative(dist, full).split(sep).join('/');
    if (path.startsWith('.vite/')) continue;
    if (item.isDirectory()) await verifyCoverage(full);
    else {
      assert.ok(item.isFile(), `Non-regular output: ${path}`);
      assert.ok(ignored.has(path) || files.has(path), `Untracked offline output: ${path}`);
    }
  }
}
await verifyCoverage(dist);
const editorCount = Object.keys(release.editors).length;
assert.equal(editorCount, Object.keys(catalogue).length, 'Release editor count matches catalogue');
assert.equal([...files.keys()].filter((path) => path.endsWith('.html')).length, editorCount + 1, `Hub plus ${editorCount} editor documents`);
for (const [id, description] of Object.entries(catalogue)) {
  const editor = release.editors[id];
  assert.equal(editor.entry, `${id}/index.html`);
  assert.equal(editor.version, description.version);
  assert.equal(editor.license, description.license);
  assert.ok(editor.files.includes(editor.entry), `${id}: document is part of full graph`);
  assert.equal(editor.bytes, editor.files.reduce((sum, path) => sum + files.get(path).bytes, 0), `${id}: full dependency graph bytes`);
  assert.equal(editor.gzipBytes, editor.files.reduce((sum, path) => sum + files.get(path).gzipBytes, 0), `${id}: full dependency graph gzip`);
}
const permissive = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'Zlib']);
for (const license of release.licenses) if (!license.development) assert.ok(permissive.has(license.chosenLicense), `${license.name}: runtime license`);
console.log(`Verified release ${release.version}: ${editorCount + 1} pages, ${files.size} integrity-checked files, all ${editorCount} complete editor graphs and permissive runtime license declarations.`);
