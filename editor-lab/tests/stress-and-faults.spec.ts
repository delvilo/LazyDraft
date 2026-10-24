import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  ALL_EDITORS,
  waitForEditorReady,
  typeIntoEditor,
  waitForDraftSaved,
  getEditorDraft,
  getEditorEditable,
} from './helpers.ts';

test.describe('Stress Testing, IME Composition Flow & Fault Injection', () => {
  test('stresses Editor.js async save queue with rapid sequential inputs', async ({ page }) => {
    const editorId = 'editorjs';
    await page.goto(`${editorId}/`);
    await waitForEditorReady(page, editorId);

    const editable = getEditorEditable(page, editorId);
    await editable.click();

    const rapidChars = '快速連續輸入測試壓力驗證1234567890';
    for (let i = 0; i < rapidChars.length; i++) {
      await page.keyboard.type(rapidChars[i], { delay: 10 });
    }

    const draft = await waitForDraftSaved(page, editorId, { expectedText: rapidChars });
    expect(draft.editor).toBe(editorId);
    expect(draft.snapshot).toContain(rapidChars);
  });

  for (const editorId of ALL_EDITORS) {
    test(`${editorId} defers composition snapshots until committed text survives reload`, async ({
      page,
      browserName,
    }) => {
      await page.goto(`${editorId}/`);
      await waitForEditorReady(page, editorId);
      await page.evaluate(() => {
        const trace = document.createElement('output');
        trace.id = 'composition-write-probe';
        trace.hidden = true;
        document.body.append(trace);
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
          setItem.call(this, key, value);
          if (this === localStorage) trace.append(value);
        };
      });
      const editable = getEditorEditable(page, editorId);
      const preedit = 'ㄓㄨˋㄧㄣ';
      const committed = '注音輸入完成 🚀';
      await editable.click();

      if (browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.imeSetComposition', {
          text: preedit,
          selectionStart: 0,
          selectionEnd: preedit.length,
          replacementStart: 0,
          replacementEnd: 0,
        });
        await expect(editable).toContainText(preedit);
        await cdp.send('Input.insertText', { text: committed });
        await cdp.detach();
      } else {
        await editable.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', {
          bubbles: true,
          composed: true,
          data: '',
        })));
        await editable.evaluate((node, value) => {
          node.focus();
          document.execCommand('insertText', false, value);
        }, preedit);
        await editable.evaluate((node, value) => node.dispatchEvent(new CompositionEvent('compositionupdate', {
          bubbles: true,
          composed: true,
          data: value,
        })), preedit);
        await expect(editable).toContainText(preedit);
        await editable.evaluate((root, text) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let target = walker.nextNode();
          while (target && !target.textContent?.includes(text)) target = walker.nextNode();
          if (!target?.textContent) throw new Error('Composition text node missing');
          const start = target.textContent.indexOf(text);
          const range = document.createRange();
          range.setStart(target, start);
          range.setEnd(target, start + text.length);
          const selection = window.getSelection();
          if (!selection) throw new Error('Selection unavailable');
          selection.removeAllRanges();
          selection.addRange(range);
        }, preedit);
        await page.keyboard.insertText(committed);
        await editable.evaluate((node, value) => node.dispatchEvent(new CompositionEvent('compositionend', {
          bubbles: true,
          composed: true,
          data: value,
        })), committed);
      }

      const draft = await waitForDraftSaved(page, editorId, { expectedText: committed });
      expect(draft.snapshot).not.toContain(preedit);
      await expect(page.locator('#composition-write-probe')).not.toContainText(preedit);
      await page.reload();
      await waitForEditorReady(page, editorId);
      await expect(getEditorEditable(page, editorId)).toContainText(committed);
    });
  }

  test('handles IndexedDB write failure gracefully with visible alert and preserves editor text', async ({
    page,
  }) => {
    const editorId = 'trumbowyg';
    await page.goto(`${editorId}/`);
    await waitForEditorReady(page, editorId);

    const initialText = '重要筆記防止因磁碟失敗消失 Critical Note Content';
    await typeIntoEditor(page, editorId, initialText);
    const before = await waitForDraftSaved(page, editorId, { expectedText: initialText });

    await page.evaluate(() => {
      const originalOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = function (...args: Parameters<typeof originalOpen>) {
        const req = originalOpen(...args);
        req.addEventListener('success', () => {
          const db = req.result;
          const origTx = db.transaction.bind(db);
          db.transaction = function (...txArgs: Parameters<typeof origTx>) {
            const tx = origTx(...txArgs);
            if (tx.mode === 'readwrite') {
              queueMicrotask(() => {
                tx.abort();
                document.body.dataset.imageWriteAborted = 'true';
              });
            }
            return tx;
          };
        });
        return req;
      };
    });

    const fileInput = page.locator('input#image-file');
    await fileInput.setInputFiles({
      name: 'test-fail.png',
      mimeType: 'image/png',
      buffer: readFileSync(new URL('./fixtures/sample.png', import.meta.url)),
    });

    const errorStatus = page.locator('#error-status');
    await expect(errorStatus).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toHaveAttribute('data-image-write-aborted', 'true');
    expect((await getEditorDraft(page, editorId))?.snapshot).toBe(before.snapshot);

    const editable = getEditorEditable(page, editorId);
    expect(await editable.innerText()).toContain(initialText);
  });

  test('handles localStorage quota exceeded error gracefully and preserves on-screen draft', async ({
    page,
  }) => {
    const editorId = 'trumbowyg';
    await page.goto(`${editorId}/`);
    await waitForEditorReady(page, editorId);

    const initialText = '配額不足錯誤注入測試 Quota Exceeded';
    await typeIntoEditor(page, editorId, initialText);
    await waitForDraftSaved(page, editorId, { expectedText: initialText });

    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });

    const appendText = '！後續文字不可遺失';
    await page.keyboard.insertText(appendText);

    await page.waitForFunction(
      () => {
        const saveEl = document.getElementById('save-status');
        const errEl = document.getElementById('error-status');
        const saveText = saveEl?.textContent || '';
        const errText = errEl?.textContent || '';
        return saveText.includes('失敗') || saveText.includes('錯誤') || errText.length > 0;
      },
      null,
      { timeout: 10_000 }
    );

    const editable = getEditorEditable(page, editorId);
    const content = await editable.innerText();
    expect(content).toContain(initialText);
    expect(content).toContain(appendText);
  });
});

for (const editorId of ['trix', 'tiptap', 'lexical', 'editorjs'] as const) {
  for (const snapshot of ['', '{}']) {
    test(`${editorId} preserves an invalid native snapshot ${JSON.stringify(snapshot)}`, async ({ page }) => {
      await page.goto('./');
      const raw = JSON.stringify({ schema: 1, editor: editorId, snapshot, revision: 7, savedAt: 123 });
      await page.evaluate(({ editorId, raw }) => {
        localStorage.setItem(`lazydraft-editor-lab:v1:draft:${editorId}`, raw);
      }, { editorId, raw });
      await page.goto(`${editorId}/`);
      await expect(page.locator('#error-status')).toBeVisible();
      await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
      await expect(page.locator('#editor-host')).toHaveJSProperty('inert', true);
      expect(await page.evaluate((id) => localStorage.getItem(`lazydraft-editor-lab:v1:draft:${id}`), editorId)).toBe(raw);
    });
  }
}
