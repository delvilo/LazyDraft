import EditorJS, {
  type OutputData,
  type OutputBlockData,
  type BlockTool,
  type BlockToolConstructorOptions,
  type ToolboxConfig,
  type API,
  type BlockAPI,
} from '@editorjs/editorjs';
import Header from '@editorjs/header';
import EditorjsList from '@editorjs/list';
import Quote from '@editorjs/quote';
import Code from '@editorjs/code';
import Undo from 'editorjs-undo';
import type {
  EditorFactory,
  EditorHandle,
  EditorContext,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';
import { createMediaElement, mediaHTML, cleanFragment } from '../media.ts';

export interface ImageData {
  url: string;
  caption: string;
}

export class ImageBlockTool implements BlockTool {
  static get toolbox(): ToolboxConfig {
    return {
      title: 'Image',
      icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v118c0 19 15 34 34 34h206c-19 0-34-15-34-34zm-85-45l40 45H90l35-40 25 30 56-35z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  private api: API;
  private readOnly: boolean;
  private context?: EditorContext;
  private data: ImageData;
  private block?: BlockAPI;
  private wrapper?: HTMLElement;

  constructor(options: BlockToolConstructorOptions<ImageData, { context?: EditorContext }>) {
    this.api = options.api;
    this.readOnly = options.readOnly;
    this.context = options.config?.context;
    this.block = options.block;
    this.data = {
      url: options.data?.url || '',
      caption: options.data?.caption || '',
    };
  }

  render(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cdx-block lab-image-block';
    this.wrapper = wrapper;

    if (this.data.url) {
      this.renderImage(wrapper);
    } else {
      this.renderPicker(wrapper);
    }

    return wrapper;
  }

  private renderImage(container: HTMLElement): void {
    container.innerHTML = '';

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'lab-image-block__image-wrapper';

    const img = document.createElement('img');
    img.src = this.data.url;
    img.alt = this.data.caption;
    img.className = 'lab-image-block__image';
    imgWrapper.appendChild(img);

    const caption = document.createElement('div');
    caption.className = 'cdx-input lab-image-block__caption';
    caption.contentEditable = !this.readOnly ? 'true' : 'false';
    caption.setAttribute('data-placeholder', '輸入圖片說明...');
    caption.textContent = this.data.caption;
    caption.addEventListener('input', () => {
      this.data.caption = caption.textContent || '';
    });

    container.appendChild(imgWrapper);
    container.appendChild(caption);
  }

  private renderPicker(container: HTMLElement): void {
    container.innerHTML = '';

    const picker = document.createElement('div');
    picker.className = 'lab-image-block__picker';

    const pickButton = document.createElement('button');
    pickButton.type = 'button';
    pickButton.className = 'cdx-button lab-image-block__button';
    pickButton.textContent = '選擇圖片檔案';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.style.display = 'none';

    pickButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.context) {
        this.context.pickImage();
      } else {
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (file && this.context) {
        try {
          const stored = await this.context.storeImage(file);
          this.data.url = stored.src;
          this.data.caption = stored.alt || file.name;
          this.renderImage(container);
          if (this.block) {
            this.api.events.emit('block-changed', { block: this.block });
          }
        } catch (err: unknown) {
          this.context.onError(err);
        }
      }
    });

    picker.appendChild(pickButton);
    picker.appendChild(fileInput);
    container.appendChild(picker);
  }

  public updateData(image: ImageSource): void {
    this.data.url = image.src;
    this.data.caption = image.alt;
    if (this.wrapper) {
      this.renderImage(this.wrapper);
    }
  }

  save(blockContent: HTMLElement): ImageData {
    const img = blockContent.querySelector<HTMLImageElement>('img');
    const captionEl = blockContent.querySelector<HTMLElement>('.lab-image-block__caption');
    const url = img?.getAttribute('src') || this.data.url || '';
    const caption = captionEl?.textContent?.trim() || this.data.caption || '';
    return { url, caption };
  }

  validate(savedData: ImageData): boolean {
    return typeof savedData.url === 'string' && savedData.url.trim().length > 0;
  }
}

export interface MediaData {
  kind: 'video' | 'audio' | 'youtube' | 'vimeo';
  url: string;
  embedUrl?: string;
}

export class MediaBlockTool implements BlockTool {
  static get toolbox(): ToolboxConfig {
    return {
      title: 'Media',
      icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M120 70v136l110-68z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  private api: API;
  private readOnly: boolean;
  private context?: EditorContext;
  private data: MediaData;
  private block?: BlockAPI;
  private wrapper?: HTMLElement;

  constructor(options: BlockToolConstructorOptions<MediaData, { context?: EditorContext }>) {
    this.api = options.api;
    this.readOnly = options.readOnly;
    this.context = options.config?.context;
    this.block = options.block;
    this.data = {
      kind: options.data?.kind || 'video',
      url: options.data?.url || '',
      embedUrl: options.data?.embedUrl,
    };
  }

  render(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cdx-block lab-media-block';
    this.wrapper = wrapper;

    if (this.data.url) {
      this.renderMedia(wrapper);
    } else {
      this.renderPicker(wrapper);
    }

    return wrapper;
  }

  private renderMedia(container: HTMLElement): void {
    container.innerHTML = '';
    const mediaSource: MediaSource =
      this.data.kind === 'youtube' || this.data.kind === 'vimeo'
        ? {
            kind: this.data.kind,
            url: this.data.url,
            embedUrl: this.data.embedUrl || this.data.url,
          }
        : {
            kind: this.data.kind,
            url: this.data.url,
          };

    const mediaEl = createMediaElement(mediaSource);
    mediaEl.contentEditable = 'false';
    container.appendChild(mediaEl);
  }

  private renderPicker(container: HTMLElement): void {
    container.innerHTML = '';
    const picker = document.createElement('div');
    picker.className = 'lab-media-block__picker';

    const reqButton = document.createElement('button');
    reqButton.type = 'button';
    reqButton.className = 'cdx-button lab-media-block__button';
    reqButton.textContent = '輸入影音 / 串流網址';

    reqButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.context) {
        this.context.requestMedia();
      }
    });

    picker.appendChild(reqButton);
    container.appendChild(picker);
  }

  save(): MediaData {
    return {
      kind: this.data.kind,
      url: this.data.url,
      embedUrl: this.data.embedUrl,
    };
  }

  validate(savedData: MediaData): boolean {
    return typeof savedData.url === 'string' && savedData.url.trim().length > 0;
  }
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderListItems(items: readonly unknown[]): string {
  return items
    .map((item) => {
      if (typeof item === 'string') {
        return `<li>${item}</li>`;
      }
      if (typeof item === 'object' && item !== null) {
        const content =
          'content' in item && typeof item.content === 'string'
            ? item.content
            : 'text' in item && typeof item.text === 'string'
            ? item.text
            : '';
        const sub =
          'items' in item && Array.isArray(item.items) && item.items.length > 0
            ? `<ul>${renderListItems(item.items)}</ul>`
            : '';
        return `<li>${content}${sub}</li>`;
      }
      return '';
    })
    .join('');
}

function renderBlockToHTML(block: OutputBlockData): string {
  const data = block.data;
  if (typeof data !== 'object' || data === null) {
    return '';
  }
  switch (block.type) {
    case 'paragraph': {
      const text = 'text' in data && typeof data.text === 'string' ? data.text : '';
      return `<p>${text}</p>`;
    }
    case 'header': {
      const text = 'text' in data && typeof data.text === 'string' ? data.text : '';
      const level =
        'level' in data && typeof data.level === 'number' && data.level >= 1 && data.level <= 6
          ? data.level
          : 2;
      return `<h${level}>${text}</h${level}>`;
    }
    case 'list': {
      const items = 'items' in data && Array.isArray(data.items) ? data.items : [];
      const isOrdered = 'style' in data && data.style === 'ordered';
      const rendered = renderListItems(items);
      return isOrdered ? `<ol>${rendered}</ol>` : `<ul>${rendered}</ul>`;
    }
    case 'quote': {
      const text = 'text' in data && typeof data.text === 'string' ? data.text : '';
      const caption =
        'caption' in data && typeof data.caption === 'string' && data.caption.trim()
          ? `<cite>${escapeHTML(data.caption.trim())}</cite>`
          : '';
      return `<blockquote><p>${text}</p>${caption}</blockquote>`;
    }
    case 'code': {
      const code = 'code' in data && typeof data.code === 'string' ? data.code : '';
      return `<pre><code>${escapeHTML(code)}</code></pre>`;
    }
    case 'image': {
      const url = 'url' in data && typeof data.url === 'string' ? data.url : '';
      const caption =
        'caption' in data && typeof data.caption === 'string'
          ? data.caption
          : 'alt' in data && typeof data.alt === 'string'
          ? data.alt
          : '';
      if (!url) return '';
      const captionTag = caption ? `<figcaption>${escapeHTML(caption)}</figcaption>` : '';
      return `<figure class="lab-image-container"><img src="${escapeAttr(url)}" alt="${escapeAttr(caption)}" />${captionTag}</figure>`;
    }
    case 'media': {
      const kind =
        'kind' in data &&
        (data.kind === 'video' ||
          data.kind === 'audio' ||
          data.kind === 'youtube' ||
          data.kind === 'vimeo')
          ? data.kind
          : 'video';
      const url = 'url' in data && typeof data.url === 'string' ? data.url : '';
      const embedUrl = 'embedUrl' in data && typeof data.embedUrl === 'string' ? data.embedUrl : '';
      if (!url) return '';
      if (kind === 'youtube' || kind === 'vimeo') {
        return mediaHTML({ kind, url, embedUrl: embedUrl || url });
      }
      return mediaHTML({ kind, url });
    }
    default: {
      if ('text' in data && typeof data.text === 'string') {
        return `<p>${data.text}</p>`;
      }
      return '';
    }
  }
}

interface BlockText {
  html: string;
  plainText: string;
}

function getTextFromBlock(block: BlockAPI): BlockText {
  const fields = Array.from(block.holder.querySelectorAll<HTMLElement>('[contenteditable="true"], textarea'));
  return {
    html: fields.map((field) => field instanceof HTMLTextAreaElement
      ? escapeHTML(field.value).replace(/\n/g, '<br>')
      : field.innerHTML).join('<br>'),
    plainText: fields.map((field) => field instanceof HTMLTextAreaElement
      ? field.value
      : field.innerText).join('\n'),
  };
}

const nativeBlockTypes: Record<string, true | undefined> = {
  paragraph: true, header: true, list: true, quote: true, code: true, image: true, media: true,
};

function isValidBlock(val: unknown): val is OutputBlockData {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  if (!('type' in val && 'data' in val)) return false;
  return typeof val.type === 'string' && nativeBlockTypes[val.type] === true &&
    typeof val.data === 'object' && val.data !== null && !Array.isArray(val.data);
}

function isValidEditorJSSnapshot(val: unknown): val is OutputData {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  return 'blocks' in val && Array.isArray(val.blocks) && val.blocks.every(isValidBlock);
}

const createEditorjsEditor: EditorFactory = async (context: EditorContext): Promise<EditorHandle> => {
  let initialData: OutputData | undefined;
  if (context.initialSnapshot !== null) {
    const parsed: unknown = JSON.parse(context.initialSnapshot);
    if (!isValidEditorJSSnapshot(parsed)) throw new Error('Invalid Editor.js snapshot format');
    initialData = parsed;
  }

  const holder = document.createElement('div');
  holder.className = 'editor-input editorjs-holder';
  context.host.appendChild(holder);
  let isReady = false;
  const editor = new EditorJS({
    holder,
    data: initialData,
    autofocus: false,
    tools: {
      header: { class: Header, inlineToolbar: true, config: { levels: [1, 2, 3, 4, 5, 6], defaultLevel: 2 } },
      list: { class: EditorjsList, inlineToolbar: true, config: { defaultStyle: 'unordered' } },
      quote: { class: Quote, inlineToolbar: true },
      code: { class: Code },
      image: { class: ImageBlockTool, config: { context } },
      media: { class: MediaBlockTool, config: { context } },
    },
    onChange: () => {
      if (isReady) context.onChange();
    },
  });
  await editor.isReady;

  const undo = new Undo({ editor, config: { debounceTimer: 100 } });
  const initial = await editor.save();
  undo.initialize({
    blocks: initial.blocks.length ? initial.blocks : [{
      id: editor.blocks.getBlockByIndex(0)?.id, type: 'paragraph', data: { text: '' },
    }],
  });
  let rememberedBlockIndex: number | null = null;
  let rememberedRange: Range | null = null;

  async function checkpoint(): Promise<void> {
    const data = await editor.save();
    const blocks = data.blocks.length ? data.blocks : [{
      id: editor.blocks.getBlockByIndex(0)?.id, type: 'paragraph', data: { text: '' },
    }];
    if (undo.editorDidUpdate(blocks)) undo.save(blocks);
  }

  function restoreSelection(): number {
    const index = rememberedBlockIndex ?? editor.blocks.getCurrentBlockIndex();
    const range = rememberedRange;
    rememberedBlockIndex = null;
    rememberedRange = null;
    if (range && holder.contains(range.startContainer) && holder.contains(range.endContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return index;
  }

  const contentObserver = new MutationObserver((records) => {
    if (records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return target?.closest('.ce-block__content') ||
        Array.from(record.addedNodes).some((node) => node instanceof Element && node.matches('.ce-block')) ||
        Array.from(record.removedNodes).some((node) => node instanceof Element && node.matches('.ce-block'));
    })) context.onChange();
  });
  const redactor = holder.querySelector('.codex-editor__redactor');
  if (!redactor) throw new Error('Editor.js did not create its document surface');
  contentObserver.observe(redactor, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style', 'href', 'src', 'data-checked'],
  });

  const handle = {
    async getSnapshot(): Promise<string> {
      return JSON.stringify(await editor.save());
    },
    async getHTML(): Promise<string> {
      const data = await editor.save();
      return cleanFragment(data.blocks.map(renderBlockToHTML).join('\n'));
    },
    async command(cmd: FormatCommand): Promise<void> {
      const index = restoreSelection();
      await checkpoint();
      if (cmd.kind === 'undo' || cmd.kind === 'redo') {
        await undo[cmd.kind]();
        context.onChange();
        return;
      }
      if (cmd.kind === 'bold' || cmd.kind === 'italic' || cmd.kind === 'link') {
        if (cmd.kind === 'link') {
          const selection = window.getSelection();
          if (cmd.url && (!selection || selection.isCollapsed)) {
            const anchor = document.createElement('a');
            anchor.href = cmd.url;
            anchor.textContent = cmd.url;
            document.execCommand('insertHTML', false, anchor.outerHTML);
          } else {
            document.execCommand(cmd.url ? 'createLink' : 'unlink', false, cmd.url);
          }
        } else {
          document.execCommand(cmd.kind);
        }
        editor.blocks.getBlockByIndex(index)?.dispatchChange();
      } else {
        const current = index >= 0 ? editor.blocks.getBlockByIndex(index) : undefined;
        const replace = current !== undefined && nativeBlockTypes[current.name] === true &&
          current.name !== 'image' && current.name !== 'media';
        const text = replace ? getTextFromBlock(current) : { html: '', plainText: '' };
        let type: string;
        let data: OutputBlockData['data'];
        switch (cmd.kind) {
          case 'heading':
            type = current?.name === 'header' ? 'paragraph' : 'header';
            data = { text: text.html, level: 2 };
            break;
          case 'quote':
            type = current?.name === 'quote' ? 'paragraph' : 'quote';
            data = { text: text.html, caption: '' };
            break;
          case 'codeBlock':
            type = current?.name === 'code' ? 'paragraph' : 'code';
            data = type === 'paragraph' ? { text: text.html } : { code: text.plainText };
            break;
          case 'bulletList':
          case 'orderedList': {
            type = 'list';
            const previous = current?.name === 'list' ? await current.save() : undefined;
            data = {
              ...(previous ? previous.data : { items: [{ content: text.html, meta: {}, items: [] }] }),
              style: cmd.kind === 'bulletList' ? 'unordered' : 'ordered',
            };
            break;
          }
          default: {
            const exhaustive: never = cmd.kind;
            throw new Error(`Unhandled command ${JSON.stringify(exhaustive)}`);
          }
        }
        editor.blocks.insert(type, data, undefined,
          index >= 0 ? index + (replace ? 0 : 1) : undefined, true, replace);
      }
      context.onChange();
      await checkpoint();
    },
    rememberSelection(): void {
      const index = editor.blocks.getCurrentBlockIndex();
      rememberedBlockIndex = index >= 0 ? index : null;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      rememberedRange = range && holder.contains(range.startContainer) && holder.contains(range.endContainer)
        ? range.cloneRange() : null;
    },
    async insertImage(image: ImageSource): Promise<void> {
      const index = restoreSelection();
      await checkpoint();
      const current = index >= 0 ? editor.blocks.getBlockByIndex(index) : undefined;
      const replace = current !== undefined && (current.isEmpty ||
        (current.name === 'image' && !current.holder.querySelector('img')));
      editor.blocks.insert('image', { url: image.src, caption: image.alt }, undefined,
        index >= 0 ? index + (replace ? 0 : 1) : undefined, true, replace);
      context.onChange();
      await checkpoint();
    },
    async insertMedia(media: MediaSource): Promise<void> {
      const index = restoreSelection();
      await checkpoint();
      const current = index >= 0 ? editor.blocks.getBlockByIndex(index) : undefined;
      const replace = current !== undefined && (current.isEmpty ||
        (current.name === 'media' && !current.holder.querySelector('video, audio, iframe')));
      editor.blocks.insert('media', {
        kind: media.kind, url: media.url, embedUrl: 'embedUrl' in media ? media.embedUrl : undefined,
      }, undefined, index >= 0 ? index + (replace ? 0 : 1) : undefined, true, replace);
      context.onChange();
      await checkpoint();
    },
    focus(): void {
      editor.focus(true);
    },
    destroy(): void {
      isReady = false;
      contentObserver.disconnect();
      holder.removeEventListener('keydown', onKeyDown, true);
      holder.removeEventListener('pointerdown', forgetSelection);
      holder.removeEventListener('input', forgetSelection);
      editor.destroy();
      holder.remove();
    },
  } satisfies EditorHandle;
  function forgetSelection(): void {
    rememberedBlockIndex = null;
    rememberedRange = null;
  }
  function onKeyDown(event: KeyboardEvent): void {
    forgetSelection();
    if (event.isComposing || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void handle.command({ kind: key === 'y' || event.shiftKey ? 'redo' : 'undo' }).catch(context.onError);
  }
  holder.addEventListener('keydown', onKeyDown, true);
  holder.addEventListener('pointerdown', forgetSelection);
  holder.addEventListener('input', forgetSelection);
  isReady = true;
  return handle;
};

export default createEditorjsEditor;
