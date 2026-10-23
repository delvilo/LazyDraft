import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { test, expect } from '@playwright/test';
import { waitForEditorReady } from './helpers.ts';
import type { EditorHandle, SaveState } from '../src/contracts.ts';
import type * as SessionModule from '../src/session.ts';

let sessionModule = '';
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('../src/session.ts', import.meta.url)), formats: ['es'] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    if (!('output' in output)) continue;
    for (const file of output.output) {
      if (file.type === 'chunk' && file.isEntry) sessionModule = file.code;
    }
  }
  if (!sessionModule) throw new Error('The real session module was not compiled');
});

test('a newer edit during asynchronous serialization never publishes the older snapshot', async ({ page }) => {
  await page.goto('pell/');
  await waitForEditorReady(page, 'pell');
  const result = await page.evaluate(async (source) => {
    // The browser loads Vite's in-memory output, not the Node runner's module instance.
    const module: typeof SessionModule = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    const firstStarted = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const saved = Promise.withResolvers<void>();
    const states: SaveState[] = [];
    let calls = 0;
    const unexpected = (): never => { throw new Error('Unexpected editor operation in a persistence scenario'); };
    const adapter: EditorHandle = {
      getSnapshot: () => {
        calls++;
        if (calls === 1) {
          firstStarted.resolve();
          return first.promise;
        }
        secondStarted.resolve();
        return second.promise;
      },
      getHTML: unexpected, command: unexpected, rememberSelection: unexpected,
      insertImage: unexpected, insertMedia: unexpected, focus: unexpected, destroy: unexpected,
    };
    const session = module.createSession({
      id: 'editorjs', adapter,
      onState: (state) => {
        states.push(state);
        if (state.kind === 'saved') saved.resolve();
      },
    });
    session.changed();
    await firstStarted.promise;
    session.changed();
    first.resolve('舊快照');
    const next = await Promise.race([
      secondStarted.promise.then(() => 'next'),
      saved.promise.then(() => 'saved'),
    ]);
    const intermediate = localStorage.getItem('lazydraft-editor-lab:v1:draft:editorjs');
    second.resolve('最新筆記');
    await saved.promise;
    const draft = module.readDraft('editorjs');
    session.dispose();
    return { next, intermediate, draft, states, calls };
  }, sessionModule);
  expect(result.next).toBe('next');
  expect(result.intermediate).toBeNull();
  expect(result.calls).toBe(2);
  expect(result.draft?.snapshot).toBe('最新筆記');
  expect(result.draft?.revision).toBe(2);
  expect(result.states.filter((state) => state.kind === 'saved')).toEqual([
    expect.objectContaining({ kind: 'saved', revision: 2 }),
  ]);
});
