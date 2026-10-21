#!/usr/bin/env node
// Render the editable, font-independent SVG using an isolated Chrome instance.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('img/lazydraft-icon.svg', root), 'utf8');

function createIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map(frame => frame.png)]);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.IME_CHROME_PATH
      ? { executablePath: process.env.IME_CHROME_PATH }
      : { channel: 'chrome' }),
  });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(`<style>
      html, body { margin: 0; overflow: hidden; }
      svg { display: block; width: 100vw; height: 100vh; }
    </style>${source}`);
    console.log(`Rendering LazyDraft icons with ${await browser.version()}`);

    const mask = await page.evaluate(() => {
      const svg = document.querySelector('svg').cloneNode(true);
      svg.querySelector('rect').remove();
      svg.querySelector('path').setAttribute('fill', '#000000');
      return new XMLSerializer().serializeToString(svg) + '\n';
    });
    writeFileSync(new URL('img/icon-mask.svg', root), mask);

    const targets = [
      [48, 'img/icon-48.png'],
      [96, 'img/icon-96.png'],
      [144, 'img/icon-144.png'],
      [180, 'img/notepad-apple-icon.png'],
      [192, 'img/icon-192.png'],
      [196, 'img/icon-196.png'],
      [512, 'img/icon-512.png'],
    ];
    for (const [size, path] of targets) {
      await page.setViewportSize({ width: size, height: size });
      await page.screenshot({ path: fileURLToPath(new URL(path, root)), type: 'png' });
      console.log(`Generated ${path} (${size}x${size})`);
    }

    for (const [path, muted] of [['favicon.ico', false], ['favicon-hidden.ico', true]]) {
      if (muted) {
        await page.evaluate(() => {
          document.querySelector('svg rect').setAttribute('fill', '#526d6b');
          document.querySelector('svg path').setAttribute('fill', '#cbd5e1');
        });
      }
      const frames = [];
      for (const size of [16, 32, 48]) {
        await page.setViewportSize({ width: size, height: size });
        frames.push({ size, png: await page.screenshot({ type: 'png' }) });
      }
      writeFileSync(new URL(path, root), createIco(frames));
      console.log(`Generated ${path} (16/32/48px)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
