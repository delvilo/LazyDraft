#!/usr/bin/env node
/** Real-app warm-cache benchmark: trusted enable click -> visible candidate DOM. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SAMPLES = 20;
const LIMIT_MS = 50;
const root = fileURLToPath(new URL('../', import.meta.url));
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
};

async function serve(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let filename = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    const content = await readFile(filename);
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
}

// Each document starts a new audit. Never erase pre-click observations: that
// would hide preload work or allow an in-memory table to masquerade as an IDB hit.
function installProbe() {
  const audit = { start: null, reads: [], premature: 0, result: null };
  window.__imeBench = audit;
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    const request = get.apply(this, args);
    if (this.transaction.db.name === 'lazydraft-ime-cache' && this.name === 'dictionaries') {
      if (audit.start === null) audit.premature++;
      request.addEventListener('success', () => {
        const dictionary = request.result;
        audit.reads.push({
          key: String(args[0]),
          hit: dictionary?.format === 1 && typeof dictionary.codes === 'string'
            && dictionary.codeOffsets instanceof Uint32Array
            && dictionary.candidateOffsets instanceof Uint32Array
            && dictionary.textOffsets instanceof Uint32Array
            && typeof dictionary.text === 'string',
        });
      });
    }
    return request;
  };
}

function armMeasurement() {
  const audit = window.__imeBench;
  const toggle = document.getElementById('boshiamyToggle');
  const textarea = document.getElementById('note');
  if (toggle.getAttribute('aria-pressed') !== 'false' || audit.start !== null) {
    throw new Error('Measurement must start at the first disabled activation after reload');
  }

  const finish = result => {
    if (audit.result) return;
    audit.result = result;
    clearTimeout(timer);
    observer.disconnect();
  };
  const observer = new MutationObserver(() => {
    if (toggle.getAttribute('aria-pressed') !== 'true') return;
    if (audit.start === null) {
      finish({ error: 'IME enabled without a measured trusted click' });
      return;
    }
    textarea.focus();
    const key = new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', bubbles: true, cancelable: true,
    });
    textarea.dispatchEvent(key);
    const bar = document.getElementById('boshiamyBar');
    const candidate = bar?.querySelector('.boshiamy-cand-char')?.textContent;
    const rect = bar?.getBoundingClientRect();
    const style = bar && getComputedStyle(bar);
    const visible = !!rect && rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility === 'visible';
    // Includes synchronous candidate generation and its layout, not CDP waits
    // or a later compositor frame. The production controller is not replaced.
    const elapsed = performance.now() - audit.start;
    finish({ elapsed, candidate, visible, consumed: key.defaultPrevented });
  });
  const timer = setTimeout(() => finish({ error: 'Activation did not produce candidates within 5s' }), 5000);
  observer.observe(toggle, { attributes: true, attributeFilter: ['aria-pressed'] });
  toggle.addEventListener('click', event => {
    if (!event.isTrusted) {
      finish({ error: 'Synthetic enable click is not a valid benchmark' });
      return;
    }
    audit.start = performance.now();
  }, { capture: true, once: true });
}

async function waitForDisabled(page) {
  await page.waitForFunction(() => {
    const toggle = document.getElementById('boshiamyToggle');
    return toggle?.getAttribute('aria-pressed') === 'false'
      && toggle.getAttribute('aria-busy') === 'false';
  });
}

async function disable(page) {
  await page.locator('#boshiamyToggle').click();
  await waitForDisabled(page);
}

async function main() {
  const server = createServer(serve);
  let browser;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.IME_CHROME_PATH
        ? { executablePath: process.env.IME_CHROME_PATH }
        : { channel: 'chrome' }),
    });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(15000);
    await context.addInitScript(installProbe);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let warm = false;
    let source;
    const forbiddenFetches = [];
    await page.route('**/boshiamy-dict.json', async route => {
      if (warm) {
        forbiddenFetches.push(route.request().url());
        await route.abort('blockedbyclient');
      } else {
        source = route.request().url();
        await route.continue();
      }
    });

    console.log(`Platform: ${process.platform}/${process.arch}; desktop Chrome ${browser.version()} (headless)`);
    console.log('Timing: trusted toolbar click -> real controller consumes a and lays out candidate 對');
    console.log(`Acceptance: ${SAMPLES} reloads, every sample <${LIMIT_MS}ms; IDB hit, no preload or JSON fallback`);
    await page.goto(`${origin}/index.html`);
    await waitForDisabled(page);
    await page.locator('#boshiamyToggle').click();
    await page.waitForFunction(() => document.getElementById('boshiamyToggle').getAttribute('aria-pressed') === 'true');
    if (!source) throw new Error('Cold warmup never fetched the real dictionary');
    await disable(page);
    warm = true;
    console.log('Cold warmup committed; subsequent JSON dictionary requests are forbidden.');

    const samples = [];
    for (let index = 1; index <= SAMPLES; index++) {
      await page.reload();
      await waitForDisabled(page);
      await page.evaluate(armMeasurement);
      await page.locator('#boshiamyToggle').click();
      await page.waitForFunction(() => window.__imeBench.result !== null);
      const audit = await page.evaluate(() => window.__imeBench);
      const result = audit.result;
      const cacheHit = audit.reads.some(read => read.key === source && read.hit);
      const reasons = [];
      if (result.error) reasons.push(result.error);
      if (!Number.isFinite(result.elapsed) || result.elapsed >= LIMIT_MS) reasons.push('activation >=50ms or untimed');
      if (!cacheHit) reasons.push('no actual current-source IndexedDB hit');
      if (audit.premature !== 0) reasons.push('dictionary read before timed click');
      if (forbiddenFetches.length !== 0) reasons.push('warm JSON fetch attempted');
      if (result.candidate !== '對' || !result.visible || !result.consumed) reasons.push('candidate is not usable');
      if (errors.length !== 0) reasons.push(`page error: ${errors.join('; ')}`);
      const passed = reasons.length === 0;
      samples.push({ elapsed: result.elapsed, passed });
      const time = Number.isFinite(result.elapsed) ? result.elapsed.toFixed(3) : 'untimed';
      console.log(`${String(index).padStart(2, '0')}: ${time}ms | IDB ${cacheHit ? 'HIT' : 'MISS'} | ${passed ? 'PASS' : `FAIL: ${reasons.join('; ')}`}`);
      if (result.error) throw new Error(`Sample ${index} could not be measured; no samples are retried or discarded`);
      await disable(page);
    }
    const times = samples.map(sample => sample.elapsed);
    console.log(`Measured ${samples.length}/${SAMPLES}; min ${Math.min(...times).toFixed(3)}ms; max ${Math.max(...times).toFixed(3)}ms`);
    if (samples.length !== SAMPLES || samples.some(sample => !sample.passed)) {
      throw new Error('Benchmark failed: every individual sample must satisfy every predicate');
    }
    console.log('PASS: all 20 reload activations were IndexedDB hits and strictly below 50ms.');
  } finally {
    try {
      await browser?.close();
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
