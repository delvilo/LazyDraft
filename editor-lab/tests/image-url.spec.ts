import { test, expect } from '@playwright/test';
import { ALL_EDITORS, getEditorEditable, readExportedHTML, typeIntoEditor, waitForDraftSaved, waitForEditorReady } from './helpers.ts';

for (const editorId of ALL_EDITORS) {
  test(`${editorId} restores and exports an HTTP image URL without changing the note`, async ({ page }) => {
    await page.goto(`${editorId}/`);
    await waitForEditorReady(page, editorId);
    await typeIntoEditor(page, editorId, '圖片網址前的筆記');
    const before = await waitForDraftSaved(page, editorId, { expectedText: '圖片網址前的筆記' });
    const source = new URL('../../tests/fixtures/sample.png', page.url()).href;
    await page.locator('#insert-image-url').click();
    await page.locator('#source-url').fill(source);
    await page.locator('#source-submit').click();
    await waitForDraftSaved(page, editorId, { expectedText: source, minRevision: before.revision + 1 });
    const image = page.locator(`#editor-host img[src="${source}"]`);
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
    await page.reload();
    await waitForEditorReady(page, editorId);
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
    await expect(getEditorEditable(page, editorId)).toContainText('圖片網址前的筆記');
    const html = await readExportedHTML(page);
    const exported = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, 'text/html');
      return { text: document.body.textContent, sources: Array.from(document.body.querySelectorAll('img')).map((image) => image.getAttribute('src')) };
    }, html);
    expect(exported.text).toContain('圖片網址前的筆記');
    expect(exported.sources).toEqual([source]);
  });
}
