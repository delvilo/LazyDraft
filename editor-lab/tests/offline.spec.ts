import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  ALL_EDITORS,
  waitForEditorReady,
  waitForOfflineReady,
  typeIntoEditor,
  waitForDraftSaved,
  getEditorDraft,
  getEditorEditable,
  getStoredImagesFromIDB,
  readExportedHTML,
} from './helpers.ts';

const imagePath = fileURLToPath(new URL('./fixtures/sample.png', import.meta.url));
const imageBase64 = readFileSync(imagePath).toString('base64');

test('all ten editors restore original local images, export HTML and prepare print while offline', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await waitForOfflineReady(page, 60_000);
  await context.setOffline(true);

  try {
    for (const editorId of ALL_EDITORS) {
      await page.goto(`${editorId}/`);
      await waitForEditorReady(page, editorId);
      const note = `離線筆記 ${editorId} 繁體中文 🚀`;
      await typeIntoEditor(page, editorId, note);
      await waitForDraftSaved(page, editorId, { expectedText: note });
      await page.locator('#image-file').setInputFiles(imagePath);
      await waitForDraftSaved(page, editorId, { expectedText: '__images/' });

      const images = await getStoredImagesFromIDB(page, editorId);
      const original = images.find(image => image.name === 'sample.png');
      expect(original?.mime).toBe('image/png');
      expect(original?.dataBase64).toBe(imageBase64);

      await page.reload();
      await waitForEditorReady(page, editorId);
      await waitForOfflineReady(page);
      expect((await getEditorDraft(page, editorId))?.snapshot).toContain(note);
      await expect(getEditorEditable(page, editorId)).toContainText(note);
      await expect(page.locator('#editor-host img[src*="__images/"]').first())
        .toHaveJSProperty('naturalWidth', 1);

      const html = await readExportedHTML(page);
      expect(html).toMatch(/<!doctype\s+html>/i);
      expect(html).toMatch(/charset=["']?utf-8["']?/i);
      const exportedText = await page.evaluate(value =>
        new DOMParser().parseFromString(value, 'text/html').body.textContent, html);
      expect(exportedText?.replaceAll('\u00a0', ' ')).toContain(note);
      expect(html).toContain(`data:image/png;base64,${imageBase64}`);

      await page.evaluate(() => {
        window.print = () => {
          document.documentElement.dataset.offlinePrintCalled = 'true';
        };
      });
      await page.locator('#print-document').click();
      await page.waitForFunction(() =>
        document.documentElement.dataset.offlinePrintCalled === 'true');
      const printed = await page.locator('#print-document-view').evaluate(view => {
        const paper = view.shadowRoot;
        const image = paper?.querySelector('img');
        return {
          text: paper?.textContent,
          imageWidth: image?.naturalWidth,
          controls: paper?.querySelectorAll('button, textarea, .app-navbar').length,
        };
      });
      expect(printed.text?.replaceAll('\u00a0', ' ')).toContain(note);
      expect(printed.imageWidth).toBe(1);
      expect(printed.controls).toBe(0);
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await expect(page.locator('#print-document-view')).toHaveCount(0);
    }
  } finally {
    await context.setOffline(false);
  }
});
