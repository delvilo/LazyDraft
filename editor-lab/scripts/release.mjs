import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile, readdir, stat, rename } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogue } from '../src/catalogue.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
await rename(resolve(dist, 'hub.html'), resolve(dist, 'index.html'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'));
const lock = await readJSON(resolve(root, 'package-lock.json'));
const schema = await readJSON(resolve(root, 'src/schema.json'));
const manifest = await readJSON(resolve(dist, '.vite/manifest.json'));
const workerTemplate = await readFile(resolve(root, 'src/sw.template.js'), 'utf8');
const permissive = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'Zlib']);
const licenses = [];
const notices = ['LazyDraft Editor Lab third-party notices', 'DOMPurify is used under its Apache-2.0 license option.', 'Development dependencies are not editor runtime components.', ''];

for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path) continue;
  const name = entry.name || path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const license = entry.license || 'UNKNOWN';
  const chosenLicense = license === '(MPL-2.0 OR Apache-2.0)' ? 'Apache-2.0' : license;
  const development = entry.dev === true;
  if (!development && !permissive.has(chosenLicense)) throw new Error(`Non-permissive runtime dependency: ${name} ${entry.version} (${license})`);
  const record = { name, version: entry.version, license, chosenLicense, development };
  licenses.push(record);
  notices.push(`${name}@${entry.version} | ${development ? 'development' : 'runtime'} | ${license}${license === chosenLicense ? '' : ` | chosen ${chosenLicense}`}`);
  const directory = resolve(root, path);
  let children;
  try { children = await readdir(directory); }
  catch (error) {
    if (error.code !== 'ENOENT' || !entry.optional) throw error;
    notices.push('Optional package is not installed on this build platform.', '');
    continue;
  }
  const licenseFiles = children.filter((file) => /^(?:licen[cs]e|copying|notice)(?:\..+)?$/i.test(file));
  record.noticeFiles = licenseFiles;
  for (const file of licenseFiles) {
    const full = resolve(directory, file);
    if (!(await stat(full)).isFile()) continue;
    notices.push(`--- ${file} ---`, await readFile(full, 'utf8'));
  }
  if (!licenseFiles.length) notices.push('No standalone license file shipped in the npm package; see the declared package license and upstream source.');
  notices.push('');
}
await writeFile(resolve(dist, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));

async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = resolve(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(full));
    else if (item.isFile()) files.push(full);
    else throw new Error(`Non-regular release entry: ${full}`);
  }
  return files;
}
const excluded = new Set(['sw.js', 'release.json', 'measurements.json']);
const files = [];
for (const full of (await walk(dist)).sort()) {
  const path = relative(dist, full).split(sep).join('/');
  if (path.startsWith('.vite/') || excluded.has(path)) continue;
  const bytes = await readFile(full);
  files.push({ path, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: sha256(bytes) });
}
const fileMap = new Map(files.map((file) => [file.path, file]));
const manifestByFile = new Map(Object.entries(manifest).map(([key, chunk]) => [chunk.file, key]));
const adapterKeys = new Set(Object.keys(catalogue).map((id) => `src/adapters/${id}.ts`));

function collect(key, includeDynamic, result, visited = new Set()) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Missing Vite manifest entry: ${key}`);
  result.add(chunk.file);
  for (const asset of [...(chunk.css || []), ...(chunk.assets || [])]) result.add(asset);
  for (const dependency of chunk.imports || []) collect(dependency, includeDynamic, result, visited);
  // The shell loader names every competitor; those are not per-editor dependencies.
  if (includeDynamic) for (const dependency of chunk.dynamicImports || []) {
    if (!adapterKeys.has(dependency)) collect(dependency, true, result, visited);
  }
}
const editors = {};
for (const [id, editor] of Object.entries(catalogue)) {
  const entry = `${id}/index.html`;
  const graph = new Set([entry]);
  const html = await readFile(resolve(dist, entry), 'utf8');
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
    const resource = new URL(match[1], `https://release.invalid/${entry}`);
    if (resource.origin !== 'https://release.invalid') throw new Error(`External page dependency: ${resource.href}`);
    const path = decodeURIComponent(resource.pathname.slice(1));
    graph.add(path);
    const key = manifestByFile.get(path);
    if (key) collect(key, false, graph);
  }
  const adapter = Object.keys(manifest).find((key) => key === `src/adapters/${id}.ts`);
  if (!adapter) throw new Error(`Editor adapter is not a built dynamic entry: ${id}`);
  collect(adapter, true, graph);
  const paths = [...graph].sort();
  const records = paths.map((path) => {
    const file = fileMap.get(path);
    if (!file) throw new Error(`Missing editor graph file: ${id} / ${path}`);
    return file;
  });
  editors[id] = {
    entry,
    files: paths,
    bytes: records.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: records.reduce((sum, file) => sum + file.gzipBytes, 0),
    sourceBytes: (await stat(resolve(root, `src/adapters/${id}.ts`))).size,
    license: editor.license,
    version: editor.version,
  };
}
const content = {
  files,
  editors,
  licenses,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  totalGzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
};
const version = sha256(JSON.stringify({ content, schema, workerTemplate })).slice(0, 20);
const release = { version, ...content };
const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
await writeFile(resolve(dist, 'release.json'), releaseBytes);
const offlineRelease = {
  version,
  files: [...files.map(({ path, sha256 }) => ({ path, sha256 })), { path: 'release.json', sha256: sha256(releaseBytes) }],
};
const worker = workerTemplate
  .replace('__EDITOR_LAB_RELEASE__', JSON.stringify(offlineRelease))
  .replace('__EDITOR_LAB_SCHEMA__', JSON.stringify(schema));
await writeFile(resolve(dist, 'sw.js'), worker);
try {
  await writeFile(resolve(dist, 'measurements.json'), await readFile(resolve(root, 'measurements.json')));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log(`Release ${version}: ${files.length + 1} verified offline files, ${content.totalBytes} bytes (${content.totalGzipBytes} gzip).`);
console.log(`Licenses: ${licenses.filter((license) => !license.development).length} permissive runtime declarations; ${licenses.filter((license) => license.development).length} development declarations recorded separately.`);
