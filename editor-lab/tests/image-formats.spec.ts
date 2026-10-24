import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  getEditorDraft, getStoredImagesFromIDB, readExportedHTML, waitForDraftSaved, waitForEditorReady,
} from './helpers.ts';

const animatedGif = Buffer.from(
  '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e300301000000' +
  '21f904000a0000002c0000000001000100000202440100' +
  '21f904000a0000002c00000000010001000002024c01003b',
  'hex',
);

test('preserves JPEG, WebP and two-frame GIF bytes through storage, rendering and HTML export', async ({ page }) => {
  await page.goto('trumbowyg/');
  await waitForEditorReady(page, 'trumbowyg');
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#e00000';
    context.fillRect(0, 0, 2, 2);
    return ['image/jpeg', 'image/webp'].map((mime) => ({ mime, url: canvas.toDataURL(mime) }));
  });
  const originals = [
    ...raster.map(({ mime, url }) => ({
      mime, name: mime === 'image/jpeg' ? 'original.jpg' : 'original.webp',
      bytes: Buffer.from(url.split(',')[1], 'base64'),
    })),
    { mime: 'image/gif', name: 'animated.gif', bytes: animatedGif },
  ];
  for (const original of originals) {
    const before = await getEditorDraft(page, 'trumbowyg');
    await page.locator('#image-file').setInputFiles({
      name: original.name, mimeType: original.mime, buffer: original.bytes,
    });
    await waitForDraftSaved(page, 'trumbowyg', { minRevision: (before?.revision ?? 0) + 1 });
    const stored = (await getStoredImagesFromIDB(page, 'trumbowyg')).find((record) => record.name === original.name);
    expect(stored?.mime).toBe(original.mime);
    expect(stored?.dataBase64).toBe(original.bytes.toString('base64'));
    const image = page.locator(`#editor-host img[src$="/${stored?.id}"]`);
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(original.mime === 'image/gif' ? 1 : 2);
  }
  await page.reload();
  await waitForEditorReady(page, 'trumbowyg');
  const html = await readExportedHTML(page);
  const sources = await page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(document.body.querySelectorAll('img')).map((image) => image.getAttribute('src'));
  }, html);
  expect(sources).toEqual(originals.map((original) => `data:${original.mime};base64,${original.bytes.toString('base64')}`));
});

for (const declaredMime of ['text/html', '']) {
  test(`normalizes a PNG declared as ${JSON.stringify(declaredMime)} without executing trailing HTML`, async ({ page }) => {
    await page.goto('trumbowyg/');
    await waitForEditorReady(page, 'trumbowyg');
    const png = readFileSync(new URL('./fixtures/sample.png', import.meta.url));
    const original = Buffer.concat([
      png,
      Buffer.from('<script>parent.document.body.setAttribute("data-image-script-executed","true")</script>'),
    ]);
    await page.locator('#image-file').setInputFiles({ name: 'declared.html', mimeType: declaredMime, buffer: original });
    await waitForDraftSaved(page, 'trumbowyg');
    const image = page.locator('#editor-host .trumbowyg-editor img');
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
    const source = await image.getAttribute('src');
    if (!source) throw new Error('Stored image source unavailable');
    const response = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { mime: response.headers.get('content-type'), bytes: btoa(String.fromCharCode(...bytes)) };
    }, source);
    expect(response).toEqual({ mime: 'image/png', bytes: original.toString('base64') });
    const imageDocumentMime = await page.evaluate(async (url) => {
      const frame = document.createElement('iframe');
      const loaded = Promise.withResolvers<void>();
      frame.onload = () => loaded.resolve();
      frame.onerror = () => loaded.reject(new Error('Image document failed to load'));
      frame.src = url;
      document.body.append(frame);
      try {
        await loaded.promise;
        return frame.contentDocument?.contentType;
      } finally {
        frame.remove();
      }
    }, source);
    expect(imageDocumentMime).toBe('image/png');
    await expect(page.locator('body')).not.toHaveAttribute('data-image-script-executed', 'true');
    const html = await readExportedHTML(page);
    expect(html).toContain(`data:image/png;base64,${original.toString('base64')}`);
  });
}
