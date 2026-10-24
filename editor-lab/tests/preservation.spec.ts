import { test, expect } from '@playwright/test';
import { ALL_EDITORS, waitForEditorReady, typeIntoEditor, waitForDraftSaved } from './helpers.ts';

test.describe('Existing Data Preservation & Storage Namespace Isolation', () => {
  const SEED_RICH_NOTES = JSON.stringify({
    version: 1,
    notes: [
      { id: 'ancient-note-1', title: '重要舊筆記', content: '<p>使用者珍貴資料，絕對不可被覆蓋</p>' },
    ],
  });
  const SEED_RICH_NOTES_MODE = 'rich';
  const SEED_PLAIN_NOTES = '使用者原有純文字筆記內容 1234567890';

  test.beforeEach(async ({ page }) => {
    await page.goto('./');

    await page.evaluate(
      ({ richNotes, richNotesMode, plainNotes }) => {
        localStorage.setItem('richNotes', richNotes);
        localStorage.setItem('richNotesMode', richNotesMode);
        localStorage.setItem('notes', plainNotes);
      },
      {
        richNotes: SEED_RICH_NOTES,
        richNotesMode: SEED_RICH_NOTES_MODE,
        plainNotes: SEED_PLAIN_NOTES,
      }
    );

    await page.evaluate(() => {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = indexedDB.open('NotesDB', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        store.put({ id: 'ancient-note-1', data: 'critical-root-app-payload' });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      return promise;
    });
  });

  test('preserves root richNotes, plain notes, and NotesDB intact after extensive lab usage', async ({
    page,
  }) => {
    const testEditors = ALL_EDITORS;

    for (const editorId of testEditors) {
      await page.goto(`${editorId}/`);
      await waitForEditorReady(page, editorId);

      const noteText = `隔離測試筆記 ${editorId} Isolation Check`;
      await typeIntoEditor(page, editorId, noteText);
      await waitForDraftSaved(page, editorId, { expectedText: noteText });
    }

    await page.goto('./');

    const storageCheck = await page.evaluate(() => {
      const richNotes = localStorage.getItem('richNotes');
      const richNotesMode = localStorage.getItem('richNotesMode');
      const notes = localStorage.getItem('notes');

      const nonLabKeys: string[] = [];
      const labKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('lazydraft-editor-lab:')) {
          labKeys.push(key);
        } else {
          nonLabKeys.push(key);
        }
      }

      return {
        richNotes,
        richNotesMode,
        notes,
        nonLabKeys,
        labKeys,
      };
    });

    expect(storageCheck.richNotes).toBe(SEED_RICH_NOTES);
    expect(storageCheck.richNotesMode).toBe(SEED_RICH_NOTES_MODE);
    expect(storageCheck.notes).toBe(SEED_PLAIN_NOTES);

    expect(storageCheck.labKeys.length).toBeGreaterThanOrEqual(testEditors.length);
    for (const key of storageCheck.labKeys) {
      expect(key).toMatch(/^lazydraft-editor-lab:/);
    }

    const dbCheck = await page.evaluate(() => {
      const { promise, resolve, reject } = Promise.withResolvers<{ id: string; data: string } | null>();
      const req = indexedDB.open('NotesDB', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const getReq = store.get('ancient-note-1');
        getReq.onerror = () => {
          db.close();
          reject(getReq.error);
        };
        getReq.onsuccess = () => {
          db.close();
          const record = getReq.result as unknown;
          if (typeof record === 'object' && record !== null && 'id' in record && 'data' in record) {
            resolve({
              id: typeof record.id === 'string' ? record.id : '',
              data: typeof record.data === 'string' ? record.data : '',
            });
          } else {
            resolve(null);
          }
        };
      };
      return promise;
    });

    expect(dbCheck).not.toBeNull();
    expect(dbCheck?.id).toBe('ancient-note-1');
    expect(dbCheck?.data).toBe('critical-root-app-payload');
  });
});
