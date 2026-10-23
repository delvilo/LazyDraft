import { Buffer } from 'node:buffer';
import type { Page, Locator } from '@playwright/test';

export type EditorId =
  | 'pell'
  | 'squire'
  | 'jodit'
  | 'suneditor'
  | 'quill'
  | 'trix'
  | 'tiptap'
  | 'milkdown'
  | 'lexical'
  | 'editorjs';

export const ALL_EDITORS: readonly EditorId[] = [
  'pell',
  'squire',
  'jodit',
  'suneditor',
  'quill',
  'trix',
  'tiptap',
  'milkdown',
  'lexical',
  'editorjs',
] as const;

export const EDITOR_EDITABLE_SELECTORS: Record<EditorId, string> = {
  pell: '#editor-host .pell-content',
  squire: '#editor-host [contenteditable="true"]',
  jodit: '#editor-host .jodit-wysiwyg',
  suneditor: '#editor-host .sun-editor-editable',
  quill: '#editor-host .ql-editor',
  trix: '#editor-host trix-editor',
  tiptap: '#editor-host .ProseMirror',
  milkdown: '#editor-host .ProseMirror',
  lexical: '#editor-host [data-lexical-editor="true"]',
  editorjs: '#editor-host .ce-paragraph, #editor-host .ce-block__content',
};

export interface DraftRecordShape {
  schema: 1;
  editor: string;
  snapshot: string;
  revision: number;
  savedAt: number;
}

export interface StoredImageRecord {
  id: string;
  editor: string;
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
}

export async function waitForEditorReady(page: Page, editorId?: EditorId, timeoutMs = 15_000): Promise<void> {
  if (editorId) {
    await page.waitForSelector(`body[data-editor="${editorId}"][data-editor-ready="true"]`, { timeout: timeoutMs });
  } else {
    await page.waitForSelector('body[data-editor-ready="true"]', { timeout: timeoutMs });
  }
}

export function getEditorEditable(page: Page, editorId: EditorId): Locator {
  return page.locator(EDITOR_EDITABLE_SELECTORS[editorId]).first();
}

export function getEditorContent(page: Page, editorId: EditorId): Locator {
  return editorId === 'editorjs'
    ? page.locator('#editor-host .codex-editor__redactor')
    : getEditorEditable(page, editorId);
}

export async function typeIntoEditor(page: Page, editorId: EditorId, text: string): Promise<void> {
  const editable = getEditorEditable(page, editorId);
  await editable.click({ timeout: 5000 });
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) await page.keyboard.press('Enter');
    const line = lines[index];
    if (line) await page.keyboard.insertText(line);
  }
}

export async function openSharedCommands(page: Page): Promise<void> {
  await page.locator('details#shared-commands').evaluate((details: HTMLDetailsElement) => {
    details.open = true;
  });
}

export async function executeFormatCommand(page: Page, commandKind: string): Promise<void> {
  await openSharedCommands(page);
  const button = page.locator(`details#shared-commands button[data-command="${commandKind}"]`);
  await button.click();
}

export async function waitForDraftSaved(
  page: Page,
  editorId: EditorId,
  options?: { expectedText?: string; minRevision?: number; timeoutMs?: number }
): Promise<DraftRecordShape> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const expectedText = options?.expectedText;
  const minRevision = options?.minRevision;

  await page.waitForFunction(
    ({ id, text, minRev }) => {
      const saveEl = document.getElementById('save-status');
      if (!saveEl) return false;
      const state = saveEl.getAttribute('data-state') || saveEl.dataset.state;
      if (state !== 'saved' && !(saveEl.textContent || '').includes('已儲存')) {
        return false;
      }
      const raw = localStorage.getItem(`lazydraft-editor-lab:v1:draft:${id}`);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || parsed.schema !== 1) return false;
        if (typeof minRev === 'number' && parsed.revision < minRev) return false;
        if (typeof text === 'string' && typeof parsed.snapshot === 'string' && !parsed.snapshot.includes(text)) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    { id: editorId, text: expectedText, minRev: minRevision },
    { timeout: timeoutMs }
  );

  const draft = await getEditorDraft(page, editorId);
  if (!draft) {
    throw new Error(`Draft record missing for ${editorId}`);
  }
  return draft;
}

export async function getEditorDraft(page: Page, editorId: EditorId): Promise<DraftRecordShape | null> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem(`lazydraft-editor-lab:v1:draft:${id}`);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'schema' in parsed &&
        parsed.schema === 1 &&
        'editor' in parsed &&
        typeof parsed.editor === 'string' &&
        'snapshot' in parsed &&
        typeof parsed.snapshot === 'string' &&
        'revision' in parsed &&
        typeof parsed.revision === 'number' &&
        'savedAt' in parsed &&
        typeof parsed.savedAt === 'number'
      ) {
        return {
          schema: 1,
          editor: parsed.editor,
          snapshot: parsed.snapshot,
          revision: parsed.revision,
          savedAt: parsed.savedAt,
        };
      }
      return null;
    } catch {
      return null;
    }
  }, editorId);
}

export async function getStoredImagesFromIDB(page: Page, editorId: EditorId): Promise<StoredImageRecord[]> {
  return page.evaluate((targetEditor) => {
    const { promise, resolve, reject } = Promise.withResolvers<StoredImageRecord[]>();
    const req = indexedDB.open('lazydraft-editor-lab-assets', 1);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('images')) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      const getAllReq = store.getAll();
      getAllReq.onerror = () => {
        db.close();
        reject(getAllReq.error);
      };
      getAllReq.onsuccess = async () => {
        db.close();
        const rawList: unknown = getAllReq.result;
        if (!Array.isArray(rawList)) {
          resolve([]);
          return;
        }
        const results: StoredImageRecord[] = [];
        for (const item of rawList) {
          if (
            typeof item === 'object' &&
            item !== null &&
            'id' in item &&
            'editor' in item &&
            item.editor === targetEditor &&
            'name' in item &&
            'mime' in item
          ) {
            const id = typeof item.id === 'string' ? item.id : String(item.id);
            const editor = typeof item.editor === 'string' ? item.editor : '';
            const name = typeof item.name === 'string' ? item.name : '';
            const mime = typeof item.mime === 'string' ? item.mime : '';
            let size = 0;
            let dataBase64 = '';
            if ('blob' in item && item.blob instanceof Blob) {
              size = item.blob.size;
              const buffer = await item.blob.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              dataBase64 = btoa(binary);
            }
            results.push({ id, editor, name, mime, size, dataBase64 });
          }
        }
        resolve(results);
      };
    };
    return promise;
  }, editorId);
}

export async function waitForOfflineReady(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('offline-status');
      if (!el) return false;
      const text = el.textContent || '';
      const isReadyAttr = el.dataset.ready === 'true' || el.getAttribute('data-ready') === 'true';
      return isReadyAttr || text.includes('離線可用');
    },
    null,
    { timeout: timeoutMs }
  );
}

export async function readExportedHTML(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-html').click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('HTML export stream unavailable');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
