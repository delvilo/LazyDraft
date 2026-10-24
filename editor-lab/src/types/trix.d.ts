declare module 'trix' {
  export interface TrixAttachmentAttributes {
    url?: string;
    href?: string;
    filename?: string;
    filesize?: number;
    contentType?: string;
    previewable?: boolean;
    caption?: string;
    content?: string;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }

  export class Attachment {
    id: number;
    file?: File | null;
    constructor(attributes?: TrixAttachmentAttributes);
    getAttribute(name: string): unknown;
    hasAttribute(name: string): boolean;
    setAttribute(name: string, value: unknown): void;
    setAttributes(attributes: TrixAttachmentAttributes): void;
    getAttributes(): TrixAttachmentAttributes;
    isPending(): boolean;
    isPreviewable(): boolean;
    getURL(): string | undefined;
    getHref(): string | undefined;
    getFilename(): string;
    getContent(): string | undefined;
    setFile(file: File): void;
    releaseFile(): void;
    toJSON(): TrixAttachmentAttributes;
  }

  export class Document {
    static fromJSON(documentJSON: unknown): Document;
    static fromString(string: string, textAttributes?: Record<string, unknown>): Document;
    getLength(): number;
    toString(): string;
  }

  export interface TrixSnapshot {
    document: unknown;
    selectedRange: [number, number];
  }

  export interface Editor {
    loadDocument(document: Document): void;
    loadHTML(html: string): void;
    loadJSON(snapshot: { document: unknown; selectedRange: [number, number] }): void;
    loadSnapshot(snapshot: TrixSnapshot): void;
    getDocument(): Document;
    getSnapshot(): TrixSnapshot;
    toJSON(): TrixSnapshot;
    insertAttachment(attachment: Attachment): void;
    insertAttachments(attachments: Attachment[]): void;
    insertHTML(html: string): void;
    insertString(string: string): void;
    insertLineBreak(): void;
    getSelectedRange(): [number, number];
    setSelectedRange(selectedRange: [number, number] | number): void;
    activateAttribute(name: string, value?: unknown): void;
    deactivateAttribute(name: string): void;
    attributeIsActive(name: string): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    recordUndoEntry(description: string, options?: { context?: unknown; consolidatable?: boolean }): void;
  }

  export interface TrixConfig {
    blockAttributes: Record<string, unknown>;
    textAttributes: Record<string, unknown>;
    undo: { interval: number };
    [key: string]: unknown;
  }

  export const config: TrixConfig;
  export const elements: {
    TrixToolbarElement: typeof HTMLElement;
    TrixEditorElement: typeof HTMLElement;
  };

  const Trix: {
    config: TrixConfig;
    elements: {
      TrixToolbarElement: typeof HTMLElement;
      TrixEditorElement: typeof HTMLElement;
    };
    Attachment: typeof Attachment;
    Document: typeof Document;
  };

  export default Trix;
}

declare module 'trix/dist/trix.css';
