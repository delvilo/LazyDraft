/**
 * Google Identity Services & Redis Cloud Sync Client Module
 */
const GoogleCloudSync = {
    clientId: '',
    currentUser: null,
    idToken: null,
    STORAGE_KEY: 'google_sync_id_token',
    USER_KEY: 'google_sync_user_profile',

    async init() {
        // Fetch config from server
        try {
            const res = await fetch('api/sync.php?action=config');
            if (res.ok) {
                const data = await res.json();
                this.clientId = data.clientId || '';
            }
        } catch (e) {
            console.warn('Failed to fetch sync config:', e);
        }

        // Restore saved session if valid
        const savedToken = localStorage.getItem(this.STORAGE_KEY);
        const savedUser = localStorage.getItem(this.USER_KEY);
        if (savedToken && savedUser) {
            try {
                this.currentUser = JSON.parse(savedUser);
                this.idToken = savedToken;
                this.updateButtonUI(true);
            } catch (e) {
                this.logout();
            }
        }

        this.bindEvents();
    },

    async ensureGoogleClient() {
        if (window.google && window.google.accounts && window.google.accounts.id) {
            return true;
        }
        if (this._gsiLoadingPromise) {
            return this._gsiLoadingPromise;
        }
        this._gsiLoadingPromise = new Promise((resolve) => {
            const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
            if (existing && window.google && window.google.accounts) {
                resolve(true);
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => resolve(true);
            script.onerror = () => {
                console.warn('Failed to load Google Identity Services SDK');
                resolve(false);
            };
            document.head.appendChild(script);
        });
        return this._gsiLoadingPromise;
    },

    async initGoogleClient() {
        await this.ensureGoogleClient();
        if (!window.google || !window.google.accounts || !this.clientId) {
            return;
        }
        try {
            window.google.accounts.id.initialize({
                client_id: this.clientId,
                callback: (response) => this.handleCredentialResponse(response),
                auto_select: false,
                cancel_on_tap_outside: true
            });

            // Render Google button inside modal
            const btnContainer = document.getElementById('googleSignInBtnContainer');
            if (btnContainer) {
                btnContainer.innerHTML = '';
                window.google.accounts.id.renderButton(btnContainer, {
                    theme: document.body.classList.contains('dark') ? 'filled_black' : 'outline',
                    size: 'large',
                    text: 'signin_with',
                    shape: 'pill'
                });
            }
        } catch (err) {
            console.warn('Google Identity initialization error:', err);
        }
    },

    handleCredentialResponse(response) {
        if (!response || !response.credential) return;

        this.idToken = response.credential;
        localStorage.setItem(this.STORAGE_KEY, this.idToken);

        // Parse user payload from JWT
        try {
            const base64Url = this.idToken.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            const payload = JSON.parse(jsonPayload);
            this.currentUser = {
                sub: payload.sub,
                name: payload.name || 'Google 使用者',
                email: payload.email || '',
                picture: payload.picture || ''
            };
            localStorage.setItem(this.USER_KEY, JSON.stringify(this.currentUser));
        } catch (e) {
            console.error('Failed to parse credential payload:', e);
        }

        this.updateButtonUI(true);
        this.renderModalState();

        Swal.fire({
            toast: true,
            position: 'bottom',
            icon: 'success',
            title: `已登入 Google：${this.currentUser?.name || ''}`,
            showConfirmButton: false,
            timer: 2500
        });
    },

    logout() {
        this.idToken = null;
        this.currentUser = null;
        localStorage.removeItem(this.STORAGE_KEY);
        localStorage.removeItem(this.USER_KEY);
        if (window.google && window.google.accounts && window.google.accounts.id) {
            window.google.accounts.id.disableAutoSelect();
        }
        this.updateButtonUI(false);
        this.renderModalState();
    },

    updateButtonUI(isSignedIn) {
        const btn = document.getElementById('googleSyncToggleBtn');
        if (!btn) return;

        if (isSignedIn && this.currentUser) {
            btn.classList.add('signed-in');
            btn.setAttribute('title', `Google 雲端同步 [${this.currentUser.email}]`);
        } else {
            btn.classList.remove('signed-in');
            btn.setAttribute('title', 'Google 跨裝置雲端同步 [點擊設定]');
        }
    },

    renderModalState() {
        const loggedInSection = document.getElementById('syncLoggedInSection');
        const loginPromptSection = document.getElementById('syncLoginPromptSection');
        if (!loggedInSection || !loginPromptSection) return;

        if (this.idToken && this.currentUser) {
            loggedInSection.style.display = 'block';
            loginPromptSection.style.display = 'none';

            const nameEl = document.getElementById('syncUserName');
            const emailEl = document.getElementById('syncUserEmail');
            const avatarEl = document.getElementById('syncUserAvatar');

            if (nameEl) nameEl.textContent = this.currentUser.name;
            if (emailEl) emailEl.textContent = this.currentUser.email;
            if (avatarEl) {
                avatarEl.src = this.currentUser.picture || 'img/navbar/share.svg';
            }
        } else {
            loggedInSection.style.display = 'none';
            loginPromptSection.style.display = 'block';

            // Re-render Google button
            this.initGoogleClient();
        }
    },

    async pushContent() {
        if (!this.idToken) {
            this.promptLogin();
            return;
        }

        const editor = document.getElementById('note');
        const content = editor ? editor.value : '';

        // Empty editor confirmation -> clear cloud
        if (!content || !content.trim()) {
            const res = await Swal.fire({
                icon: 'question',
                title: '清空雲端確認',
                text: '目前編輯區為空白，送出將會「清空」雲端 Redis 中的暫存內容，確認執行嗎？',
                showCancelButton: true,
                confirmButtonText: '確認清空雲端',
                cancelButtonText: '取消'
            });
            if (res.dismiss || !res.value) return;
        }

        try {
            const resp = await fetch('api/sync.php?action=push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: this.idToken,
                    content: content
                })
            });

            const data = await resp.json();
            if (resp.ok && data.success) {
                Swal.fire({
                    toast: true,
                    position: 'bottom',
                    icon: 'success',
                    title: data.cleared ? '已清空雲端內容' : '已成功傳送至雲端（48 小時內有效）',
                    showConfirmButton: false,
                    timer: 2500
                });
                $('#googleSyncModal').modal('hide');
            } else {
                throw new Error(data.error || '傳送失敗');
            }
        } catch (err) {
            Swal.fire({
                icon: 'error',
                title: '傳送失敗',
                text: err.message
            });
        }
    },

    async pullContent() {
        if (!this.idToken) {
            this.promptLogin();
            return;
        }

        try {
            const resp = await fetch('api/sync.php?action=pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: this.idToken })
            });

            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || '取出失敗');
            }

            if (!data.found || !data.content) {
                Swal.fire({
                    toast: true,
                    position: 'bottom',
                    icon: 'info',
                    title: '雲端目前沒有暫存的筆記內容',
                    showConfirmButton: false,
                    timer: 2500
                });
                return;
            }

            const cloudText = data.content;
            const editor = document.getElementById('note');
            const currentVal = editor ? editor.value : '';

            let nextContent = cloudText;
            let successToast = '已成功載入雲端內容！';

            if (currentVal && currentVal.trim()) {
                if (currentVal === cloudText) {
                    Swal.fire({
                        toast: true,
                        position: 'bottom',
                        type: 'info',
                        icon: 'info',
                        title: '目前編輯區內容已與雲端完全一致',
                        showConfirmButton: false,
                        timer: 2000
                    });
                    return;
                }

                const result = await Swal.fire({
                    customClass: { popup: 'cloud-pull-dialog' },
                    title: '取出雲端內容處理方式',
                    text: '目前編輯區已有內容，您希望如何處置？',
                    input: 'radio',
                    inputOptions: {
                        overwrite: '覆蓋目前內容',
                        append: '附加於末尾',
                        backup: '備份至 Tabbypad 後載入'
                    },
                    inputValue: 'overwrite',
                    showCancelButton: true,
                    confirmButtonText: '載入',
                    cancelButtonText: '取消'
                });

                if (result.dismiss || !result.value) return;
                const action = result.value;

                if (action === 'backup') {
                    if (!window.TabbypadStorage || typeof window.TabbypadStorage.createNote !== 'function') {
                        await Swal.fire({
                            type: 'error',
                            icon: 'error',
                            title: '備份至 Tabbypad 失敗',
                            text: 'Tabbypad 儲存模組未載入，未載入雲端內容，原草稿已保留。'
                        });
                        return;
                    }
                    try {
                        await window.TabbypadStorage.createNote(currentVal);
                    } catch (err) {
                        await Swal.fire({
                            type: 'error',
                            icon: 'error',
                            title: '備份至 Tabbypad 失敗',
                            text: '無法建立備份，未載入雲端內容，原草稿已保留。'
                        });
                        return;
                    }
                    nextContent = cloudText;
                    successToast = '已將舊內容存入 Tabbypad 並成功載入雲端內容！';
                } else if (action === 'append') {
                    nextContent = currentVal + '\n\n' + cloudText;
                    successToast = '已附加雲端內容至文章末尾';
                } else {
                    nextContent = cloudText;
                    successToast = '已覆蓋載入雲端內容';
                }
            }

            // Persist first before changing the editor UI
            try {
                setState('note', nextContent);
            } catch (err) {
                await Swal.fire({
                    type: 'error',
                    icon: 'error',
                    title: '儲存失敗',
                    text: '儲存空間不足或寫入失敗，未載入雲端內容，原草稿已保留。'
                });
                return;
            }

            if (editor) {
                editor.value = nextContent;
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
            updateWordCountPill(nextContent);
            if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function') {
                window.MarkdownPreview.disable({ contentChanged: true });
            }
            if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function') {
                window.HtmlPreview.disable({ contentChanged: true });
            }
            $('#googleSyncModal').modal('hide');
            Swal.fire({
                toast: true,
                position: 'bottom',
                type: 'success',
                icon: 'success',
                title: successToast,
                showConfirmButton: false,
                timer: 2000
            });
        } catch (err) {
            Swal.fire({
                icon: 'error',
                title: '取出失敗',
                text: err.message
            });
        }
    },

    promptLogin() {
        $('#googleSyncModal').modal('show');
        this.renderModalState();
        this.initGoogleClient();
    },

    bindEvents() {
        const toggleBtn = document.getElementById('googleSyncToggleBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                $('#googleSyncModal').modal('show');
                this.renderModalState();
                this.initGoogleClient();
            });
        }

        const pushBtn = document.getElementById('syncPushBtn');
        if (pushBtn) {
            pushBtn.addEventListener('click', () => this.pushContent());
        }

        const pullBtn = document.getElementById('syncPullBtn');
        if (pullBtn) {
            pullBtn.addEventListener('click', () => this.pullContent());
        }

        const logoutBtn = document.getElementById('syncLogoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
    }
};

window.GoogleCloudSync = GoogleCloudSync;
