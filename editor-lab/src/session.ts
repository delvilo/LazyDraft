import type { DraftRecord, EditorHandle, EditorId, SaveState } from './contracts.ts';
import schema from './schema.json';

export interface EditorSession {
  changed(): void;
  saveNow(): Promise<void>;
  dispose(): void;
}

interface SaveWaiter {
  targetRevision: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export function readDraft(id: EditorId): DraftRecord | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const key = `${schema.draftPrefix}${id}`;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch (err) {
    throw new Error(`Failed to read draft from localStorage: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Corrupt draft JSON for editor "${id}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!isDraftRecord(parsed, id)) {
    throw new Error(`Corrupt draft envelope for editor "${id}": schema mismatch`);
  }

  return parsed;
}

function isDraftRecord(val: unknown, expectedEditor: EditorId): val is DraftRecord {
  return (
    typeof val === 'object' &&
    val !== null &&
    'schema' in val &&
    val.schema === 1 &&
    'editor' in val &&
    val.editor === expectedEditor &&
    'snapshot' in val &&
    typeof val.snapshot === 'string' &&
    'revision' in val &&
    typeof val.revision === 'number' && Number.isSafeInteger(val.revision) && val.revision >= 0 &&
    'savedAt' in val &&
    typeof val.savedAt === 'number' && Number.isFinite(val.savedAt) && val.savedAt >= 0
  );
}

export function createSession({
  id,
  adapter,
  onState,
}: {
  id: EditorId;
  adapter: EditorHandle;
  onState: (state: SaveState) => void;
}): EditorSession {
  const existingDraft = readDraft(id);
  let currentRevision = existingDraft?.revision ?? 0;

  let isSaving = false;
  let isDisposed = false;
  let isGettingSnapshot = false;
  let needsSave = false;
  let queued = false;

  const waiters: SaveWaiter[] = [];

  function resolveWaiters(persistedRevision: number): void {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].targetRevision <= persistedRevision) {
        const [w] = waiters.splice(i, 1);
        w.resolve();
      }
    }
  }

  function rejectAllWaiters(err: unknown): void {
    const list = waiters.splice(0, waiters.length);
    for (const w of list) {
      w.reject(err);
    }
  }

  async function runSaveLoop(): Promise<void> {
    if (isSaving || isDisposed) return;
    isSaving = true;

    while (needsSave && !isDisposed) {
      needsSave = false;
      const revisionToSave = currentRevision;
      onState({ kind: 'saving', revision: revisionToSave });

      let snapshot: string;
      try {
        isGettingSnapshot = true;
        const result = adapter.getSnapshot();
        isGettingSnapshot = false;
        snapshot = await result;
      } catch (err) {
        isSaving = false;
        const msg = err instanceof Error ? err.message : String(err);
        onState({ kind: 'error', message: `Snapshot serialization failed: ${msg}` });
        rejectAllWaiters(err);
        return;
      } finally {
        isGettingSnapshot = false;
      }

      if (isDisposed) {
        break;
      }

      if (revisionToSave !== currentRevision) continue;

      const savedAt = Date.now();
      const draft: DraftRecord = {
        schema: 1,
        editor: id,
        snapshot,
        revision: revisionToSave,
        savedAt,
      };

      const key = `${schema.draftPrefix}${id}`;
      try {
        localStorage.setItem(key, JSON.stringify(draft));
      } catch (err) {
        isSaving = false;
        const msg = err instanceof Error ? err.message : String(err);
        onState({ kind: 'error', message: `Storage quota or access error: ${msg}` });
        rejectAllWaiters(err);
        return;
      }

      resolveWaiters(revisionToSave);

      // Status saved only when persisted catches latest
      if (!needsSave) {
        onState({ kind: 'saved', revision: revisionToSave, savedAt });
      }
    }

    isSaving = false;
  }

  function scheduleSave(): void {
    if (isDisposed) return;
    if (!isSaving && !queued) {
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!isSaving && needsSave && !isDisposed) void runSaveLoop();
      });
    }
  }

  function changed(): void {
    if (isDisposed) return;
    // Synchronous serialization callbacks are not user edits; asynchronous edits must still queue.
    if (isGettingSnapshot) return;

    currentRevision++;
    needsSave = true;
    onState({ kind: 'dirty', revision: currentRevision });
    scheduleSave();
  }

  function saveNow(): Promise<void> {
    if (isDisposed) {
      return Promise.reject(new Error('Session has been disposed'));
    }
    currentRevision++;
    needsSave = true;
    const targetRevision = currentRevision;
    const pending = Promise.withResolvers<void>();
    waiters.push({
      targetRevision,
      resolve: pending.resolve,
      reject: pending.reject,
    });

    if (!isSaving) {
      void runSaveLoop();
    }
    return pending.promise;
  }

  function dispose(): void {
    isDisposed = true;
    needsSave = false;
    rejectAllWaiters(new Error('Session disposed'));
  }

  onState({ kind: 'ready' });

  return {
    changed,
    saveNow,
    dispose,
  };
}
