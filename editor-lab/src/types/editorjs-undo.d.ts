declare module 'editorjs-undo' {
  import type EditorJS from '@editorjs/editorjs';
  import type { OutputBlockData } from '@editorjs/editorjs';

  export interface UndoShortcuts {
    undo?: string;
    redo?: string;
  }

  export interface UndoConfig {
    debounceTimer?: number;
    maxLength?: number;
    shortcuts?: UndoShortcuts;
  }

  export interface UndoOptions {
    editor: EditorJS;
    config?: UndoConfig;
    maxLength?: number;
    onUpdate?: () => void;
  }

  export default class Undo {
    constructor(options: UndoOptions);
    initialize(initialData: unknown): void;
    editorDidUpdate(blocks: OutputBlockData[]): boolean;
    save(blocks: OutputBlockData[]): void;
    undo(): Promise<void>;
    redo(): Promise<void>;
    clear(): void;
  }
}
