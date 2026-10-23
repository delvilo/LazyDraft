import suneditor from 'suneditor';
import plugins from 'suneditor/plugins';
import 'suneditor/css/editor';
import 'suneditor/css/contents';
import 'suneditor/src/themes/dark.css';
import { cleanFragment, mediaHTML } from '../media.ts';
import type {
  EditorContext,
  EditorFactory,
  EditorHandle,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';

function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const docTheme =
    document.documentElement.getAttribute('data-theme') ||
    document.body.getAttribute('data-theme');
  if (docTheme) return docTheme === 'dark';
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


const createSunEditorAdapter: EditorFactory = async (
  context: EditorContext
): Promise<EditorHandle> => {
  const target = document.createElement('textarea');
  context.host.appendChild(target);

  const { promise: readyPromise, resolve: resolveReady, reject: rejectReady } =
    Promise.withResolvers<void>();
  const fallbackTimer = setTimeout(() => rejectReady(new Error('SunEditor 初始化逾時。')), 10_000);

  let savedRange: Range | null = null;
  let isInitialized = false;

  const editor = suneditor.create(target, {
    plugins,
    buttonList: [
      ['undo', 'redo'],
      ['blockStyle', 'fontSize'],
      ['bold', 'underline', 'italic', 'strike'],
      ['fontColor', 'backgroundColor'],
      ['list_bulleted', 'list_numbered'],
      ['blockquote', 'codeBlock'],
      ['table', 'link', 'image', 'video'],
      ['fullScreen', 'showBlocks', 'codeView'],
    ],
    allowedClassName: '^__se__|^se-|^katex|^MathJax|^language-|^lab-media-',
    attributeWhitelist: { '*': 'data-lab-media|data-lab-source' },
    image: {
      createFileInput: true,
      createUrlInput: true,
      defaultFormatType: 'inline',
      canResize: true,
    },
    events: {
      onload: () => {
        resolveReady();
      },
      onChange: () => {
        if (isInitialized) {
          context.onChange();
        }
      },
      onImageUploadBefore: async (params) => {
        const rawFiles = params.info?.files;
        if (rawFiles && rawFiles.length > 0) {
          try {
            const fileList = Array.from(rawFiles);
            for (let i = 0; i < fileList.length; i++) {
              const file = fileList[i];
              if (file instanceof File) {
                const stored = await context.storeImage(file);
                const imgHtml = `<img src="${escapeAttr(stored.src)}" alt="${escapeAttr(stored.alt || '')}" />`;
                editor.$.html.insert(imgHtml, { skipCleaning: true });
                editor.$.history.push(false);
              }
            }
            editor.$.plugins.image?.modal?.close();
            context.onChange();
          } catch (err) {
            context.onError(err);
          }
          return false;
        }


        return true;
      },
    },
  });

  if (editor.$.store?._editorInitFinished) {
    resolveReady();
  }
  await readyPromise;
  clearTimeout(fallbackTimer);

  if (editor.$.plugins.video) {
    editor.$.plugins.video.open = () => {
      context.requestMedia();
    };
  }
  editor.$.plugins.image.open = () => context.pickImage();

  const toolbar = editor.$.context.get('toolbar_main');
  if (toolbar) {
    toolbar.addEventListener(
      'click',
      (e: MouseEvent) => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const btn = targetEl?.closest('button[data-command="video"]');
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          context.requestMedia();
        }
      },
      { capture: true }
    );
  }

  if (context.initialSnapshot !== null) {
    editor.$.html.set(context.initialSnapshot);
    editor.$.history.reset();
  }

  isInitialized = true;
  const editable = editor.$.frameContext.get('wysiwyg');
  // SunEditor's change notification is debounced; DOM input must persist before navigation.
  const onInput = () => context.onChange();
  editable.addEventListener('input', onInput);
  const forgetSavedRange = () => {
    savedRange = null;
  };
  editable.addEventListener('pointerdown', forgetSavedRange);
  editable.addEventListener('keydown', forgetSavedRange);

  function syncTheme(): void {
    const isDark = isDarkTheme();
    const wrapper = editor.$.frameContext.get('topArea');
    const editable = editor.$.frameContext.get('wysiwyg');
    if (isDark) {
      wrapper?.classList.add('se-theme-dark');
      editable?.classList.add('se-theme-dark');
    } else {
      wrapper?.classList.remove('se-theme-dark');
      editable?.classList.remove('se-theme-dark');
    }
  }

  const themeObserver = new MutationObserver(() => syncTheme());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  syncTheme();

  function restoreSavedSelection(): void {
    const range = savedRange;
    savedRange = null;
    if (range && editable.contains(range.startContainer) && editable.contains(range.endContainer)) {
      editor.$.selection.setRange(range);
    }
  }

  function runNativeCommand(command: string): void {
    const button = toolbar?.querySelector<HTMLElement>(
      `button[data-command="${command}"]:not([data-type="dropdown"])`
    );
    if (!button) throw new Error(`未載入 SunEditor 命令 ${command}。`);
    editor.$.commandDispatcher.runFromTarget(button);
  }

  const handle: EditorHandle = {
    getSnapshot: () => {
      const snap = editor.$.html.get();
      return typeof snap === 'string' ? snap : '';
    },
    getHTML: () => {
      const raw = editor.$.html.get();
      return cleanFragment(typeof raw === 'string' ? raw : '');
    },
    command: (command: FormatCommand) => {
      restoreSavedSelection();
      if (command.kind !== 'undo' && command.kind !== 'redo') editor.$.history.push(false);
      switch (command.kind) {
        case 'bold':
          runNativeCommand('bold');
          break;
        case 'italic':
          runNativeCommand('italic');
          break;
        case 'heading': {
          const selNode = editor.$.selection.getNode();
          const currentEl =
            selNode instanceof Element
              ? selNode
              : selNode?.parentElement instanceof Element
                ? selNode.parentElement
                : null;
          const isHeading = Boolean(
            currentEl?.closest('h1, h2, h3, h4, h5, h6')
          );
          if (isHeading) {
            editor.$.format.setLine(document.createElement('p'));
          } else {
            editor.$.format.setLine(document.createElement('h2'));
          }
          editor.$.history.push(false);
          break;
        }
        case 'bulletList':
          runNativeCommand('list_bulleted');
          break;
        case 'orderedList':
          runNativeCommand('list_numbered');
          break;
        case 'quote':
          runNativeCommand('blockquote');
          break;
        case 'codeBlock':
          runNativeCommand('codeBlock');
          break;
        case 'undo':
          editor.$.history.undo();
          break;
        case 'redo':
          editor.$.history.redo();
          break;
        case 'link': {
          const sel = editor.$.selection.get();
          if (sel.isCollapsed) {
            const a = document.createElement('a');
            a.href = command.url;
            a.textContent = command.url;
            editor.$.html.insertNode(a);
          } else {
            const a = document.createElement('a');
            a.href = command.url;
            editor.$.inline.apply(a);
          }
          editor.$.history.push(false);
          break;
        }
        default: {
          const _exhaustive: never = command;
          return _exhaustive;
        }
      }
      context.onChange();
    },
    rememberSelection: () => {
      const range = editor.$.selection.getRange();
      savedRange =
        editable.contains(range.startContainer) && editable.contains(range.endContainer)
          ? range.cloneRange()
          : null;
    },
    insertImage: (image: ImageSource) => {
      restoreSavedSelection();
      editor.$.history.push(false);
      const imgHtml = `<img src="${escapeAttr(image.src)}" alt="${escapeAttr(image.alt || '')}" />`;
      editor.$.html.insert(imgHtml, { skipCleaning: true });
      editor.$.history.push(false);
      context.onChange();
    },
    insertMedia: (media: MediaSource) => {
      restoreSavedSelection();
      editor.$.history.push(false);
      const html = mediaHTML(media);
      editor.$.html.insert(html, { skipCleaning: true });
      editor.$.history.push(false);
      context.onChange();
    },
    focus: () => {
      editor.$.focusManager.focus();
    },
    destroy: () => {
      editable.removeEventListener('input', onInput);
      editable.removeEventListener('pointerdown', forgetSavedRange);
      editable.removeEventListener('keydown', forgetSavedRange);
      themeObserver.disconnect();
      try {
        editor.destroy();
      } catch (err) {
        context.onError(err);
      }
      target.remove();
    },
  };

  return handle;
};

export default createSunEditorAdapter;
