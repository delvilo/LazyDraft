import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  ALL_EDITORS,
  waitForEditorReady,
  getEditorEditable,
  getEditorContent,
  typeIntoEditor,
  executeFormatCommand,
  waitForDraftSaved,
  getEditorDraft,
  getStoredImagesFromIDB,
  readExportedHTML,
} from './helpers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PNG_PATH = path.join(__dirname, 'fixtures', 'sample.png');
const FIXTURE_PNG_BYTES = fs.readFileSync(FIXTURE_PNG_PATH);
const FIXTURE_PNG_SIZE = FIXTURE_PNG_BYTES.byteLength;
const FIXTURE_PNG_B64 = FIXTURE_PNG_BYTES.toString('base64');

const EXACT_FIXTURE_NOTE = '嚴格測試筆記 🚀 2026 繁體中文與 Emoji 🎯 換行驗證\n第二行完整字串';

const formatCases = [
  { command: 'bold', dom: 'b, strong, [style*="font-weight: bold"], [style*="font-weight: 700"]', html: 'b, strong, [style*="font-weight: bold"], [style*="font-weight: 700"]' },
  { command: 'italic', dom: 'i, em, [style*="font-style: italic"]', html: 'i, em, [style*="font-style: italic"]' },
  { command: 'heading', dom: 'h1, h2, h3, h4, h5, h6', html: 'h1, h2, h3, h4, h5, h6' },
  { command: 'bulletList', dom: 'ul, li[data-list="bullet"]', html: 'ul' },
  { command: 'orderedList', dom: 'ol, li[data-list="ordered"]', html: 'ol' },
  { command: 'quote', dom: 'blockquote, .cdx-quote', html: 'blockquote' },
  { command: 'codeBlock', dom: 'pre, code, textarea', html: 'pre' },
];

test.describe('Editor Lab - All Six Editors Integration Matrix', () => {
  for (const editorId of ALL_EDITORS) {
    test.describe(`Engine: ${editorId}`, () => {
      test('persists exact Chinese and Emoji fixture across edit, auto-save and reload', async ({
        page,
      }) => {
        await page.goto(`${editorId}/`);
        await waitForEditorReady(page, editorId);

        await typeIntoEditor(page, editorId, EXACT_FIXTURE_NOTE);
        const draft = await waitForDraftSaved(page, editorId, {
          expectedText: '第二行完整字串',
          minRevision: 1,
        });

        expect(draft.editor).toBe(editorId);
        expect(draft.snapshot).toContain('嚴格測試筆記 🚀 2026 繁體中文與 Emoji 🎯 換行驗證');
        expect(draft.snapshot).toContain('第二行完整字串');

        await page.reload();
        await waitForEditorReady(page, editorId);

        const restoredDraft = await getEditorDraft(page, editorId);
        expect(restoredDraft).not.toBeNull();
        expect(restoredDraft?.snapshot).toContain('嚴格測試筆記 🚀 2026 繁體中文與 Emoji 🎯 換行驗證');
        expect(restoredDraft?.snapshot).toContain('第二行完整字串');

        const editable = getEditorContent(page, editorId);
        const editableText = await editable.innerText();
        expect(editableText).toContain('嚴格測試筆記 🚀 2026 繁體中文與 Emoji 🎯 換行驗證');
        expect(editableText).toContain('第二行完整字串');
        expect(editableText).toMatch(/換行驗證\s*\n\s*第二行完整字串/);
        const html = await readExportedHTML(page);
        const exportedText = await page.evaluate(async value => {
          const frame = document.createElement('iframe');
          frame.sandbox.add('allow-same-origin');
          frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px';
          const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
          frame.srcdoc = value;
          document.body.append(frame);
          try {
            await loaded;
            const text = frame.contentDocument?.body.innerText;
            if (text === undefined) throw new Error('Exported document did not load');
            return text.replace(/\u00a0/g, ' ');
          } finally {
            frame.remove();
          }
        }, html);
        expect(exportedText).toContain('嚴格測試筆記 🚀 2026 繁體中文與 Emoji 🎯 換行驗證');
        expect(exportedText).toMatch(/換行驗證\s*\n\s*第二行完整字串/);
      });

      test('restores every core format, exports its semantics, and undoes and redoes bold', async ({ page }) => {
        const word = '保留格式內容';
        for (const format of formatCases) {
          await page.goto(`${editorId}/`);
          await waitForEditorReady(page, editorId);
          await page.evaluate((id) => localStorage.removeItem(`lazydraft-editor-lab:v1:draft:${id}`), editorId);
          await page.reload();
          await waitForEditorReady(page, editorId);
          await typeIntoEditor(page, editorId, word);
          const before = await waitForDraftSaved(page, editorId, { expectedText: word });
          await getEditorEditable(page, editorId).click();
          await page.keyboard.press('ControlOrMeta+A');
          await executeFormatCommand(page, format.command);
          const content = getEditorContent(page, editorId);
          await expect(content.locator(format.dom).first(), `${editorId} ${format.command}`).toBeAttached();
          if (format.command === 'bold') {
            await executeFormatCommand(page, 'undo');
            await expect(content.locator(format.dom)).toHaveCount(0);
            await expect(content).toContainText(word);
            await executeFormatCommand(page, 'redo');
            await expect(content.locator(format.dom).first()).toBeAttached();
          }
          await waitForDraftSaved(page, editorId, { expectedText: word, minRevision: before.revision + 1 });
          await page.reload();
          await waitForEditorReady(page, editorId);
          await expect(content.locator(format.dom).first(), `${editorId} restored ${format.command}`).toBeAttached();
          const restoredText = await content.locator(format.dom).first().evaluate((node) =>
            node instanceof HTMLTextAreaElement ? node.value : node.textContent);
          expect(restoredText).toContain(word);
          const html = await readExportedHTML(page);
          const exported = await page.evaluate(({ html, selector }) => {
            const document = new DOMParser().parseFromString(html, 'text/html');
            return document.body.querySelector(selector)?.textContent;
          }, { html, selector: format.html });
          expect(exported, `${editorId} exported ${format.command}`).toContain(word);
        }
      });

      test('preserves selected and collapsed links through native restore', async ({ page }) => {
        await page.goto(`${editorId}/`);
        await waitForEditorReady(page, editorId);
        await typeIntoEditor(page, editorId, '選取文字');
        await waitForDraftSaved(page, editorId, { expectedText: '選取文字' });
        await getEditorEditable(page, editorId).click();
        await page.keyboard.press('ControlOrMeta+A');
        await executeFormatCommand(page, 'link');
        await page.locator('#source-url').fill('https://example.test/selected');
        await page.locator('#source-submit').click();
        await expect(page.locator('#editor-host a[href=\"https://example.test/selected\"]')).toContainText('選取文字');
        await waitForDraftSaved(page, editorId, { expectedText: 'https://example.test/selected' });
        await page.reload();
        await waitForEditorReady(page, editorId);
        const link = page.locator('#editor-host a[href=\"https://example.test/selected\"]').first();
        await expect(link).toContainText('選取文字');
        await getEditorEditable(page, editorId).click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.press('ArrowRight');
        await executeFormatCommand(page, 'link');
        await page.locator('#source-url').fill('https://example.test/collapsed');
        await page.locator('#source-submit').click();
        await expect(page.locator('#editor-host a[href=\"https://example.test/collapsed\"]')).toContainText('https://example.test/collapsed');
        await waitForDraftSaved(page, editorId, { expectedText: 'https://example.test/collapsed' });
        await page.reload();
        await waitForEditorReady(page, editorId);
        await expect(page.locator('#editor-host a[href=\"https://example.test/collapsed\"]')).toContainText('https://example.test/collapsed');
        const html = await readExportedHTML(page);
        const links = await page.evaluate((html) => {
          const document = new DOMParser().parseFromString(html, 'text/html');
          return Array.from(document.body.querySelectorAll('a')).map((anchor) => ({ href: anchor.href, text: anchor.textContent }));
        }, html);
        expect(links).toContainEqual({ href: 'https://example.test/selected', text: '選取文字' });
        expect(links).toContainEqual({ href: 'https://example.test/collapsed', text: 'https://example.test/collapsed' });
      });

      test('commits image to IDB with exact byte metadata, renders naturalWidth 1, and embeds decoded bytes in export', async ({
        page,
      }) => {
        await page.goto(`${editorId}/`);
        await waitForEditorReady(page, editorId);

        const fileInput = page.locator('input#image-file');
        await expect(fileInput).toBeAttached();
        await fileInput.setInputFiles(FIXTURE_PNG_PATH);

        await waitForDraftSaved(page, editorId);

        const idbRecords = await getStoredImagesFromIDB(page, editorId);
        expect(idbRecords.length).toBeGreaterThan(0);
        const record = idbRecords.find(
          (r) => r.editor === editorId && r.name === 'sample.png' && r.size === FIXTURE_PNG_SIZE
        );
        expect(record).toBeDefined();
        expect(record?.editor).toBe(editorId);
        expect(record?.name).toBe('sample.png');
        expect(record?.mime).toBe('image/png');
        expect(record?.size).toBe(FIXTURE_PNG_SIZE);
        expect(record?.dataBase64).toBe(FIXTURE_PNG_B64);

        const editorImg = page.locator('#editor-host img').first();
        await expect(editorImg).toBeVisible({ timeout: 10_000 });
        const imgSrc = await editorImg.getAttribute('src');
        expect(imgSrc).toMatch(/__images\/[a-zA-Z0-9_-]+/);
        expect(imgSrc).not.toContain('data:image/');

        const draft = await getEditorDraft(page, editorId);
        expect(draft?.snapshot).not.toContain('data:image/png;base64');

        await page.reload();
        await waitForEditorReady(page, editorId);

        const reloadedImg = page.locator('#editor-host img').first();
        await expect(reloadedImg).toBeVisible({ timeout: 10_000 });
        const naturalWidth = await reloadedImg.evaluate((img: HTMLImageElement) => img.naturalWidth);
        expect(naturalWidth).toBe(1);

        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('#export-html').click(),
        ]);
        const stream = await download.createReadStream();
        if (!stream) {
          throw new Error('Download read stream was null');
        }
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        const exportedHTML = Buffer.concat(chunks).toString('utf-8');

        expect(exportedHTML).toMatch(/<!doctype\s+html>/i);
        expect(exportedHTML).toMatch(/charset=["']?utf-8["']?/i);
        expect(exportedHTML).toContain(`data:image/png;base64,${FIXTURE_PNG_B64}`);
      });

      test('renders dedicated #print-document-view with content, media source anchors, and no editor chrome', async ({
        page,
      }) => {
        await page.goto(`${editorId}/`);
        await waitForEditorReady(page, editorId);

        const printNote = '列印專用內容驗證 Print Document View Check';
        await typeIntoEditor(page, editorId, printNote);
        await waitForDraftSaved(page, editorId, { expectedText: printNote });

        await page.locator('#insert-media').click();
        const urlInput = page.locator('input#source-url');
        await expect(urlInput).toBeVisible();
        await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        await page.locator('#source-submit').click();
        await waitForDraftSaved(page, editorId);

        await page.evaluate(() => {
          window.print = () => {};
        });

        const printButton = page.locator('#print-document');
        await printButton.click();

        const printView = page.locator('#print-document-view');
        await expect(printView).toBeAttached({ timeout: 10_000 });
        await expect(printView).toContainText(printNote);

        await expect(printView.locator('#shared-commands')).toHaveCount(0);
        await expect(printView.locator('#save-status')).toHaveCount(0);
        await expect(printView.locator('#error-status')).toHaveCount(0);
        await expect(
          printView.locator('.trumbowyg-button-pane')
        ).toHaveCount(0);

        await expect(printView.locator('iframe, video, audio')).toHaveCount(0);
        const sourceAnchor = printView.locator('a[href*="youtube.com/watch?v=dQw4w9WgXcQ"]');
        await expect(sourceAnchor).toBeAttached();
      });
    });
  }
});
