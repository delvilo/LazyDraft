import { cleanFragment } from './media.ts';

export interface HTMLDocumentOptions {
  title: string;
  html: string;
}

export function createHTMLDocument({ title, html }: HTMLDocumentOptions): string {
  const safeTitle = escapeHTML(title || 'Document');

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    :root, :host {
      --paper-bg: #ffffff;
      --paper-text: #1e293b;
      --paper-border: #e2e8f0;
      --paper-muted: #64748b;
      --paper-code-bg: #f8fafc;
      --paper-link: #2563eb;
    }

    @page {
      margin: 20mm;
      size: auto;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    body, :host {
      margin: 0;
      padding: 40px 20px;
      background: #f1f5f9;
      color: var(--paper-text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
      line-height: 1.75;
      font-size: 16px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .paper {
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 56px;
      background: var(--paper-bg);
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
      word-break: break-word;
    }

    h1, h2, h3, h4, h5, h6 {
      color: #0f172a;
      font-weight: 600;
      line-height: 1.35;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }
    h1:first-child, h2:first-child, h3:first-child {
      margin-top: 0;
    }
    h1 { font-size: 2em; }
    h2 { font-size: 1.6em; }
    h3 { font-size: 1.3em; }
    h4 { font-size: 1.1em; }

    p {
      margin: 0.8em 0;
    }

    a {
      color: var(--paper-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    blockquote {
      margin: 1.2em 0;
      padding: 0.6em 1.2em;
      border-left: 4px solid #94a3b8;
      background: var(--paper-code-bg);
      color: #334155;
      border-radius: 0 4px 4px 0;
    }
    blockquote p {
      margin: 0.4em 0;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.875em;
      background: var(--paper-code-bg);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      border: 1px solid var(--paper-border);
    }

    pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      background: var(--paper-code-bg);
      border: 1px solid var(--paper-border);
      border-radius: 6px;
      padding: 1em 1.2em;
      overflow-x: auto;
      font-size: 0.9em;
      line-height: 1.5;
      margin: 1.2em 0;
    }
    pre code {
      background: transparent;
      padding: 0;
      border: none;
      font-size: 1em;
    }

    ul, ol {
      margin: 0.8em 0;
      padding-left: 1.8em;
    }
    li {
      margin: 0.3em 0;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.2em 0;
    }
    th, td {
      border: 1px solid var(--paper-border);
      padding: 8px 14px;
      text-align: left;
    }
    th {
      background: var(--paper-code-bg);
      font-weight: 600;
    }

    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1.2em auto;
      border-radius: 4px;
    }

    hr {
      border: 0;
      height: 1px;
      background: var(--paper-border);
      margin: 2em 0;
    }

    .lab-media-embed {
      position: relative;
      width: 100%;
      padding-bottom: 56.25%;
      height: 0;
      overflow: hidden;
      margin: 1.5em 0;
      border-radius: 6px;
      background: #000;
    }
    .lab-media-embed iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }

    video, audio {
      max-width: 100%;
      display: block;
      margin: 1.2em 0;
    }
    audio {
      width: 100%;
    }

    .print-media-box {
      margin: 1em 0;
      padding: 10px 14px;
      background: var(--paper-code-bg);
      border: 1px solid var(--paper-border);
      border-radius: 6px;
      font-size: 0.9em;
    }
    .print-media-link {
      color: var(--paper-link);
      word-break: break-all;
    }

    /* Native editor class support */
    .ql-align-center { text-align: center; }
    .ql-align-right { text-align: right; }
    .ql-align-justify { text-align: justify; }
    .ce-header { font-weight: 600; line-height: 1.35; margin: 1em 0 0.4em; }
    .ce-paragraph { margin: 0.8em 0; }
    .ce-code { background: var(--paper-code-bg); border: 1px solid var(--paper-border); border-radius: 4px; padding: 1em; font-family: monospace; }
    .attachment { display: inline-block; max-width: 100%; }

    @media print {
      body, :host {
        background: #ffffff;
        padding: 0;
        margin: 0;
      }
      .paper {
        max-width: 100%;
        margin: 0;
        padding: 0;
        box-shadow: none;
        border-radius: 0;
      }
      .lab-media-embed, video, audio {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <main class="paper">${cleanFragment(html)}</main>
</body>
</html>`;
}

export function downloadHTML(documentHtml: string, filename: string): void {
  if (typeof document === 'undefined') {
    throw new Error('downloadHTML requires a browser environment');
  }
  const blob = new Blob([documentHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'document.html';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function printDocument(documentHtml: string): Promise<void> {
  document.querySelector('body > #print-document-view')?.remove();
  document.querySelector('head > #print-document-styles')?.remove();
  const parsed = new DOMParser().parseFromString(documentHtml, 'text/html');
  replaceMediaWithSourceAnchors(parsed.body);

  const container = document.createElement('div');
  container.id = 'print-document-view';
  const projection = container.attachShadow({ mode: 'open' });
  for (const style of parsed.head.querySelectorAll('style')) projection.append(style.cloneNode(true));
  const content = document.createElement('div');
  content.innerHTML = parsed.body.innerHTML;
  projection.append(content);

  const style = document.createElement('style');
  style.id = 'print-document-styles';
  style.textContent = `
    @media screen {
      #print-document-view { position: fixed; left: -10000px; top: 0; width: 800px; visibility: hidden; pointer-events: none; }
    }
    @media print {
      @page { margin: 20mm; }
      html, body { display: block !important; min-height: 0 !important; background: white !important; color: black !important; margin: 0 !important; padding: 0 !important; }
      body > *:not(#print-document-view) { display: none !important; }
      #print-document-view { display: block !important; visibility: visible !important; position: static !important; width: 100% !important; margin: 0 !important; padding: 0 !important; }
    }
  `;
  const cleanup = () => {
    container.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  document.head.append(style);
  document.body.append(container);
  try {
    await document.fonts.ready;
    await Promise.all(Array.from(projection.querySelectorAll('img'), async (image) => {
      const pending = Promise.withResolvers<void>();
      const timer = window.setTimeout(() => pending.reject(new Error('列印圖片載入逾時，請檢查圖片網址或網路連線。')), 5000);
      image.decode().then(pending.resolve, pending.reject);
      try {
        await pending.promise;
      } finally {
        window.clearTimeout(timer);
      }
    }));
    const layout = Promise.withResolvers<void>();
    requestAnimationFrame(() => requestAnimationFrame(() => layout.resolve()));
    await layout.promise;
    window.addEventListener('afterprint', cleanup);
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}

function replaceMediaWithSourceAnchors(root: Element): void {
  for (const player of root.querySelectorAll('iframe, video, audio')) {
    const source = player.getAttribute('data-lab-source') || player.getAttribute('src') || player.querySelector('source')?.getAttribute('src');
    if (!source) throw new Error('影音缺少可列印的來源網址。');
    const url = new URL(source, document.baseURI);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('影音來源僅支援 HTTP 或 HTTPS 網址。');
    const box = document.createElement('div');
    box.className = 'print-media-box';
    const link = document.createElement('a');
    link.className = 'print-media-link';
    link.href = url.href;
    link.textContent = `影音來源 ${url.href}`;
    box.append(link);
    player.replaceWith(box);
  }
  for (const wrapper of root.querySelectorAll('.lab-media-embed')) {
    wrapper.replaceWith(...wrapper.childNodes);
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
