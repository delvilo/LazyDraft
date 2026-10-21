/**
 * Offline management for AI-RegExr.
 * Registers the tool's independent Service Worker and tracks release cache installation.
 */

/**
 * Initializes the tool's independent Service Worker and updates the offline status UI.
 * @param {HTMLElement | null} [statusElement] - DOM element to receive status updates.
 * @returns {Promise<ServiceWorkerRegistration | null>}
 */
export async function initOffline(statusElement) {
    if (!('serviceWorker' in navigator)) {
        if (statusElement) {
            statusElement.dataset.state = 'unavailable';
            statusElement.textContent = '離線不可用';
        }
        return null;
    }

    if (statusElement) {
        statusElement.dataset.state = 'loading';
        statusElement.textContent = '準備離線中...';
    }

    /**
     * @param {'ready' | 'loading' | 'unavailable'} state
     * @param {string} text
     * @param {string} [title]
     */
    function setStatus(state, text, title) {
        if (statusElement) {
            statusElement.dataset.state = state;
            statusElement.textContent = text;
            if (title !== undefined) {
                statusElement.title = title;
            }
        }
    }

    /**
     * Pings worker to verify release cache readiness.
     * Clears timeout and closes MessageChannel ports on settle.
     * @param {ServiceWorker | null} worker
     * @returns {Promise<boolean>}
     */
    function verifyWorkerCache(worker) {
        if (!worker) return Promise.resolve(false);
        return new Promise((resolve) => {
            const channel = new MessageChannel();
            /** @type {ReturnType<typeof setTimeout> | null} */
            let timer = null;

            /** @param {boolean} value */
            function settle(value) {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                channel.port1.onmessage = null;
                channel.port1.close();
                channel.port2.close();
                resolve(value);
            }

            timer = setTimeout(() => settle(false), 2000);
            channel.port1.onmessage = (event) => {
                settle(Boolean(event.data && event.data.ready));
            };

            try {
                worker.postMessage({ type: 'CHECK_CACHE_STATUS' }, [channel.port2]);
            } catch (_) {
                settle(false);
            }
        });
    }

    try {
        const swUrl = new URL('../sw.js', import.meta.url);
        const scopeUrl = new URL('../', import.meta.url);
        const registration = await navigator.serviceWorker.register(swUrl, { scope: scopeUrl.pathname });
        let hasReadyRelease = false;

        // If an active worker exists, check its cache status
        if (registration.active) {
            const isReady = await verifyWorkerCache(registration.active);
            if (isReady) {
                hasReadyRelease = true;
                setStatus('ready', '離線可用');
            }
        }

        // If a worker is currently waiting, verify its cache
        if (registration.waiting) {
            const isReady = await verifyWorkerCache(registration.waiting);
            if (isReady) {
                hasReadyRelease = true;
                setStatus('ready', '離線可用');
            }
        }
        if (!hasReadyRelease && !registration.installing) {
            setStatus('unavailable', '離線不可用', '離線快取不完整，需連線重新安裝');
        }

        /**
         * Watch lifecycle of an installing or transitioning worker.
         * Handles existing state immediately to avoid race conditions.
         * @param {ServiceWorker} worker
         */
        function attachWorkerListeners(worker) {
            /** @param {ServiceWorker} target */
            async function handleState(target) {
                if (target.state === 'installed' || target.state === 'activating' || target.state === 'activated') {
                    // Precache verification required before declaring ready
                    const isReady = await verifyWorkerCache(target);
                    if (isReady) {
                        setStatus('ready', '離線可用');
                    } else {
                        setStatus('unavailable', '離線不可用', '離線快取驗證失敗');
                    }
                } else if (target.state === 'redundant') {
                    // Installation or update failed: check if existing active worker is usable
                    if (registration.active) {
                        const hasActiveCache = await verifyWorkerCache(registration.active);
                        if (hasActiveCache) {
                            // Retain old release and keep ready state
                            setStatus('ready', '離線可用 (維持舊版)', '新版本更新失敗，已保留舊版離線快取');
                            return;
                        }
                    }
                    setStatus('unavailable', '離線不可用');
                }
            }

            // Handle current state immediately in case already settled
            handleState(worker);

            worker.addEventListener('statechange', () => {
                handleState(worker);
            });
        }

        if (registration.installing) {
            attachWorkerListeners(registration.installing);
        }

        registration.addEventListener('updatefound', () => {
            if (registration.installing) {
                attachWorkerListeners(registration.installing);
            }
        });

        return registration;
    } catch (_) {
        setStatus('unavailable', '離線不可用');
        return null;
    }
}
