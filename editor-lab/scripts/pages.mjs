import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { catalogue } from '../src/catalogue.ts';

const root = new URL('../', import.meta.url);
const escape = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

for (const [id, editor] of [['hub', { name: '十款編輯器比較' }], ...Object.entries(catalogue)]) {
  const directory = new URL(id === 'hub' ? './' : `${id}/`, root);
  await mkdir(directory, { recursive: true });
  const base = id === 'hub' ? './' : '../';
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="editor-lab-base" content="${base}">
  <meta name="description" content="十款開源編輯器的實際比較。獨立自動存檔、原始圖片、HTML 匯出與瀏覽器列印。">
  <title>${escape(editor.name)} · Editor Lab · LazyDraft</title>
</head>
<body data-editor="${id}">
  <p class="boot-status" role="status">正在載入編輯器比較頁面。</p>
  <script type="module" src="/src/app.ts"></script>
</body>
</html>
`;
  await writeFile(new URL('index.html', directory), html);
}
console.log(`Generated ${Object.keys(catalogue).length + 1} pages in ${fileURLToPath(root)}`);
