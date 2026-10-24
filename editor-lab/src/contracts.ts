export const EDITOR_IDS = ['squire', 'trix', 'tiptap', 'lexical', 'editorjs', 'trumbowyg'] as const;
export type EditorId = typeof EDITOR_IDS[number];

export type FormatCommand =
  | { kind: 'bold' | 'italic' | 'heading' | 'bulletList' | 'orderedList' | 'quote' | 'codeBlock' | 'undo' | 'redo' }
  | { kind: 'link'; url: string };

export type MediaSource =
  | { kind: 'video' | 'audio'; url: string }
  | { kind: 'youtube' | 'vimeo'; url: string; embedUrl: string };

export interface ImageSource {
  src: string;
  alt: string;
}

export interface EditorContext {
  host: HTMLElement;
  initialSnapshot: string | null;
  onChange: () => void;
  onError: (error: unknown) => void;
  storeImage: (file: File) => Promise<ImageSource>;
  pickImage: () => void;
  requestMedia: () => void;
}

export interface EditorHandle {
  getSnapshot: () => string | Promise<string>;
  getHTML: () => string | Promise<string>;
  command: (command: FormatCommand) => void | Promise<void>;
  rememberSelection: () => void;
  insertImage: (image: ImageSource) => void | Promise<void>;
  insertMedia: (media: MediaSource) => void | Promise<void>;
  focus: () => void;
  destroy: () => void;
}

export type EditorFactory = (context: EditorContext) => Promise<EditorHandle>;

export interface EditorDescription {
  name: string;
  package: string;
  version: string;
  license: string;
  format: string;
  nativeUI: boolean;
  source: string;
  summary: string;
  integration: string;
  nativeFeatures: string;
  risk: string;
}

export interface DraftRecord {
  schema: 1;
  editor: EditorId;
  snapshot: string;
  revision: number;
  savedAt: number;
}

export type SaveState =
  | { kind: 'ready' }
  | { kind: 'dirty' | 'saving'; revision: number }
  | { kind: 'saved'; revision: number; savedAt: number }
  | { kind: 'error'; message: string };
