import type { EditorFactory, EditorId } from './contracts.ts';

const modules = import.meta.glob<{ default: EditorFactory }>('./adapters/*.ts');

export async function loadEditor(id: EditorId): Promise<EditorFactory> {
  const load = modules[`./adapters/${id}.ts`];
  if (!load) throw new Error(`找不到 ${id} 編輯器模組。`);
  return (await load()).default;
}
