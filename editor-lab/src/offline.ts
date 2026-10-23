import { getLabBase } from './environment.ts';

function waitForController(scriptURL: string): Promise<void> {
  if (navigator.serviceWorker.controller?.scriptURL === scriptURL) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const finish = () => {
    if (navigator.serviceWorker.controller?.scriptURL !== scriptURL) return;
    window.clearTimeout(timer);
    navigator.serviceWorker.removeEventListener('controllerchange', finish);
    resolve();
  };
  const timer = window.setTimeout(() => {
    navigator.serviceWorker.removeEventListener('controllerchange', finish);
    reject(new Error('離線服務尚未接管此頁面，請重新載入。'));
  }, 30_000);
  navigator.serviceWorker.addEventListener('controllerchange', finish);
  finish();
  return promise;
}

function waitForActivation(worker: ServiceWorker): Promise<void> {
  if (worker.state === 'activated') return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const finish = () => {
    if (worker.state !== 'activated' && worker.state !== 'redundant') return;
    window.clearTimeout(timer);
    worker.removeEventListener('statechange', finish);
    if (worker.state === 'activated') resolve();
    else reject(new Error('離線服務安裝失敗。'));
  };
  const timer = window.setTimeout(() => {
    worker.removeEventListener('statechange', finish);
    reject(new Error('離線服務啟用逾時。'));
  }, 30_000);
  worker.addEventListener('statechange', finish);
  finish();
  return promise;
}

export async function prepareOffline(onStatus: (text: string) => void): Promise<void> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    onStatus('離線無法啟用');
    throw new Error('離線編輯與本機圖片需要 HTTPS 或 localhost 的 Service Worker。');
  }
  const base = getLabBase();
  const scriptURL = new URL('sw.js', base).href;
  onStatus('離線準備中');
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== navigator.serviceWorker.controller) return;
    const message = event.data;
    if (typeof message !== 'object' || message === null || !('type' in message)) return;
    if (message.type === 'READY') onStatus('離線可用');
    else if (
      message.type === 'PROGRESS' && 'done' in message && 'total' in message &&
      typeof message.done === 'number' && typeof message.total === 'number'
    ) onStatus(`離線準備中（${message.done} / ${message.total}）`);
    else if (message.type === 'ERROR' && 'message' in message && typeof message.message === 'string') {
      onStatus(`離線準備失敗：${message.message}`);
    }
  });
  try {
    const registration = await navigator.serviceWorker.register(scriptURL, { scope: base.pathname, updateViaCache: 'none' });
    const worker = registration.active ?? registration.waiting ?? registration.installing;
    if (!worker) throw new Error('離線服務無法啟動。');
    await waitForActivation(worker);
    const controlled = waitForController(scriptURL);
    worker.postMessage({ type: 'PREPARE_OFFLINE' });
    await controlled;
  } catch (error) {
    onStatus('離線準備失敗');
    throw error;
  }
}
