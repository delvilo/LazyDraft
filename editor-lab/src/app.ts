import './style.css';
import type {
  EditorContext,
  EditorDescription,
  EditorId,
  FormatCommand,
  SaveState,
} from './contracts.ts';
import { EDITOR_IDS } from './contracts.ts';
import { catalogue } from './catalogue.ts';
import { getLabBase } from './environment.ts';
import { openAssetStore } from './assets.ts';
import { createSession, readDraft } from './session.ts';
import { parseImageURL, parseMediaSource } from './media.ts';
import { createHTMLDocument, downloadHTML, printDocument } from './export.ts';
import { loadEditor } from './engines.ts';
import { prepareOffline } from './offline.ts';
import schema from './schema.json';

interface ReleaseManifest {
  version: string;
  totalBytes: number;
  totalGzipBytes: number;
  files: Array<{ path: string; bytes: number; gzipBytes: number; sha256: string }>;
  editors: Record<EditorId, {
    entry: string;
    files: string[];
    bytes: number;
    gzipBytes: number;
    sourceBytes: number;
    license: string;
    version: string;
  }>;
  licenses: Array<{
    name: string;
    version: string;
    license: string;
    chosenLicense: string;
    development: boolean;
  }>;
}

interface MeasurementReport {
  browser: string;
  measurements: Partial<Record<EditorId, {
    coldReadyMs: number | null;
    warmReadyMs: number | null;
    changeToSavedMs: number | null;
    error: string | null;
  }>>;
}


function isKnownEditorId(value: string | undefined): value is EditorId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(catalogue, value);
}



let followSystemTheme = true;

function initTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(schema.themeKey);
  } catch (err) {
    showPersistentError(err);
  }
  followSystemTheme = saved !== 'dark' && saved !== 'light';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(saved === 'dark' || (followSystemTheme && media.matches));
  media.addEventListener('change', (event) => {
    if (followSystemTheme) applyTheme(event.matches);
  });
}

function applyTheme(isDark: boolean): void {
  document.body.classList.toggle('dark', isDark);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = isDark ? '淺色' : '深色';
    toggleBtn.setAttribute('title', isDark ? '切換淺色模式 [Ctrl/Cmd + M]' : '切換深色模式 [Ctrl/Cmd + M]');
    toggleBtn.setAttribute('aria-label', isDark ? '切換淺色模式 [Ctrl/Cmd + M]' : '切換深色模式 [Ctrl/Cmd + M]');
  }
}

function toggleTheme(): void {
  const isCurrentDark = document.body.classList.contains('dark');
  const nextDark = !isCurrentDark;
  applyTheme(nextDark);
  followSystemTheme = false;
  try {
    localStorage.setItem(schema.themeKey, nextDark ? 'dark' : 'light');
  } catch (err) {
    showPersistentError(err);
  }
}



function updateOfflineStatus(statusText: string): void {
  const statusEl = document.getElementById('offline-status');
  if (!statusEl) return;
  statusEl.textContent = statusText;
  statusEl.dataset.ready = statusText === '離線可用' ? 'true' : 'false';
}

function showPersistentError(err: unknown, source: 'operation' | 'save' = 'operation'): void {
  let el = document.getElementById('error-status');
  if (!el) {
    el = document.createElement('p');
    el.id = 'error-status';
    el.setAttribute('role', 'alert');
    document.body.prepend(el);
  }
  const msg = err instanceof Error ? err.message : String(err);
  el.textContent = msg;
  el.title = msg;
  el.dataset.source = source;
  el.classList.remove('hidden');
  document.querySelector('.lab-navbar')?.after(el);
}

function clearPersistentError(): void {
  const el = document.getElementById('error-status');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}



function promptUrl(mode: 'image-url' | 'media' | 'link'): Promise<string | null> {
  const dialog = document.getElementById('url-dialog') as HTMLDialogElement | null;
  const input = document.getElementById('source-url') as HTMLInputElement | null;
  const title = document.getElementById('url-dialog-title');
  if (!dialog || !input) return Promise.resolve(null);

  const { promise, resolve } = Promise.withResolvers<string | null>();

  if (title) {
    if (mode === 'image-url') {
      title.textContent = '插入圖片網址 (Image URL)';
    } else if (mode === 'media') {
      title.textContent = '插入影音來源 (YouTube / Vimeo / Direct Audio / Video)';
    } else {
      title.textContent = '插入超連結 (Link URL)';
    }
  }

  input.value = '';
  input.placeholder = mode === 'media'
    ? 'https://www.youtube.com/watch?v=... 或 MP4/WebM/MP3 網址'
    : 'https://example.com/...';

  const onFormSubmit = (e: Event) => {
    e.preventDefault();
    cleanup();
    dialog.close();
    resolve(input.value.trim() || null);
  };

  const onCancelClick = () => {
    cleanup();
    dialog.close();
    resolve(null);
  };

  const onDialogCancel = () => {
    cleanup();
    resolve(null);
  };

  const form = document.getElementById('url-dialog-form');
  const cancelBtn = document.getElementById('source-cancel');

  form?.addEventListener('submit', onFormSubmit);
  cancelBtn?.addEventListener('click', onCancelClick);
  dialog.addEventListener('cancel', onDialogCancel);

  function cleanup(): void {
    form?.removeEventListener('submit', onFormSubmit);
    cancelBtn?.removeEventListener('click', onCancelClick);
    dialog?.removeEventListener('cancel', onDialogCancel);
  }

  dialog.showModal();
  input.focus();

  return promise;
}

function openAboutDialog(info?: EditorDescription): void {
  const dialog = document.getElementById('about-dialog') as HTMLDialogElement | null;
  if (!dialog) return;

  const content = document.getElementById('about-dialog-content');
  if (content) {
    content.replaceChildren();
    if (info) {
      const dl = document.createElement('dl');

      const dtName = document.createElement('dt');
      dtName.textContent = '編輯器名稱';
      const ddName = document.createElement('dd');
      ddName.textContent = `${info.name} (${info.package}@${info.version})`;

      const dtLicense = document.createElement('dt');
      dtLicense.textContent = '開源授權';
      const ddLicense = document.createElement('dd');
      ddLicense.textContent = info.license;

      const dtFormat = document.createElement('dt');
      dtFormat.textContent = '原生資料模型';
      const ddFormat = document.createElement('dd');
      ddFormat.textContent = info.format;

      const dtUI = document.createElement('dt');
      dtUI.textContent = '介面類型';
      const ddUI = document.createElement('dd');
      ddUI.textContent = info.nativeUI ? '含原生工具列' : '無介面 Headless（自製轉接控制）';

      const dtSummary = document.createElement('dt');
      dtSummary.textContent = '架構摘要';
      const ddSummary = document.createElement('dd');
      ddSummary.textContent = info.summary;

      const dtIntegration = document.createElement('dt');
      dtIntegration.textContent = '整合特點';
      const ddIntegration = document.createElement('dd');
      ddIntegration.textContent = info.integration;

      const dtFeatures = document.createElement('dt');
      dtFeatures.textContent = '原生功能';
      const ddFeatures = document.createElement('dd');
      ddFeatures.textContent = info.nativeFeatures;

      const dtRisk = document.createElement('dt');
      dtRisk.textContent = '風險評估';
      const ddRisk = document.createElement('dd');
      ddRisk.textContent = info.risk;

      dl.append(
        dtName, ddName,
        dtLicense, ddLicense,
        dtFormat, ddFormat,
        dtUI, ddUI,
        dtSummary, ddSummary,
        dtIntegration, ddIntegration,
        dtFeatures, ddFeatures,
        dtRisk, ddRisk,
      );
      content.appendChild(dl);
    } else {
      const p = document.createElement('p');
      p.textContent = `LazyDraft Editor Lab 是針對 ${EDITOR_IDS.length} 款富文字／區塊編輯器的實體比較環境。各編輯器運行於靜態網站，草稿分開存入 LocalStorage，本機圖片保存於專用 IndexedDB，並透過 Service Worker 提供離線使用。Trumbowyg 使用 jQuery，其依賴也納入資源比較。`;
      content.appendChild(p);
    }
  }

  const activeElementBefore = document.activeElement as HTMLElement | null;
  const closeBtn = document.getElementById('about-close');

  const onClose = () => {
    dialog.close();
    closeBtn?.removeEventListener('click', onClose);
    dialog.removeEventListener('cancel', onClose);
    activeElementBefore?.focus();
  };

  closeBtn?.addEventListener('click', onClose);
  dialog.addEventListener('cancel', onClose);

  dialog.showModal();
}



async function renderHub(labBase: URL): Promise<void> {
  const rootUrl = new URL('../../', labBase).href;
  document.body.dataset.editor = 'hub';

  document.body.replaceChildren();

  
  const nav = document.createElement('nav');
  nav.className = 'lab-navbar';

  const navLeft = document.createElement('div');
  navLeft.className = 'lab-nav-left';

  const brandLink = document.createElement('a');
  brandLink.className = 'lab-nav-brand';
  brandLink.href = rootUrl;
  brandLink.textContent = 'LazyDraft';

  const sep = document.createElement('span');
  sep.className = 'lab-nav-sep';
  sep.textContent = '/';

  const currentLabel = document.createElement('span');
  currentLabel.className = 'lab-nav-current';
  currentLabel.textContent = 'Editor Lab 評測中心';

  navLeft.append(brandLink, sep, currentLabel);

  const navRight = document.createElement('div');
  navRight.className = 'lab-nav-right';

  const offlineStatus = document.createElement('span');
  offlineStatus.id = 'offline-status';
  offlineStatus.className = 'lab-status-badge';
  offlineStatus.setAttribute('role', 'status');
  offlineStatus.dataset.ready = 'false';
  offlineStatus.textContent = '離線準備中';

  const themeToggle = document.createElement('button');
  themeToggle.type = 'button';
  themeToggle.id = 'theme-toggle';
  themeToggle.className = 'lab-btn lab-btn-icon';
  themeToggle.textContent = '主題';
  themeToggle.setAttribute('aria-label', '切換深淺色主題 [Ctrl/Cmd + M]');
  themeToggle.setAttribute('title', '切換深淺色主題 [Ctrl/Cmd + M]');
  themeToggle.addEventListener('click', toggleTheme);

  const aboutBtn = document.createElement('button');
  aboutBtn.type = 'button';
  aboutBtn.id = 'about-open';
  aboutBtn.className = 'lab-btn lab-btn-icon';
  aboutBtn.textContent = '關於';
  aboutBtn.setAttribute('aria-label', '關於本實驗室');
  aboutBtn.setAttribute('title', '關於本實驗室');
  aboutBtn.addEventListener('click', () => openAboutDialog());

  navRight.append(offlineStatus, themeToggle, aboutBtn);
  nav.append(navLeft, navRight);
  document.body.appendChild(nav);

  
  const container = document.createElement('main');
  container.className = 'lab-hub-container';

  const hero = document.createElement('section');
  hero.className = 'lab-hub-hero';

  const heroTitle = document.createElement('h1');
  heroTitle.textContent = `${EDITOR_IDS.length} 款編輯器實測`;

  const heroDesc = document.createElement('p');
  heroDesc.textContent = '保留各編輯器的原生介面與文件格式。草稿分開自動儲存，本機圖片存入 IndexedDB；支援 HTML 匯出與列印／另存 PDF。不預設勝出者，請實際編輯後再選擇。';

  hero.append(heroTitle, heroDesc);
  container.appendChild(hero);

  
  let release: ReleaseManifest | null = null;
  let measurements: MeasurementReport | null = null;
  try {
    const relRes = await fetch(new URL('release.json', labBase));
    if (relRes.ok) {
      release = (await relRes.json()) as ReleaseManifest;
    }
  } catch {
    
  }

  try {
    const measRes = await fetch(new URL('measurements.json', labBase));
    if (measRes.ok) {
      measurements = (await measRes.json()) as MeasurementReport;
    }
  } catch {
    
  }

  
  const grid = document.createElement('section');
  grid.className = 'lab-hub-grid';

  for (const id of EDITOR_IDS) {
    const desc = catalogue[id];
    const card = document.createElement('article');
    card.className = 'lab-card';

    const cardHeader = document.createElement('div');
    cardHeader.className = 'lab-card-header';

    const cardTitle = document.createElement('h2');
    cardTitle.className = 'lab-card-title';
    const cardLink = document.createElement('a');
    cardLink.href = `./${id}/index.html`;
    cardLink.textContent = desc.name;
    cardTitle.appendChild(cardLink);

    const badgeGroup = document.createElement('div');
    badgeGroup.style.display = 'flex';
    badgeGroup.style.gap = '4px';

    const licenseBadge = document.createElement('span');
    licenseBadge.className = 'lab-badge';
    licenseBadge.textContent = desc.license;

    const uiBadge = document.createElement('span');
    uiBadge.className = desc.nativeUI ? 'lab-badge lab-badge-success' : 'lab-badge lab-badge-warning';
    uiBadge.textContent = desc.nativeUI ? '原生介面' : 'Headless';

    badgeGroup.append(licenseBadge, uiBadge);
    cardHeader.append(cardTitle, badgeGroup);

    const cardPkg = document.createElement('div');
    cardPkg.className = 'lab-card-pkg';
    cardPkg.textContent = `${desc.package}@${desc.version}`;

    const cardSummary = document.createElement('p');
    cardSummary.className = 'lab-card-summary';
    cardSummary.textContent = desc.summary;

    const cardMeta = document.createElement('div');
    cardMeta.className = 'lab-card-meta';

    const metaFormat = document.createElement('div');
    metaFormat.textContent = `資料模型：${desc.format}`;

    const metaIntegration = document.createElement('div');
    metaIntegration.textContent = `整合特點：${desc.integration}`;

    const metaFootprint = document.createElement('div');
    const editorRel = release?.editors?.[id];
    if (editorRel && typeof editorRel.bytes === 'number' && typeof editorRel.gzipBytes === 'number' && Array.isArray(editorRel.files)) {
      const kb = (editorRel.bytes / 1024).toFixed(1);
      const gzipKb = (editorRel.gzipBytes / 1024).toFixed(1);
      metaFootprint.textContent = `完整依賴圖 ${kb} KiB（${gzipKb} KiB gzip），${editorRel.files.length} 檔案`;
    } else {
      metaFootprint.textContent = '依賴圖尚未產生，請先執行 npm run build。';
    }

    const metaTiming = document.createElement('div');
    const editorMeas = measurements?.measurements?.[id];
    if (editorMeas && typeof editorMeas.coldReadyMs === 'number' && typeof editorMeas.warmReadyMs === 'number' && typeof editorMeas.changeToSavedMs === 'number') {
      metaTiming.textContent = `冷啟動 ${editorMeas.coldReadyMs.toFixed(1)} ms，暖啟動 ${editorMeas.warmReadyMs.toFixed(1)} ms，儲存 ${editorMeas.changeToSavedMs.toFixed(1)} ms`;
      metaTiming.title = `${measurements?.browser ?? '本機瀏覽器'}，本機單次測量`;
    } else if (editorMeas?.error) {
      metaTiming.textContent = `測量失敗，${editorMeas.error}`;
    } else {
      metaTiming.textContent = '尚無測時資料，請執行 npm run measure。';
    }

    cardMeta.append(metaFormat, metaIntegration, metaFootprint, metaTiming);

    const cardRisk = document.createElement('div');
    cardRisk.className = 'lab-card-risk';
    cardRisk.textContent = desc.risk;

    const cardFooter = document.createElement('div');
    cardFooter.className = 'lab-card-footer';

    const openBtn = document.createElement('a');
    openBtn.className = 'lab-btn lab-btn-primary';
    openBtn.href = `./${id}/index.html`;
    openBtn.textContent = '開啟獨立實體 →';

    const srcLink = document.createElement('a');
    srcLink.className = 'lab-btn';
    srcLink.href = desc.source;
    srcLink.target = '_blank';
    srcLink.rel = 'noopener noreferrer';
    srcLink.textContent = '官方原始碼';

    cardFooter.append(srcLink, openBtn);
    card.append(cardHeader, cardPkg, cardSummary, cardMeta, cardRisk, cardFooter);
    grid.appendChild(card);
  }

  container.appendChild(grid);


  document.body.appendChild(container);

  
  appendDialogs();

  document.body.dataset.editorReady = 'true';
}



function renderEditorShell(editorId: EditorId, labBase: URL): void {
  const desc = catalogue[editorId];
  const rootUrl = new URL('../../', labBase).href;
  const hubUrl = labBase.href;

  document.body.dataset.editor = editorId;
  document.body.replaceChildren();

  
  const nav = document.createElement('nav');
  nav.className = 'lab-navbar';

  const navLeft = document.createElement('div');
  navLeft.className = 'lab-nav-left';

  const brandLink = document.createElement('a');
  brandLink.className = 'lab-nav-brand';
  brandLink.href = rootUrl;
  brandLink.textContent = 'LazyDraft';

  const sep1 = document.createElement('span');
  sep1.className = 'lab-nav-sep';
  sep1.textContent = '/';

  const hubLink = document.createElement('a');
  hubLink.className = 'lab-nav-hub-link';
  hubLink.href = hubUrl;
  hubLink.textContent = 'Editor Lab';

  const sep2 = document.createElement('span');
  sep2.className = 'lab-nav-sep';
  sep2.textContent = '/';

  const currentLabel = document.createElement('span');
  currentLabel.className = 'lab-nav-current';
  currentLabel.textContent = `${desc.name} (${desc.version})`;

  navLeft.append(brandLink, sep1, hubLink, sep2, currentLabel);

  const navRight = document.createElement('div');
  navRight.className = 'lab-nav-right';

  const saveStatus = document.createElement('span');
  saveStatus.id = 'save-status';
  saveStatus.className = 'lab-status-badge';
  saveStatus.setAttribute('role', 'status');
  saveStatus.textContent = '就緒';

  const offlineStatus = document.createElement('span');
  offlineStatus.id = 'offline-status';
  offlineStatus.className = 'lab-status-badge';
  offlineStatus.setAttribute('role', 'status');
  offlineStatus.dataset.ready = 'false';
  offlineStatus.textContent = '離線準備中';

  const errorStatus = document.createElement('span');
  errorStatus.id = 'error-status';
  errorStatus.className = 'lab-status-badge hidden';
  errorStatus.setAttribute('role', 'alert');

  const themeToggle = document.createElement('button');
  themeToggle.type = 'button';
  themeToggle.id = 'theme-toggle';
  themeToggle.className = 'lab-btn lab-btn-icon';
  themeToggle.textContent = '主題';
  themeToggle.setAttribute('aria-label', '切換深淺色主題 [Ctrl/Cmd + M]');
  themeToggle.setAttribute('title', '切換深淺色主題 [Ctrl/Cmd + M]');
  themeToggle.addEventListener('click', toggleTheme);

  const aboutBtn = document.createElement('button');
  aboutBtn.type = 'button';
  aboutBtn.id = 'about-open';
  aboutBtn.className = 'lab-btn lab-btn-icon';
  aboutBtn.textContent = '關於';
  aboutBtn.setAttribute('aria-label', '關於本編輯器');
  aboutBtn.setAttribute('title', '關於本編輯器');
  aboutBtn.addEventListener('click', () => openAboutDialog(desc));

  navRight.append(saveStatus, offlineStatus, errorStatus, themeToggle, aboutBtn);
  nav.append(navLeft, navRight);
  document.body.appendChild(nav);

  
  const toolbarContainer = document.createElement('section');
  toolbarContainer.className = 'lab-toolbar-container';

  const actionRow = document.createElement('div');
  actionRow.className = 'lab-action-row';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.id = 'manual-save';
  saveBtn.className = 'lab-btn lab-btn-primary';
  saveBtn.textContent = '立即儲存';
  saveBtn.setAttribute('title', '儲存草稿至 LocalStorage [Ctrl/Cmd + S]');

  const insertImgFileBtn = document.createElement('button');
  insertImgFileBtn.type = 'button';
  insertImgFileBtn.id = 'insert-image-file';
  insertImgFileBtn.className = 'lab-btn';
  insertImgFileBtn.textContent = '本機圖片';
  insertImgFileBtn.setAttribute('title', '選取本機圖片儲存至 IndexedDB');

  const hiddenFileInput = document.createElement('input');
  hiddenFileInput.type = 'file';
  hiddenFileInput.id = 'image-file';
  hiddenFileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
  hiddenFileInput.style.display = 'none';

  const insertImgUrlBtn = document.createElement('button');
  insertImgUrlBtn.type = 'button';
  insertImgUrlBtn.id = 'insert-image-url';
  insertImgUrlBtn.className = 'lab-btn';
  insertImgUrlBtn.textContent = '圖片網址';
  insertImgUrlBtn.setAttribute('title', '插入外部圖片 URL');

  const insertMediaBtn = document.createElement('button');
  insertMediaBtn.type = 'button';
  insertMediaBtn.id = 'insert-media';
  insertMediaBtn.className = 'lab-btn';
  insertMediaBtn.textContent = '插入影音';
  insertMediaBtn.setAttribute('title', '插入 YouTube / Vimeo / MP4 / MP3 媒體');

  const exportHtmlBtn = document.createElement('button');
  exportHtmlBtn.type = 'button';
  exportHtmlBtn.id = 'export-html';
  exportHtmlBtn.className = 'lab-btn';
  exportHtmlBtn.textContent = '匯出 HTML';
  exportHtmlBtn.setAttribute('title', '匯出完整獨立 HTML 文件 (包含本機圖片內嵌)');

  const printDocBtn = document.createElement('button');
  printDocBtn.type = 'button';
  printDocBtn.id = 'print-document';
  printDocBtn.className = 'lab-btn';
  printDocBtn.textContent = '列印／另存 PDF';
  printDocBtn.setAttribute('title', '列印或另存為 PDF 文件 [Ctrl/Cmd + P]');

  actionRow.append(
    saveBtn,
    insertImgFileBtn,
    hiddenFileInput,
    insertImgUrlBtn,
    insertMediaBtn,
    exportHtmlBtn,
    printDocBtn,
  );
  toolbarContainer.appendChild(actionRow);

  
  const details = document.createElement('details');
  details.id = 'shared-commands';
  details.open = !desc.nativeUI;

  const summary = document.createElement('summary');
  summary.textContent = '共通操作（自製轉接控制）';
  details.appendChild(summary);

  const cmdGrid = document.createElement('div');
  cmdGrid.className = 'lab-command-grid';

  const commandSpecs: Array<{ kind: FormatCommand['kind']; label: string; aria: string }> = [
    { kind: 'bold', label: '粗體 (B)', aria: '粗體 (Bold)' },
    { kind: 'italic', label: '斜體 (I)', aria: '斜體 (Italic)' },
    { kind: 'heading', label: '標題', aria: '標題 (Heading)' },
    { kind: 'bulletList', label: '• 無序清單', aria: '無序清單 (Bullet List)' },
    { kind: 'orderedList', label: '1. 有序清單', aria: '有序清單 (Ordered List)' },
    { kind: 'quote', label: '“ 引言', aria: '引言 (Quote)' },
    { kind: 'codeBlock', label: '<> 程式碼', aria: '程式碼區塊 (Code Block)' },
    { kind: 'link', label: '連結', aria: '超連結 (Link)' },
    { kind: 'undo', label: '↶ 復原', aria: '復原 (Undo)' },
    { kind: 'redo', label: '↷ 重作', aria: '重作 (Redo)' },
  ];

  for (const cmd of commandSpecs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lab-btn lab-cmd-btn';
    btn.dataset.command = cmd.kind;
    btn.textContent = cmd.label;
    btn.setAttribute('aria-label', cmd.aria);
    btn.setAttribute('title', cmd.aria);
    cmdGrid.appendChild(btn);
  }

  details.appendChild(cmdGrid);
  toolbarContainer.appendChild(details);
  document.body.appendChild(toolbarContainer);

  
  const workspace = document.createElement('main');
  workspace.className = 'lab-workspace';

  const host = document.createElement('div');
  host.id = 'editor-host';
  workspace.appendChild(host);
  document.body.appendChild(workspace);

  
  appendDialogs();
}

function appendDialogs(): void {
  
  const urlDialog = document.createElement('dialog');
  urlDialog.id = 'url-dialog';

  const dialogHeader = document.createElement('div');
  dialogHeader.className = 'lab-dialog-header';

  const dialogTitle = document.createElement('h3');
  dialogTitle.id = 'url-dialog-title';
  dialogTitle.className = 'lab-dialog-title';
  dialogTitle.textContent = '插入來源網址';

  dialogHeader.appendChild(dialogTitle);
  urlDialog.appendChild(dialogHeader);

  const form = document.createElement('form');
  form.id = 'url-dialog-form';
  form.className = 'lab-dialog-form';
  form.method = 'dialog';

  const input = document.createElement('input');
  input.type = 'url';
  input.id = 'source-url';
  input.className = 'lab-input';
  input.required = true;
  input.placeholder = 'https://...';

  const actions = document.createElement('div');
  actions.className = 'lab-dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.id = 'source-cancel';
  cancelBtn.className = 'lab-btn';
  cancelBtn.textContent = '取消';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.id = 'source-submit';
  submitBtn.className = 'lab-btn lab-btn-primary';
  submitBtn.textContent = '確認插入';

  actions.append(cancelBtn, submitBtn);
  form.append(input, actions);
  urlDialog.appendChild(form);

  
  const aboutDialog = document.createElement('dialog');
  aboutDialog.id = 'about-dialog';

  const aboutHeader = document.createElement('div');
  aboutHeader.className = 'lab-dialog-header';

  const aboutTitle = document.createElement('h3');
  aboutTitle.className = 'lab-dialog-title';
  aboutTitle.textContent = '關於 LazyDraft Editor Lab';

  aboutHeader.appendChild(aboutTitle);

  const aboutContent = document.createElement('div');
  aboutContent.id = 'about-dialog-content';
  aboutContent.className = 'lab-about-content';

  const aboutActions = document.createElement('div');
  aboutActions.className = 'lab-dialog-actions';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'about-close';
  closeBtn.className = 'lab-btn';
  closeBtn.textContent = '關閉';

  aboutActions.appendChild(closeBtn);
  aboutDialog.append(aboutHeader, aboutContent, aboutActions);

  document.body.append(urlDialog, aboutDialog);
}



async function setupEditor(editorId: EditorId, labBase: URL): Promise<void> {
  const editorHost = document.getElementById('editor-host');
  if (!editorHost) {
    throw new Error('未找到 #editor-host 掛載節點');
  }

  const assetStore = openAssetStore(editorId, labBase);

  const initialSnapshot = readDraft(editorId)?.snapshot ?? null;
  let mounted = false;
  const startup: { failure: { reason: unknown } | null } = { failure: null };
  editorHost.inert = true;

  let isComposing = false;
  let pendingDirtyAfterComposition = false;
  let currentRevision = 0;
  let needsCommit = false;

  editorHost.addEventListener('compositionstart', () => {
    if (!mounted) return;
    isComposing = true;
    pendingDirtyAfterComposition = true;
    updateSaveStateUI({ kind: 'dirty', revision: currentRevision });
  });

  editorHost.addEventListener('compositionend', () => {
    if (!mounted) return;
    isComposing = false;
    if (pendingDirtyAfterComposition) {
      pendingDirtyAfterComposition = false;
      queueMicrotask(() => session.changed());
    }
  });

  const fileInput = document.getElementById('image-file') as HTMLInputElement | null;

  const context: EditorContext = {
    host: editorHost,
    initialSnapshot,
    onChange: () => {
      if (!mounted) return;
      if (isComposing) {
        pendingDirtyAfterComposition = true;
        updateSaveStateUI({ kind: 'dirty', revision: currentRevision });
        return;
      }
      session.changed();
    },
    onError: (err) => {
      if (!mounted) startup.failure = { reason: err };
      showPersistentError(err);
    },
    storeImage: (file) => assetStore.storeImage(file),
    pickImage: () => {
      handle.rememberSelection();
      fileInput?.click();
    },
    requestMedia: () => {
      handle.rememberSelection();
      void handleInsertMedia();
    },
  };

  const factory = await loadEditor(editorId);
  const handle = await factory(context);
  if (startup.failure) {
    handle.destroy();
    throw startup.failure.reason;
  }

  const session = createSession({
    id: editorId,
    adapter: handle,
    onState: (state) => {
      updateSaveStateUI(state);
    },
  });

  function updateSaveStateUI(state: SaveState): void {
    const statusEl = document.getElementById('save-status');
    needsCommit = state.kind === 'dirty' || state.kind === 'saving' || state.kind === 'error';
    if (!statusEl) return;
    statusEl.dataset.state = state.kind;

    switch (state.kind) {
      case 'ready':
        statusEl.textContent = '就緒';
        break;
      case 'dirty':
        currentRevision = state.revision;
        statusEl.textContent = '未儲存變更...';
        break;
      case 'saving':
        currentRevision = state.revision;
        statusEl.textContent = '儲存中...';
        break;
      case 'saved':
        currentRevision = state.revision;
        const timeStr = new Date(state.savedAt).toLocaleTimeString();
        statusEl.textContent = `已儲存 (${timeStr})`;
        if (document.getElementById('error-status')?.dataset.source === 'save') clearPersistentError();
        break;
      case 'error':
        statusEl.textContent = '儲存失敗';
        showPersistentError(state.message, 'save');
        break;
      default: {
        const _exhaustive: never = state;
        break;
      }
    }
  }

  

  function hasUnstoredMedia(html: string): boolean {
    const fragment = new DOMParser().parseFromString(html, 'text/html');
    const isUnstoredURL = (value: string): boolean => {
      try {
        const protocol = new URL(value, document.baseURI).protocol;
        return protocol === 'data:' || protocol === 'blob:';
      } catch {
        return false;
      }
    };
    for (const element of fragment.querySelectorAll('img, video, audio, source')) {
      if (isUnstoredURL(element.getAttribute('src') ?? '')) return true;
      const candidates = element.getAttribute('srcset') ?? '';
      let position = 0;
      while (position < candidates.length) {
        while (/[\t\n\f\r ,]/.test(candidates[position] ?? '') && position < candidates.length) position++;
        const start = position;
        while (position < candidates.length && !/[\t\n\f\r ]/.test(candidates[position])) position++;
        const source = candidates.slice(start, position);
        if (isUnstoredURL(source.replace(/,+$/, ''))) return true;
        if (source.endsWith(',')) continue;
        let parentheses = 0;
        while (position < candidates.length) {
          const character = candidates[position++];
          if (character === '(') parentheses++;
          else if (character === ')') parentheses--;
          else if (character === ',' && parentheses <= 0) break;
        }
      }
    }
    return false;
  }

  editorHost.addEventListener('paste', async (event: ClipboardEvent) => {
    handle.rememberSelection();
    const files = event.clipboardData?.files;
    if (files?.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        for (const file of files) await handle.insertImage(await assetStore.storeImage(file));
      } catch (err) {
        showPersistentError(err);
      }
      return;
    }
    const html = event.clipboardData?.getData('text/html');
    if (!html) return;
    if (hasUnstoredMedia(html)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showPersistentError(new Error('貼上的內容含有尚未儲存的圖片或影音，未插入任何內容。請使用「本機圖片」選取原始檔案；影音僅支援遠端網址。'));
    }
  }, true);

  editorHost.addEventListener('dragover', (event: DragEvent) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
    }
  });

  editorHost.addEventListener('drop', async (event: DragEvent) => {
    const files = event.dataTransfer?.files;
    if (!files?.length) {
      if (hasUnstoredMedia(event.dataTransfer?.getData('text/html') ?? '')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showPersistentError(new Error('拖入內容含有尚未儲存的圖片或影音，未插入任何內容。請使用「本機圖片」選取原始檔案。'));
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    handle.rememberSelection();
    try {
      for (const file of files) await handle.insertImage(await assetStore.storeImage(file));
    } catch (err) {
      showPersistentError(err);
    }
  }, true);

  

  
  const manualSaveBtn = document.getElementById('manual-save');
  manualSaveBtn?.addEventListener('click', async () => {
    if (isComposing) return;
    try {
      await session.saveNow();
    } catch (err) {
      showPersistentError(err);
    }
  });

  
  const insertImgFileBtn = document.getElementById('insert-image-file');
  insertImgFileBtn?.addEventListener('click', () => {
    handle.rememberSelection();
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    try {
      const imageSource = await assetStore.storeImage(file);
      await handle.insertImage(imageSource);
    } catch (err) {
      showPersistentError(err);
    }
  });

  
  const insertImgUrlBtn = document.getElementById('insert-image-url');
  insertImgUrlBtn?.addEventListener('click', async () => {
    handle.rememberSelection();
    const url = await promptUrl('image-url');
    if (!url) return;
    try {
      const imageSource = parseImageURL(url);
      await handle.insertImage(imageSource);
    } catch (err) {
      showPersistentError(err);
    }
  });

  
  async function handleInsertMedia(): Promise<void> {
    const url = await promptUrl('media');
    if (!url) return;
    try {
      const mediaSource = parseMediaSource(url);
      await handle.insertMedia(mediaSource);
    } catch (err) {
      showPersistentError(err);
    }
  }

  const insertMediaBtn = document.getElementById('insert-media');
  insertMediaBtn?.addEventListener('click', () => {
    handle.rememberSelection();
    void handleInsertMedia();
  });

  
  const exportHtmlBtn = document.getElementById('export-html');
  exportHtmlBtn?.addEventListener('click', async () => {
    try {
      const rawHtml = await handle.getHTML();
      const inlined = await assetStore.inlineImages(rawHtml);
      const docTitle = `${catalogue[editorId]?.name ?? editorId} - LazyDraft Document`;
      const fullDoc = createHTMLDocument({ title: docTitle, html: inlined });
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadHTML(fullDoc, `lazydraft-${editorId}-${dateStr}.html`);
    } catch (err) {
      showPersistentError(err);
    }
  });

  
  const printDocBtn = document.getElementById('print-document');
  async function handlePrint(): Promise<void> {
    try {
      const rawHtml = await handle.getHTML();
      const inlined = await assetStore.inlineImages(rawHtml);
      const docTitle = `${catalogue[editorId]?.name ?? editorId} - LazyDraft Document`;
      const fullDoc = createHTMLDocument({ title: docTitle, html: inlined });
      await printDocument(fullDoc);
    } catch (err) {
      showPersistentError(err);
    }
  }

  printDocBtn?.addEventListener('click', () => {
    void handlePrint();
  });

  
  const commandButtons = document.querySelectorAll<HTMLButtonElement>('#shared-commands button[data-command]');
  commandButtons.forEach((btn) => {
    const kind = btn.dataset.command as FormatCommand['kind'];

    // Prevent pointerdown so focus stays in the editor
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.rememberSelection();
    });

    btn.addEventListener('click', async () => {
      if (isComposing) return;
      try {
        if (kind === 'link') {
          const input = await promptUrl('link');
          if (!input) return;
          const url = new URL(input);
          if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error('連結僅支援 HTTP、HTTPS 或 mailto 網址。');
          await handle.command({ kind: 'link', url: url.href });
        } else {
          await handle.command({ kind });
        }
      } catch (err) {
        showPersistentError(err);
      }
    });
  });

  

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const isMod = event.ctrlKey || event.metaKey;
    if (!isMod) return;

    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      if (isComposing) return;
      void session.saveNow().catch(showPersistentError);
    } else if (key === 'p') {
      event.preventDefault();
      void handlePrint();
    } else if (key === 'm') {
      event.preventDefault();
      toggleTheme();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!needsCommit) return;
    event.preventDefault();
    event.returnValue = '';
  });

  mounted = true;
  editorHost.inert = false;
  document.body.dataset.editorReady = 'true';
}



async function init(): Promise<void> {
  const labBase = getLabBase();
  const rawEditorId = document.body.dataset.editor?.trim().toLowerCase();
  if (isKnownEditorId(rawEditorId)) renderEditorShell(rawEditorId, labBase);
  else await renderHub(labBase);
  try {
    initTheme();
    await prepareOffline(updateOfflineStatus);
    if (isKnownEditorId(rawEditorId)) await setupEditor(rawEditorId, labBase);
  } catch (err) {
    showPersistentError(err);
    const status = document.getElementById('save-status');
    if (status) {
      status.dataset.state = 'error';
      status.textContent = '初始化失敗，原有草稿未更動';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void init().catch(showPersistentError);
  });
} else {
  void init().catch(showPersistentError);
}
