import { test, expect } from '@playwright/test';
import {
  ALL_EDITORS, waitForEditorReady, typeIntoEditor, waitForDraftSaved, getEditorDraft, readExportedHTML,
  executeFormatCommand,
} from './helpers.ts';
import { readFileSync } from 'node:fs';

const fixtureImage = {
  name: 'sample.png',
  mimeType: 'image/png',
  buffer: readFileSync(new URL('./fixtures/sample.png', import.meta.url)),
};

const mediaCases = [
  { url: 'https://example.test/clip.mp4', selector: 'video[src="https://example.test/clip.mp4"]' },
  { url: 'https://example.test/sound.mp3', selector: 'audio[src="https://example.test/sound.mp3"]' },
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', selector: 'iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]' },
  { url: 'https://vimeo.com/76979871', selector: 'iframe[src="https://player.vimeo.com/video/76979871"]' },
];

for (const editorId of ALL_EDITORS) {
  test(`${editorId} preserves four media sources through native restore, HTML and print`, async ({ page }) => {
    await page.goto(`${editorId}/`);
    await waitForEditorReady(page, editorId);
    await typeIntoEditor(page, editorId, '影音筆記與來源保留');
    await waitForDraftSaved(page, editorId, { expectedText: '影音筆記與來源保留' });
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('ArrowRight');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '本機圖片', exact: true }).click(),
    ]);
    await chooser.setFiles(fixtureImage);
    await waitForDraftSaved(page, editorId, { expectedText: '__images/' });
    const image = page.locator('#editor-host img[src*="__images/"]');
    await expect(image).toHaveJSProperty('naturalWidth', 1);
    for (const media of mediaCases) {
      const before = await getEditorDraft(page, editorId);
      await page.locator('#insert-media').click();
      await page.locator('#source-url').fill(media.url);
      await page.locator('#source-submit').click();
      await waitForDraftSaved(page, editorId, { expectedText: media.url, minRevision: (before?.revision ?? 0) + 1 });
      await expect(page.locator(`#editor-host ${media.selector}`)).toHaveCount(1);
      await expect(image).toHaveCount(1);
    }
    await page.reload();
    await waitForEditorReady(page, editorId);
    for (const media of mediaCases) {
      await expect(page.locator(`#editor-host ${media.selector}`)).toHaveCount(1);
    }
    await expect(image).toHaveJSProperty('naturalWidth', 1);
    const html = await readExportedHTML(page);
    const exported = await page.evaluate(({ html, cases }) => {
      const document = new DOMParser().parseFromString(html, 'text/html');
      return {
        note: document.body.textContent,
        players: cases.map((media) => document.body.querySelector(media.selector)?.getAttribute('data-lab-source')),
      };
    }, { html, cases: mediaCases });
    expect(exported.note).toContain('影音筆記與來源保留');
    expect(exported.players).toEqual(mediaCases.map((media) => media.url));
    expect(html).toContain(`data:image/png;base64,${fixtureImage.buffer.toString('base64')}`);

    await page.evaluate(() => {
      window.print = () => { document.body.dataset.printRequested = 'true'; };
    });
    await page.locator('#print-document').click();
    await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true');
    const paper = page.locator('#print-document-view');
    await expect(paper).toContainText('影音筆記與來源保留');
    await expect(paper.locator('iframe, video, audio')).toHaveCount(0);
    await expect(paper.locator('img')).toHaveJSProperty('naturalWidth', 1);
    for (const media of mediaCases) {
      await expect(paper.locator(`a[href="${media.url}"]`)).toHaveCount(1);
    }
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(paper).toHaveCount(0);
    await expect(page.locator('#editor-host')).toBeVisible();
  });
}

test('rejects arbitrary frames and executable media URLs without changing the saved note', async ({ page }) => {
  await page.goto('tiptap/');
  await waitForEditorReady(page, 'tiptap');
  await typeIntoEditor(page, 'tiptap', '保留這份草稿');
  const before = await waitForDraftSaved(page, 'tiptap', { expectedText: '保留這份草稿' });
  for (const url of ['javascript:alert(1)', 'https://example.test/arbitrary-frame']) {
    await page.locator('#insert-media').click();
    await page.locator('#source-url').fill(url);
    await page.locator('#source-submit').click();
    await expect(page.locator('#error-status')).toBeVisible();
    expect((await getEditorDraft(page, 'tiptap'))?.snapshot).toBe(before.snapshot);
    await expect(page.locator('#editor-host iframe')).toHaveCount(0);
  }
});

test('jodit inserts media at the caret as one valid undo step without deleting surrounding text', async ({ page }) => {
  await page.goto('jodit/');
  await waitForEditorReady(page, 'jodit');
  await typeIntoEditor(page, 'jodit', '前段文字後段文字');
  await waitForDraftSaved(page, 'jodit', { expectedText: '前段文字後段文字' });
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#editor-host .jodit-wysiwyg');
    if (!root) throw new Error('Missing Jodit editor');
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.textContent?.includes('前段文字')) text = walker.nextNode();
    if (!text) throw new Error('Missing caret target');
    const range = document.createRange();
    range.setStart(text, 4);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) throw new Error('Selection unavailable');
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const source = 'https://example.test/history.mp3';
  await page.locator('#insert-media').click();
  await page.locator('#source-url').fill(source);
  await page.locator('#source-submit').click();
  const inserted = await waitForDraftSaved(page, 'jodit', { expectedText: source });
  const root = page.locator('#editor-host .jodit-wysiwyg');
  await expect(root.locator('p p, p figure, p div')).toHaveCount(0);
  const html = await root.innerHTML();
  expect(html.indexOf('前段文字')).toBeLessThan(html.indexOf(source));
  expect(html.indexOf(source)).toBeLessThan(html.indexOf('後段文字'));
  await executeFormatCommand(page, 'undo');
  const undone = await waitForDraftSaved(page, 'jodit', {
    expectedText: '前段文字',
    minRevision: inserted.revision + 1,
  });
  expect(undone.snapshot).not.toContain(source);
  expect((await root.textContent())?.replace(/\s/g, '')).toBe('前段文字後段文字');
  await executeFormatCommand(page, 'redo');
  await waitForDraftSaved(page, 'jodit', {
    expectedText: source,
    minRevision: undone.revision + 1,
  });
  await expect(root.locator('audio')).toHaveAttribute('src', source);
  await expect(root.locator('p p, p figure, p div')).toHaveCount(0);
  expect((await root.textContent())?.replace(/\s/g, '')).toBe('前段文字後段文字');
});
