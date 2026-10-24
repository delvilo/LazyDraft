import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { EDITOR_IDS } from '../src/contracts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.LAB_BASE_URL || 'http://127.0.0.1:8842/editor-lab/dist/';
const BENCHMARK_FIXTURE = '基準測量筆記 Benchmark Entry 🚀 12345';

const ALL_EDITORS = EDITOR_IDS;

const EDITABLE_SELECTORS = {
  squire: '#editor-host [contenteditable="true"]',
  trix: '#editor-host trix-editor',
  tiptap: '#editor-host .ProseMirror',
  lexical: '#editor-host [data-lexical-editor="true"], #editor-host [contenteditable="true"]',
  editorjs: '#editor-host .ce-paragraph, #editor-host .ce-block__content, #editor-host [contenteditable="true"]',
  trumbowyg: '#editor-host .trumbowyg-editor, #editor-host [contenteditable="true"]',
};

function resolvePaths(startDir) {
  let curr = startDir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(curr, 'dist')) && fs.existsSync(path.join(curr, 'package.json'))) {
      return { projectDir: curr, distDir: path.join(curr, 'dist') };
    }
    if (fs.existsSync(path.join(curr, 'editor-lab', 'dist')) || fs.existsSync(path.join(curr, 'editor-lab', 'package.json'))) {
      const p = path.join(curr, 'editor-lab');
      return { projectDir: p, distDir: path.join(p, 'dist') };
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  const fallback = path.resolve(startDir, '..');
  return { projectDir: fallback, distDir: path.join(fallback, 'dist') };
}

async function measureEditor(browser, editorId, baseUrl, releaseData) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const url = new URL(`${editorId}/`, baseUrl).toString();

    const tColdStart = performance.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('body[data-editor-ready="true"]', { timeout: 30_000 });
    const coldReadyMs = Math.round(performance.now() - tColdStart);

    const perfData = await page.evaluate(() => {
      const navEntry = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource');
      let jsBytes = 0;
      let cssBytes = 0;
      let totalTransferBytes = navEntry ? (navEntry.transferSize || 0) : 0;

      for (const entry of resources) {
        const transfer = entry.transferSize || 0;
        totalTransferBytes += transfer;
        const name = entry.name.toLowerCase();
        const initiator = entry.initiatorType;

        if (name.endsWith('.js') || initiator === 'script') {
          jsBytes += transfer;
        } else if (name.endsWith('.css') || initiator === 'css' || initiator === 'link') {
          cssBytes += transfer;
        }
      }
      return { jsBytes, cssBytes, totalTransferBytes };
    });

    const editorRelease = releaseData?.editors?.[editorId] || null;
    const resourceBytes = {
      jsBytes: perfData.jsBytes,
      cssBytes: perfData.cssBytes,
      totalTransferBytes: perfData.totalTransferBytes,
      releaseGraph: editorRelease
        ? {
            bytes: editorRelease.bytes,
            gzipBytes: editorRelease.gzipBytes,
            filesCount: Array.isArray(editorRelease.files) ? editorRelease.files.length : 0,
          }
        : null,
    };

    await page.waitForFunction(
      () => {
        const el = document.getElementById('offline-status');
        if (!el) return false;
        const isReady = el.dataset?.ready === 'true' || el.getAttribute('data-ready') === 'true';
        const text = el.textContent || '';
        return isReady || text.includes('離線可用');
      },
      null,
      { timeout: 45_000 }
    );

    const tWarmStart = performance.now();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('body[data-editor-ready="true"]', { timeout: 30_000 });
    const warmReadyMs = Math.round(performance.now() - tWarmStart);

    const selector = EDITABLE_SELECTORS[editorId];
    let editable = page.locator(selector).first();
    if ((await editable.count()) === 0) {
      editable = page.locator('#editor-host [contenteditable="true"], #editor-host trix-editor, #editor-host .ce-paragraph, #editor-host .trumbowyg-editor').first();
    }

    await editable.click({ timeout: 5000 });

    const tChange = performance.now();
    await page.keyboard.insertText(BENCHMARK_FIXTURE);

    await page.waitForFunction(
      ({ id, fixture }) => {
        const raw = localStorage.getItem(`lazydraft-editor-lab:v1:draft:${id}`);
        if (!raw) return false;
        try {
          const parsed = JSON.parse(raw);
          const snapshot = typeof parsed?.snapshot === 'string' ? parsed.snapshot : '';
          const saveEl = document.getElementById('save-status');
          const state = saveEl?.getAttribute('data-state') || saveEl?.dataset?.state;
          return snapshot.includes(fixture) && state === 'saved';
        } catch {
          return false;
        }
      },
      { id: editorId, fixture: BENCHMARK_FIXTURE },
      { timeout: 15_000 }
    );
    const changeToSavedMs = Math.round(performance.now() - tChange);

    return {
      editorId,
      coldReadyMs,
      warmReadyMs,
      changeToSavedMs,
      resourceBytes,
      error: null,
    };
  } catch (err) {
    return {
      editorId,
      coldReadyMs: null,
      warmReadyMs: null,
      changeToSavedMs: null,
      resourceBytes: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await context.close();
  }
}

async function main() {
  console.log(`Starting editor-lab benchmark against: ${BASE_URL}`);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const browserVersion = browser.version();
  console.log(`Browser: Chrome (${browserVersion})`);

  const { projectDir, distDir } = resolvePaths(__dirname);

  let releaseData = null;
  const releasePath = path.join(distDir, 'release.json');
  if (fs.existsSync(releasePath)) {
    try {
      releaseData = JSON.parse(fs.readFileSync(releasePath, 'utf-8'));
    } catch {
      releaseData = null;
    }
  }

  const measurements = {};
  let hasFailure = false;

  try {
    for (const editorId of ALL_EDITORS) {
      process.stdout.write(`Measuring ${editorId.padEnd(12)}... `);
      const metric = await measureEditor(browser, editorId, BASE_URL, releaseData);
      measurements[editorId] = metric;

      if (metric.error !== null) {
        hasFailure = true;
        console.log(`FAILED: ${metric.error}`);
      } else {
        const jsKb = (metric.resourceBytes.jsBytes / 1024).toFixed(1);
        const totalKb = (metric.resourceBytes.totalTransferBytes / 1024).toFixed(1);
        console.log(
          `Cold: ${String(metric.coldReadyMs).padStart(4)}ms | ` +
            `Warm: ${String(metric.warmReadyMs).padStart(4)}ms | ` +
            `SaveLatency: ${String(metric.changeToSavedMs).padStart(4)}ms | ` +
            `JS: ${jsKb}KB | ` +
            `Total: ${totalKb}KB`
        );
      }
    }
  } finally {
    await browser.close();
  }

  const outputPayload = {
    timestamp: new Date().toISOString(),
    browser: `Chrome ${browserVersion}`,
    fixture: BENCHMARK_FIXTURE,
    baseUrl: BASE_URL,
    measurements,
  };

  fs.mkdirSync(distDir, { recursive: true });
  const distOutPath = path.join(distDir, 'measurements.json');
  fs.writeFileSync(distOutPath, JSON.stringify(outputPayload, null, 2), 'utf-8');

  fs.mkdirSync(projectDir, { recursive: true });
  const projectOutPath = path.join(projectDir, 'measurements.json');
  fs.writeFileSync(projectOutPath, JSON.stringify(outputPayload, null, 2), 'utf-8');

  console.log(`\nBenchmark measurements written to:\n  - ${distOutPath}\n  - ${projectOutPath}`);

  if (hasFailure) {
    console.error('\nBenchmark run encountered failures on one or more editors.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal measurement failure:', err);
  process.exit(1);
});
