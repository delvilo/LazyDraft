import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  waitForEditorReady,
  typeIntoEditor,
  getEditorEditable,
  getEditorDraft,
  waitForDraftSaved,
  getStoredImagesFromIDB,
} from './helpers.ts';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_SVG_PATH = path.join(__dirname, 'fixtures', 'sample.svg');

test.describe('Image Validation, Boundary and Security Enforcement', () => {
  const targetEditor = 'quill';

  test('accepts an original PNG at exactly 5MiB and preserves its bytes', async ({ page }) => {
    await page.goto(`${targetEditor}/`);
    await waitForEditorReady(page, targetEditor);

    const boundaryText = '邊界圖片測試 Boundary Image';
    await typeIntoEditor(page, targetEditor, boundaryText);
    await waitForDraftSaved(page, targetEditor, { expectedText: boundaryText });

    const original = readFileSync(path.join(__dirname, 'fixtures', 'sample.png'));
    const chunkLength = 5 * 1024 * 1024 - original.length;
    const chunk = Buffer.alloc(chunkLength);
    chunk.writeUInt32BE(chunkLength - 12, 0);
    chunk.write('npAd', 4, 'ascii');
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunkLength - 4);
    const validBoundaryPng = Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]);

    const fileInput = page.locator('input#image-file');
    await fileInput.setInputFiles({
      name: 'boundary-test.png',
      mimeType: 'image/png',
      buffer: validBoundaryPng,
    });

    await expect(page.locator('#editor-host img')).toHaveCount(1);
    await waitForDraftSaved(page, targetEditor);
    const records = await getStoredImagesFromIDB(page, targetEditor);
    const record = records.find((image) => image.name === 'boundary-test.png');
    expect(record?.size).toBe(5 * 1024 * 1024);
    expect(Buffer.from(record?.dataBase64 ?? '', 'base64').equals(validBoundaryPng)).toBe(true);
    await expect.poll(() => page.locator('#editor-host img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  });

  test('rejects oversize file (> 5MiB) with visible alert and preserves editor draft', async ({ page }) => {
    await page.goto(`${targetEditor}/`);
    await waitForEditorReady(page, targetEditor);

    const initialDraftText = '原始重要筆記重要草稿 Important Draft Content';
    await typeIntoEditor(page, targetEditor, initialDraftText);
    await waitForDraftSaved(page, targetEditor, { expectedText: initialDraftText });

    const draftBefore = await getEditorDraft(page, targetEditor);

    const oversizeBuffer = Buffer.alloc(5.2 * 1024 * 1024);
    const fileInput = page.locator('input#image-file');
    await fileInput.setInputFiles({
      name: 'oversize-photo.png',
      mimeType: 'image/png',
      buffer: oversizeBuffer,
    });

    const errorStatus = page.locator('#error-status');
    await expect(errorStatus).toBeVisible();

    const editable = getEditorEditable(page, targetEditor);
    expect(await editable.innerText()).toContain(initialDraftText);
    expect((await getEditorDraft(page, targetEditor))?.snapshot).toBe(draftBefore?.snapshot);

    const idbRecords = await getStoredImagesFromIDB(page, targetEditor);
    const oversizeRecord = idbRecords.find((r) => r.size > 5 * 1024 * 1024);
    expect(oversizeRecord).toBeUndefined();
  });

  test('rejects SVG image files visibly and preserves draft', async ({ page }) => {
    await page.goto(`${targetEditor}/`);
    await waitForEditorReady(page, targetEditor);

    const textBefore = 'SVG 格式安全測試 SVG Reject';
    await typeIntoEditor(page, targetEditor, textBefore);
    await waitForDraftSaved(page, targetEditor, { expectedText: textBefore });

    const fileInput = page.locator('input#image-file');
    await fileInput.setInputFiles(FIXTURE_SVG_PATH);

    const errorStatus = page.locator('#error-status');
    await expect(errorStatus).toBeVisible();

    const editable = getEditorEditable(page, targetEditor);
    expect(await editable.innerText()).toContain(textBefore);
  });

  test('rejects pasted HTML with raw base64 data URLs visibly, prompting file button', async ({ page }) => {
    await page.goto(`${targetEditor}/`);
    await waitForEditorReady(page, targetEditor);

    const textBefore = '剪貼簿防護測試 Clipboard Guard';
    await typeIntoEditor(page, targetEditor, textBefore);
    const before = await waitForDraftSaved(page, targetEditor, { expectedText: textBefore });

    const prevented = await page.evaluate(() => {
      const pasteHTML = '<p>Bad Paste</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">';
      const dt = new DataTransfer();
      dt.setData('text/html', pasteHTML);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(pasteEvent, 'clipboardData', { value: dt });
      const host = document.getElementById('editor-host');
      if (!host) throw new Error('Editor surface unavailable');
      host.dispatchEvent(pasteEvent);
      return pasteEvent.defaultPrevented;
    });
    expect(prevented).toBe(true);

    const errorStatus = page.locator('#error-status');
    await expect(errorStatus).toBeVisible();

    const editable = getEditorEditable(page, targetEditor);
    expect(await editable.innerText()).toContain(textBefore);
    expect((await getEditorDraft(page, targetEditor))?.snapshot).toBe(before.snapshot);
  });

  test('permits ordinary text mentions of data:image or blob URLs without false positives', async ({ page }) => {
    await page.goto(`${targetEditor}/`);
    await waitForEditorReady(page, targetEditor);

    const docText = '說明文件：請注意 data:image/png;base64 及 blob:http://localhost 是文字不是圖片。';
    await typeIntoEditor(page, targetEditor, docText);
    await waitForDraftSaved(page, targetEditor, { expectedText: docText });

    const errorStatus = page.locator('#error-status');
    await expect(errorStatus).not.toHaveText(/.+/);

    const draft = await getEditorDraft(page, targetEditor);
    expect(draft).not.toBeNull();
    expect(draft?.snapshot).toContain('data:image/png;base64');
  });
});
