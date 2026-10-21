$(document).ready(function () {
	
	const welcomeText = `Welcome! `;
	const darkmodeText = 'Enable dark mode [Ctrl/Cmd + M]';
	const lightmodeText = 'Enable light mode [Ctrl/Cmd + M]';
	const darkMetaColor = '#0d1117';
	const lightMetaColor = '#4d4d4d';
	const metaThemeColor = document.querySelector('meta[name=theme-color]');
	const { notepad, state, setState, removeState, get } = selector();
	const optimalLineLengthPadding = '15px 15vw 40px';

	const editorConfig = selector().defaultConfig;

	const themeConfig = {
		lightmodeText,
		darkmodeText,
		lightMetaColor,
		darkMetaColor,
		metaThemeColor
	};
	
	const noteItem = state.note && state.note != '' ? state.note : welcomeText;
	const characterAndWordCountText = calculateCharactersAndWords(noteItem);

	
	// The lifecycle module owns loading and input state; this adapter only binds app controls.
	const initialBoshiamyState = state.userChosenBoshiamy === 'Yes';
	let rememberedBoshiamyState = initialBoshiamyState;
	function updateBoshiamyUI({ phase, desiredEnabled }) {
		const enabled = phase === 'enabled';
		const loading = phase === 'loading';
		const title = phase === 'failed' ? '嘸蝦米載入失敗，點擊重試'
			: loading ? '嘸蝦米字典載入中，點擊可取消啟用'
			: `嘸蝦米輸入法已${enabled ? '開啟' : '關閉'} [點擊或 Ctrl/Cmd + B 切換]`;
		$('#boshiamyToggle').toggleClass('active', enabled).toggleClass('loading', loading)
			.attr('title', title).attr('aria-pressed', String(enabled))
			.attr('aria-busy', String(loading));
		$('#boshiamyImePref').prop('checked', desiredEnabled).prop('disabled', false);
	}
	const boshiamyReady = import('./ime/v76/boshiamy.js').then(({ createBoshiamy }) => {
		let initialized = false;
		const ime = createBoshiamy({
			textarea: notepad.note[0],
			onStateChange(snapshot) {
				updateBoshiamyUI(snapshot);
				if (initialized && snapshot.desiredEnabled !== rememberedBoshiamyState) {
					rememberedBoshiamyState = snapshot.desiredEnabled;
					try { setState('userChosenBoshiamy', snapshot.desiredEnabled ? 'Yes' : 'No'); }
					catch { showToast('無法儲存嘸蝦米偏好設定'); }
				}
			},
			onError(error) {
				Swal.fire({
					toast: true, position: 'bottom', type: 'error',
					title: '嘸蝦米字典載入失敗，可點擊按鈕重試',
					text: error.message, showConfirmButton: false, timer: 3500
				});
			}
		});
		initialized = true;
		void ime.setEnabled(initialBoshiamyState);
		window.addEventListener('pagehide', event => {
			if (event.persisted) ime.cancel();
			else ime.destroy();
		});
		return ime;
	}).catch(error => {
		updateBoshiamyUI({ phase: 'failed', desiredEnabled: false });
		console.error('Failed to initialize Boshiamy:', error);
		return null;
	});
	function setBoshiamyState(enabled, persist = true) {
		if (!persist) rememberedBoshiamyState = enabled;
		void boshiamyReady.then(ime => ime?.setEnabled(enabled));
	}
	function toggleBoshiamy() {
		void boshiamyReady.then(ime => ime?.toggle());
	}
	function refreshBoshiamyDocument() {
		void boshiamyReady.then(ime => ime?.refreshDocument());
	}
	function handleBoshiamyShortcut(event) {
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyB') {
			event.preventDefault();
			toggleBoshiamy();
		}
	}
	$('#boshiamyToggle').on('click', toggleBoshiamy);
	$('#boshiamyImePref').on('change', function () {
		setBoshiamyState($(this).is(':checked'));
	});
	// Initialize Voice Dictation (Web Speech API)
	const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
	let recognition = null;
	let isRecording = false;
	const voiceBtn = $('#voiceDictationToggle');

	if (!SpeechRecognition) {
		voiceBtn.parent().hide();
	} else {
		function getEffectiveVoiceLang() {
			const chosen = localStorage.getItem('userChosenVoiceLang') || editorConfig.defaultVoiceLang;
			if (!chosen || chosen === 'auto') {
				return navigator.language || 'zh-TW';
			}
			return chosen;
		}

		function initRecognition() {
			const rec = new SpeechRecognition();
			rec.continuous = true;
			rec.interimResults = false;
			rec.lang = getEffectiveVoiceLang();
			rec.onstart = function () {
				isRecording = true;
				voiceBtn.addClass('recording').attr('title', '語音轉文字錄音中... [點擊停止]');
			};

			rec.onresult = function (event) {
				let transcript = '';
				for (let i = event.resultIndex; i < event.results.length; ++i) {
					if (event.results[i].isFinal) {
						transcript += event.results[i][0].transcript;
					}
				}
				if (transcript) {
					if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function') {
						window.MarkdownPreview.disable({ contentChanged: true });
					}
					if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function') {
						window.HtmlPreview.disable({ contentChanged: true });
					}
					insertTextAtCursor(transcript);
				}
			};

			rec.onerror = function (event) {
				console.warn('Speech recognition error:', event.error);
				if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
					Swal.fire({
						toast: true,
						position: 'bottom',
						icon: 'error',
						title: '無法存取麥克風，請檢查瀏覽器麥克風權限',
						showConfirmButton: false,
						timer: 3000
					});
				}
				stopDictation();
			};

			rec.onend = function () {
				if (isRecording) {
					// In continuous mode, some engines timeout after silence; restart if intended
					try {
						rec.start();
					} catch (e) {
						stopDictation();
					}
				} else {
					stopDictation();
				}
			};

			return rec;
		}

		function insertTextAtCursor(text) {
			const el = document.getElementById('note');
			if (!el) return;
			el.focus();
			let inserted = false;
			try {
				inserted = document.execCommand('insertText', false, text);
			} catch (e) {
				inserted = false;
			}
			if (!inserted) {
				const start = el.selectionStart;
				const end = el.selectionEnd;
				const val = el.value;
				el.value = val.substring(0, start) + text + val.substring(end);
				el.selectionStart = el.selectionEnd = start + text.length;
				el.dispatchEvent(new Event('input', { bubbles: true }));
			}
		}

		function startDictation() {
			if (isRecording) return;
			if (!recognition) {
				recognition = initRecognition();
			}
			try {
				recognition.start();
			} catch (e) {
				console.warn('Recognition start error:', e);
			}
		}

		function stopDictation() {
			isRecording = false;
			voiceBtn.removeClass('recording').attr('title', '語音轉文字 [Ctrl/Cmd + M]');
			if (recognition) {
				try {
					recognition.stop();
				} catch (e) {}
			}
		}

		function toggleDictation() {
			if (isRecording) {
				stopDictation();
			} else {
				startDictation();
			}
		}

		voiceBtn.on('click', function () {
			toggleDictation();
		});

		window.toggleDictation = toggleDictation;

		function updateVoiceLang(newLang, persist = true) {
			if (persist) {
				setState('userChosenVoiceLang', newLang);
			}
			notepad.voiceLang.val(newLang);
			if (recognition) {
				recognition.lang = getEffectiveVoiceLang();
				// If actively recording, restart recognition seamlessly to apply new language
				if (isRecording) {
					try {
						recognition.stop();
					} catch (e) {}
				}
			}
		}

		// Initialize Voice Lang preference
		const initialVoiceLang = state.userChosenVoiceLang || editorConfig.defaultVoiceLang;
		notepad.voiceLang.val(initialVoiceLang);

		notepad.voiceLang.on('change', function () {
			updateVoiceLang(this.value, true);
		});

		window.updateVoiceLang = updateVoiceLang;
	}
	

	// Handle editor auto-scroll for long notes
	var styles = window.getComputedStyle(notepad.note[0]);
    var paddingBottom = parseInt(styles.paddingBottom, 10) || 0;

	let pendingAutoScrollRaf = null;
	let pendingAutoScrollEl = null;

	notepad.note.on('input', (e) => {
		pendingAutoScrollEl = e.target;

		if (pendingAutoScrollRaf) return;

		pendingAutoScrollRaf = requestAnimationFrame(() => {
			pendingAutoScrollRaf = null;

			const textarea = pendingAutoScrollEl;
			if (!textarea) return;

			if (textarea.selectionStart >= textarea.value.length) {
				textarea.scrollTop = textarea.scrollHeight + paddingBottom;
			}
		});
	});
	// Handle editor auto-scroll for long notes


	notepad.wordCount.text(characterAndWordCountText);
	notepad.note.val(noteItem);

	$('[data-toggle="tooltip"]').tooltip({
		container: 'body'
	});

	if (!state.isUserPreferredTheme) {
		setState('isUserPreferredTheme', 'false');
	}

	if (state.userChosenFontSize) {
		notepad.note.css('font-size', state.userChosenFontSize + 'px');
		notepad.fontSize.val(state.userChosenFontSize);
	} else {
		resetFontSize(editorConfig.defaultFontSize);
	}

	if (state.userChosenFontWeight) {
		notepad.note.css('font-weight', state.userChosenFontWeight);
		notepad.fontWeight.val(state.userChosenFontWeight);
	} else {
		resetFontWeight(editorConfig.defaultFontWeight);
	}

	if (state.userChosenLineHeight) {
		notepad.note.css('line-height', state.userChosenLineHeight + 'px');
		notepad.lineHeight.val(state.userChosenLineHeight);
	} else {
		resetLineHeight(editorConfig.defaultLineHeight);
	}
	let markdownPreviewLoadPromise = null;
	async function ensureMarkdownPreviewLoaded() {
		if (window.MarkdownPreview && typeof window.MarkdownPreview.enable === 'function') {
			return window.MarkdownPreview;
		}
		if (markdownPreviewLoadPromise) {
			return markdownPreviewLoadPromise;
		}


		markdownPreviewLoadPromise = (async () => {
			await loadScript('js/libraries/marked-18.1.1.umd.js');
			await loadScript('js/libraries/purify-3.4.17.min.js');
			await loadScript('js/markdown-preview.js?v=78');
			if (window.MarkdownPreview && typeof window.MarkdownPreview.init === 'function') {
				window.MarkdownPreview.init();
			}
			return window.MarkdownPreview;
		})().catch(err => {
			markdownPreviewLoadPromise = null;
			throw err;
		});

		return markdownPreviewLoadPromise;
	}

	const mdToggleBtn = document.getElementById('markdownPreviewToggle');
	if (mdToggleBtn) {
		mdToggleBtn.addEventListener('click', async function (e) {
			e.preventDefault();
			if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function' && window.HtmlPreview.isEnabled()) {
				window.HtmlPreview.disable({ contentChanged: false });
			}
			if (window.MarkdownPreview && typeof window.MarkdownPreview.isEnabled === 'function') {
				window.MarkdownPreview.toggle();
				return;
			}
			const originalTitle = mdToggleBtn.title;
			mdToggleBtn.title = '正在載入 Markdown 模組...';
			mdToggleBtn.style.opacity = '0.7';
			try {
				const md = await ensureMarkdownPreviewLoaded();
				if (md && typeof md.enable === 'function') {
					md.enable();
				}
			} catch (err) {
				console.error('Failed to lazy load Markdown preview:', err);
				if (typeof Swal !== 'undefined' && Swal.fire) {
					Swal.fire({
						toast: true,
						position: 'bottom',
						type: 'error',
						title: 'Markdown 模組載入失敗',
						text: err.message,
						showConfirmButton: false,
						timer: 3500
					});
				}
			} finally {
				mdToggleBtn.title = originalTitle;
				mdToggleBtn.style.opacity = '';
			}
		});
	}

	let htmlPreviewLoadPromise = null;
	async function ensureHtmlPreviewLoaded() {
		if (window.HtmlPreview && typeof window.HtmlPreview.enable === 'function') {
			return window.HtmlPreview;
		}
		if (htmlPreviewLoadPromise) {
			return htmlPreviewLoadPromise;
		}

		htmlPreviewLoadPromise = (async () => {
			// Load DOMPurify then html-preview.js
			await loadScript('js/libraries/purify-3.4.17.min.js');
			await loadScript('js/html-preview.js?v=78');
			if (window.HtmlPreview && typeof window.HtmlPreview.init === 'function') {
				window.HtmlPreview.init();
			}
			return window.HtmlPreview;
		})().catch(err => {
			htmlPreviewLoadPromise = null;
			throw err;
		});

		return htmlPreviewLoadPromise;
	}

	const htmlToggleBtn = document.getElementById('htmlPreviewToggle');
	if (htmlToggleBtn) {
		htmlToggleBtn.addEventListener('click', async function (e) {
			e.preventDefault();
			if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function' && window.MarkdownPreview.isEnabled()) {
				window.MarkdownPreview.disable({ contentChanged: false });
			}
			if (window.HtmlPreview && typeof window.HtmlPreview.isEnabled === 'function') {
				window.HtmlPreview.toggle();
				return;
			}
			const originalTitle = htmlToggleBtn.title;
			htmlToggleBtn.title = '正在載入 HTML 預覽模組...';
			htmlToggleBtn.style.opacity = '0.7';
			try {
				const hp = await ensureHtmlPreviewLoaded();
				if (hp && typeof hp.enable === 'function') {
					hp.enable();
				}
			} catch (err) {
				console.error('Failed to lazy load HTML preview:', err);
				if (typeof Swal !== 'undefined' && Swal.fire) {
					Swal.fire({
						toast: true,
						position: 'bottom',
						type: 'error',
						title: 'HTML 預覽模組載入失敗',
						text: err.message,
						showConfirmButton: false,
						timer: 3500
					});
				}
			} finally {
				htmlToggleBtn.title = originalTitle;
				htmlToggleBtn.style.opacity = '';
			}
		});
	}
	if (window.SyntaxHighlighter && typeof window.SyntaxHighlighter.init === 'function') {
		window.SyntaxHighlighter.init();
	}
	window._appTextareaContainer = document.getElementById("textareaContainer");
	if (typeof syncTextareaContainerTheme === 'function') {
		syncTextareaContainerTheme();
	}

	const userChosenWordCountPillSelected = state.userChosenWordCountPillSelected;
	if (userChosenWordCountPillSelected === 'No') {
		notepad.wordCountContainer.hide();
		notepad.showWordCountPill.prop('checked', false);
	} else {
		notepad.wordCountContainer.show();
		notepad.showWordCountPill.prop('checked', true);
	}

	if (state.userChosenTexture) {
		const allowedTextures = ['normal', 'dotted', 'graph', 'chessboard', 'starfield', 'grain', 'linen', 'recycled', 'newspaper', 'marble'];

		if (allowedTextures.includes(state.userChosenTexture)) {
			$(document.body).removeClass('dotted-paper graph-paper chessboard-paper starfield-paper grain-paper linen-paper recycled-paper newspaper-paper marble-paper');

			if (state.userChosenTexture == 'dotted') {
				$(document.body).addClass('dotted-paper');
			} else if (state.userChosenTexture == 'graph') {
				$(document.body).addClass('graph-paper');
			} else if (state.userChosenTexture == 'chessboard') {
				$(document.body).addClass('chessboard-paper');
			} else if (state.userChosenTexture == 'starfield') {
				$(document.body).addClass('starfield-paper');
			} else if (state.userChosenTexture == 'grain') {
				$(document.body).addClass('grain-paper');
			} else if (state.userChosenTexture == 'linen') {
				$(document.body).addClass('linen-paper');
			} else if (state.userChosenTexture == 'recycled') {
				$(document.body).addClass('recycled-paper');
			} else if (state.userChosenTexture == 'newspaper') {
				$(document.body).addClass('newspaper-paper');
			} else if (state.userChosenTexture == 'marble') {
				$(document.body).addClass('marble-paper');
			}

			notepad.texture.val(state.userChosenTexture);
		} else {
			removeState('userChosenTexture');
			resetTexture(editorConfig.defaultTexture);
		}
	}

	if (state.userChosenOptimalLineLengthSelected) {
		const textArea = document.getElementById('note');

		if (state.userChosenOptimalLineLengthSelected === 'Yes') {
			textArea.style.padding = optimalLineLengthPadding;
		} else {
			textArea.style.padding = editorConfig.defaultOptimalLineLengthPadding;
		}

		notepad.optimalLineLength.prop('checked', state.userChosenOptimalLineLengthSelected === 'Yes');
	} else {
		notepad.optimalLineLength.prop('checked', false);
	}

	if (state.userChosenSpellCheck) {
		if (state.userChosenSpellCheck === 'Yes') {
			notepad.note.attr('spellcheck', true);
		} else {
			notepad.note.attr('spellcheck', false);
		}

		notepad.spellCheck.prop('checked', state.userChosenSpellCheck === 'Yes');
	} else {
		notepad.spellCheck.prop('checked', true);
	}

	if (state.userChosenTabIndentation) {
		notepad.tabIndentation.prop('checked', state.userChosenTabIndentation === 'Yes');
	} else {
		notepad.tabIndentation.prop('checked', false);
	}

	if (state.mode && state.mode === 'dark') {
		enableDarkMode(lightmodeText, darkMetaColor, metaThemeColor);

		$('input[name="themes"][value="dark"]').prop('checked', true);
	} else if (state.mode && state.mode === 'light') {
		enableLightMode(darkmodeText, lightMetaColor, metaThemeColor);

		$('input[name="themes"][value="light"]').prop('checked', true);	
	} else {
		enableDeviceTheme(themeConfig);

		$('input[name="themes"][value="device"]').prop('checked', true);
	}

	const themeRadios = document.querySelectorAll('input[name="themes"]');

    themeRadios.forEach(radio => {
        radio.addEventListener('change', (event) => {
            switch (event.target.value) {
				case 'dark':
					enableDarkMode(lightmodeText, darkMetaColor, metaThemeColor);
					break;
				case 'light':
					enableLightMode(darkmodeText, lightMetaColor, metaThemeColor);
					break;
				case 'device':
					enableDeviceTheme(themeConfig);
					break;
			}
        });
    });
	notepad.note.on('input', function () {
		if (window.MarkdownPreview && typeof window.MarkdownPreview.isEnabled === 'function' && window.MarkdownPreview.isEnabled()) {
			window.MarkdownPreview.disable({ contentChanged: true });
		}
		if (window.HtmlPreview && typeof window.HtmlPreview.isEnabled === 'function' && window.HtmlPreview.isEnabled()) {
			window.HtmlPreview.disable({ contentChanged: true });
		}
	});

	notepad.note.on('input', debounce(function () {
		updateWordCountPill(get(this).val());
		setState('note', get(this).val());
	}, 500));

	notepad.note.keydown(function (e) {
		const tabIndentation = notepad.tabIndentation.prop('checked');

		if (e.key === "Tab" && tabIndentation) {
			e.preventDefault(); 
	
			let textarea = e.target;
			let start = textarea.selectionStart;
			let end = textarea.selectionEnd;
			let tabCharacter = "\t";
	
			if (start === end) {
				// Single cursor position: Insert tab
				document.execCommand("insertText", false, tabCharacter);
				textarea.selectionStart = textarea.selectionEnd = start + tabCharacter.length;
			} else {
				// Multi-line selection: Add tab to each line
				let value = textarea.value;
				let selectedText = value.substring(start, end);
				let lines = selectedText.split("\n");
	
				if (e.shiftKey) {
					// Shift+Tab: Remove leading tab if present
					let unindentedLines = lines.map(line =>
						line.startsWith(tabCharacter) ? line.substring(tabCharacter.length) : line
					);
					document.execCommand("insertText", false, unindentedLines.join("\n"));
				} else {
					// Tab: Indent each line
					let indentedLines = lines.map(line => tabCharacter + line);
					document.execCommand("insertText", false, indentedLines.join("\n"));
				}
			}
		}
	});

	notepad.clearNotes.on('click', function () {
		deleteNotes();
	});

	notepad.copyToClipboard.click(function () {
		copyNotesToClipboard(notepad.note.val());
	})

	notepad.downloadNotes.click(function () {
		saveTextAsFile(note.value, getFileName(note.value));
	});


	notepad.fullScreenButton.click(function () {
		toggleFullScreen();
	})

	notepad.focusModeButton.click(function () {
		toggleFocusMode(notepad);
	})

	notepad.focusModeCloseButton.click(function () {
		turnOffFocusMode(notepad);
	})

	notepad.fontSize.on('change', function (e) {
		const fontSizeSelected = this.value;

		notepad.note.css('font-size', fontSizeSelected + 'px');
		setState('userChosenFontSize', fontSizeSelected);
	});

	notepad.lineHeight.on('change', function (e) {
		const lineHeightSelected = this.value;

		notepad.note.css('line-height', lineHeightSelected + 'px');
		setState('userChosenLineHeight', lineHeightSelected);
	});

	notepad.fontWeight.on('change', function (e) {
		const fontWeightSelected = this.value;

		notepad.note.css('font-weight', fontWeightSelected);
		setState('userChosenFontWeight', fontWeightSelected);
	});

	notepad.texture.on('change', function (e) {
		const textureSelected = this.value;

		$(document.body).removeClass('dotted-paper graph-paper chessboard-paper starfield-paper grain-paper linen-paper recycled-paper newspaper-paper marble-paper');

		if (textureSelected == 'dotted') {
			$(document.body).addClass('dotted-paper');
		} else if (textureSelected == 'graph') {
			$(document.body).addClass('graph-paper');
		} else if (textureSelected == 'chessboard') {
			$(document.body).addClass('chessboard-paper');
		} else if (textureSelected == 'starfield') {
			$(document.body).addClass('starfield-paper');
		} else if (textureSelected == 'grain') {
			$(document.body).addClass('grain-paper');
		} else if (textureSelected == 'linen') {
			$(document.body).addClass('linen-paper');
		} else if (textureSelected == 'recycled') {
			$(document.body).addClass('recycled-paper');
		} else if (textureSelected == 'newspaper') {
			$(document.body).addClass('newspaper-paper');
		} else if (textureSelected == 'marble') {
			$(document.body).addClass('marble-paper');
		}

		setState('userChosenTexture', textureSelected);
	});

	notepad.showWordCountPill.on('change', function (e) {
		if ($(this).is(':checked')) {
			notepad.wordCountContainer.show();
			setState('userChosenWordCountPillSelected', 'Yes');
		} else {
			notepad.wordCountContainer.hide();
			setState('userChosenWordCountPillSelected', 'No');
		}
	});

	notepad.optimalLineLength.on('change', function (e) {
		const textArea = document.getElementById('note');

		if ($(this).is(':checked')) {
			textArea.style.padding = optimalLineLengthPadding;
			setState('userChosenOptimalLineLengthSelected', 'Yes');
		} else {
			textArea.style.padding = editorConfig.defaultOptimalLineLengthPadding;
			setState('userChosenOptimalLineLengthSelected', 'No');
		}
	})

	notepad.spellCheck.on('change', function (e) {
		if ($(this).is(':checked')) {
			notepad.note.attr('spellcheck', true);
			setState('userChosenSpellCheck', 'Yes');
		} else {
			notepad.note.attr('spellcheck', false);
			setState('userChosenSpellCheck', 'No');
		}
	})

	notepad.tabIndentation.on('change', function (e) {
		if ($(this).is(':checked')) {
			setState('userChosenTabIndentation', 'Yes');
		} else {
			setState('userChosenTabIndentation', 'No');
		}
	})

	notepad.resetPreferences.click(function () {
		if (selector().state.userChosenFontSize) {
			removeState('userChosenFontSize');
			resetFontSize(editorConfig.defaultFontSize);
		}

		if (selector().state.userChosenLineHeight) {
			removeState('userChosenLineHeight');
			resetLineHeight(editorConfig.defaultLineHeight);
		}

		if (selector().state.userChosenFontWeight) {
			removeState('userChosenFontWeight');
			resetFontWeight(editorConfig.defaultFontWeight);
		}

		if (selector().state.userChosenWordCountPillSelected) {
			removeState('userChosenWordCountPillSelected');
			resetShowWordCountPill(editorConfig.defaultShowWordCountPill);
		}

		if (selector().state.userChosenWriteDirection) {
			removeState('userChosenWriteDirection');
			resetWriteDirection(editorConfig.defaultWriteDirection);
		}

		if (selector().state.userChosenTexture) {
			removeState('userChosenTexture');
			resetTexture(editorConfig.defaultTexture);
		}

		if (selector().state.userChosenOptimalLineLengthSelected) {
			removeState('userChosenOptimalLineLengthSelected');
			resetOptimalLineLength(editorConfig.defaultOptimalLineLengthPadding, editorConfig.defaultOptimalLineLength);
		}

		if (selector().state.selectedFont) {
			removeState('selectedFont');
			resetFont(editorConfig.defaultFont);
		}

		if (selector().state.userChosenSpellCheck) {
			removeState('userChosenSpellCheck');
			notepad.note.attr('spellcheck', false);
			notepad.spellCheck.prop('checked', editorConfig.defaultSpellCheck);
		}

		if (selector().state.userChosenTabIndentation) {
			removeState('userChosenTabIndentation');
			notepad.tabIndentation.prop('checked', editorConfig.defaultTabIndentation);
		}


		if (selector().state.userChosenBoshiamy) {
			removeState('userChosenBoshiamy');
			setBoshiamyState(editorConfig.defaultBoshiamy, false);
		}

		if (selector().state.userChosenVoiceLang) {
			removeState('userChosenVoiceLang');
			if (typeof window.updateVoiceLang === 'function') {
				window.updateVoiceLang(editorConfig.defaultVoiceLang, false);
			} else {
				notepad.voiceLang.val(editorConfig.defaultVoiceLang);
			}
		}


		// Reset to device theme as default
		$('input[name="themes"][value="device"]').prop('checked', true);
		enableDeviceTheme(themeConfig);
	});

	if (navigator.share && window.self === window.top) {
		$('#shareNotesContainer').show();
	}

	notepad.shareNotes.click(function (e) {
		e.stopPropagation();
		const textToShare = note.value;
		shareNotes(textToShare);
	});

	let activeFloatingWindow = null;

	const pipButton = document.getElementById('pip');

	if (pipButton) {
		$('#pipContainer').show();

		pipButton.addEventListener('click', async () => {
			const appTextarea = document.getElementById("textareaContainer");
			window._appTextareaContainer = appTextarea;
			if (!appTextarea) return;

			const isPipSupported = ('documentPictureInPicture' in window) && (typeof documentPictureInPicture.requestWindow === 'function');

			if (isPipSupported) {
				try {
					const pipWindow = await documentPictureInPicture.requestWindow({
						width: 380,
						height: 520,
						disallowReturnToOpener: false
					});
					activeFloatingWindow = pipWindow;
					pipWindow.document.title = 'LazyDraft - 浮動視窗';

					// Copy styles to Picture-in-Picture window
					[...document.styleSheets].forEach((styleSheet) => {
						try {
							const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
							const style = document.createElement('style');
							style.textContent = cssRules;
							pipWindow.document.head.appendChild(style);
						} catch (e) {
							const link = document.createElement('link');
							link.rel = 'stylesheet';
							link.type = styleSheet.type;
							link.media = styleSheet.media;
							link.href = styleSheet.href;
							pipWindow.document.head.appendChild(link);
						}
					});

					// Floating window responsive layout & header style
					const customStyle = document.createElement('style');
					customStyle.textContent = `
						html, body {
							margin: 0 !important;
							padding: 0 !important;
							height: 100% !important;
							overflow: hidden !important;
							display: flex !important;
							flex-direction: column !important;
						}
						#textareaContainer {
							flex: 1 1 auto !important;
							display: flex !important;
							flex-direction: column !important;
							width: 100% !important;
							max-width: 100% !important;
							margin: 0 !important;
							padding: 0 !important;
							height: 100% !important;
							min-height: 0 !important;
						}
						.starter-template {
							flex: 1 1 auto !important;
							display: flex !important;
							flex-direction: column !important;
							height: 100% !important;
							min-height: 0 !important;
							padding: 0 !important;
							margin: 0 !important;
						}
						#note {
							flex: 1 1 auto !important;
							width: 100% !important;
							height: 100% !important;
							box-sizing: border-box !important;
							border: none !important;
							padding: 12px 12px 64px !important;
							outline: none !important;
						}
					`;
					pipWindow.document.head.appendChild(customStyle);


					appTextarea.classList.toggle('dark', document.body.classList.contains('dark'));
					pipWindow.document.body.append(appTextarea);
					pipWindow.document.body.classList.toggle('dark', document.body.classList.contains('dark'));
					refreshBoshiamyDocument();
					pipWindow.document.addEventListener('keydown', handleBoshiamyShortcut);

					const mainContainer = document.querySelector("#mainContainer");
					const overlay = document.querySelector(".overlay");
					mainContainer.classList.add("pip");
					overlay.style.display = "block";
					overlay.style.pointerEvents = "all";

					overlay.onclick = () => {
						try {
							if (window.MarkdownPreview && typeof window.MarkdownPreview.focus === 'function' && window.MarkdownPreview.isEnabled()) {
								window.MarkdownPreview.focus();
							} else if (window.HtmlPreview && typeof window.HtmlPreview.focus === 'function' && window.HtmlPreview.isEnabled()) {
								window.HtmlPreview.focus();
							}
						} catch (e) {}
						pipWindow.close();
					};

					pipWindow.addEventListener("pagehide", (event) => {
						activeFloatingWindow = null;
						const textareaContainer = event.target?.querySelector?.("#textareaContainer") || appTextarea;
						mainContainer.append(textareaContainer);
						refreshBoshiamyDocument();
						pipWindow.document.removeEventListener('keydown', handleBoshiamyShortcut);
						mainContainer.classList.remove("pip");
						overlay.style.display = "none";
						overlay.style.pointerEvents = "none";
						overlay.onclick = null;
						textareaContainer.classList.toggle('dark', document.body.classList.contains('dark'));
						try {
							if (window.MarkdownPreview && typeof window.MarkdownPreview.focus === 'function' && window.MarkdownPreview.isEnabled()) {
								window.MarkdownPreview.focus();
							} else if (window.HtmlPreview && typeof window.HtmlPreview.focus === 'function' && window.HtmlPreview.isEnabled()) {
								window.HtmlPreview.focus();
							} else {
								const noteEl = document.getElementById('note');
								if (noteEl) noteEl.focus();
							}
						} catch (e) {}
					});

					return;
				} catch (err) {
					console.warn('Document Picture-in-Picture failed, falling back to popup window', err);
				}
			}

			// Fallback popup window for browsers without Document Picture-in-Picture API
			showToast('提示：要讓視窗在切換分頁時持續浮在最上方，請使用 Chrome / Edge 桌面版（localhost 或 HTTPS）。目前使用彈出視窗模式。');
			const left = Math.max(0, (window.screen.availWidth || 1024) - 420);
			const top = 80;
			const popup = window.open('', 'NotepadFloatingWindow', `width=380,height=520,left=${left},top=${top},menubar=no,status=no,toolbar=no`);
			if (!popup) {
				showToast('請允許瀏覽器彈出視窗以使用浮動視窗功能。');
				return;
			}
			activeFloatingWindow = popup;
			popup.document.title = 'LazyDraft - 浮動視窗';

			[...document.styleSheets].forEach((styleSheet) => {
				try {
					const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
					const style = popup.document.createElement('style');
					style.textContent = cssRules;
					popup.document.head.appendChild(style);
				} catch (e) {
					const link = popup.document.createElement('link');
					link.rel = 'stylesheet';
					link.type = styleSheet.type;
					link.media = styleSheet.media;
					link.href = styleSheet.href;
					popup.document.head.appendChild(link);
				}
			});

			const popupStyle = popup.document.createElement('style');
			popupStyle.textContent = `
				html, body {
					margin: 0 !important;
					padding: 0 !important;
					height: 100% !important;
					overflow: hidden !important;
					display: flex !important;
					flex-direction: column !important;
				}
				#textareaContainer {
					flex: 1 1 auto !important;
					display: flex !important;
					flex-direction: column !important;
					width: 100% !important;
					max-width: 100% !important;
					margin: 0 !important;
					padding: 0 !important;
					height: 100% !important;
					min-height: 0 !important;
				}
				.starter-template {
					flex: 1 1 auto !important;
					display: flex !important;
					flex-direction: column !important;
					height: 100% !important;
					min-height: 0 !important;
					padding: 0 !important;
					margin: 0 !important;
				}
				#note {
					flex: 1 1 auto !important;
					width: 100% !important;
					height: 100% !important;
					box-sizing: border-box !important;
					border: none !important;
					padding: 12px 12px 64px !important;
					outline: none !important;
				}
			`;
			popup.document.head.appendChild(popupStyle);


			appTextarea.classList.toggle('dark', document.body.classList.contains('dark'));
			popup.document.body.append(appTextarea);
			popup.document.body.classList.toggle('dark', document.body.classList.contains('dark'));
			refreshBoshiamyDocument();
			popup.document.addEventListener('keydown', handleBoshiamyShortcut);

			const mainContainer = document.querySelector("#mainContainer");
			const overlay = document.querySelector(".overlay");
			mainContainer.classList.add("pip");
			overlay.style.display = "block";
			overlay.style.pointerEvents = "all";

			overlay.onclick = () => {
				try {
					if (window.MarkdownPreview && typeof window.MarkdownPreview.focus === 'function' && window.MarkdownPreview.isEnabled()) {
						window.MarkdownPreview.focus();
					} else if (window.HtmlPreview && typeof window.HtmlPreview.focus === 'function' && window.HtmlPreview.isEnabled()) {
						window.HtmlPreview.focus();
					}
				} catch (e) {}
				popup.close();
			};

			popup.addEventListener("pagehide", () => {
				activeFloatingWindow = null;
				mainContainer.append(appTextarea);
				refreshBoshiamyDocument();
				popup.document.removeEventListener('keydown', handleBoshiamyShortcut);
				mainContainer.classList.remove("pip");
				overlay.style.display = "none";
				overlay.style.pointerEvents = "none";
				overlay.onclick = null;
				appTextarea.classList.toggle('dark', document.body.classList.contains('dark'));
				try {
					if (window.MarkdownPreview && typeof window.MarkdownPreview.focus === 'function' && window.MarkdownPreview.isEnabled()) {
						window.MarkdownPreview.focus();
					} else if (window.HtmlPreview && typeof window.HtmlPreview.focus === 'function' && window.HtmlPreview.isEnabled()) {
						window.HtmlPreview.focus();
					} else {
						const noteEl = document.getElementById('note');
						if (noteEl) noteEl.focus();
					}
				} catch (e) {}
			});
		});
	}
	// This changes the application's theme when 
	// user toggles device's theme preference
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (state.mode && state.mode === 'device') {
			enableDeviceTheme(themeConfig);
		}
	});

	// This listens for keyboard shortcuts
	document.onkeydown = function (event) {
		event = event || window.event;

		if (event.key === 'Escape') {
			$('.modal').modal('hide');
			turnOffFocusMode(notepad);
		}

		if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
			saveTextAsFile(note.value, getFileName(note.value));
			event.preventDefault();
		}
		handleBoshiamyShortcut(event);
		if ((event.ctrlKey || event.metaKey) && event.code === 'KeyM') {
			event.preventDefault();
			if (typeof window.toggleDictation === 'function') {
				window.toggleDictation();
			}
		}



		if ((event.ctrlKey || event.metaKey) && event.code === 'Comma') {
			event.preventDefault();

			if (notepad.preferencesModal.hasClass('in'))
				return;

			$('.modal').modal('hide');
			notepad.preferencesModal.modal('show');
		}

		if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
			event.preventDefault();

			if (notepad.keyboardShortcutsModal.hasClass('in'))
				return;

			$('.modal').modal('hide');
			notepad.keyboardShortcutsModal.modal('show');
		}

		if (event.altKey && event.code === 'KeyC') {
			event.preventDefault();
			copyNotesToClipboard(notepad.note.val());
		}

		if (
			(event.ctrlKey && event.shiftKey && event.code === 'Delete') 
			|| (event.metaKey && event.shiftKey && event.code === 'Backspace')
		) {
			event.preventDefault();
			deleteNotes();
		}

		if (event.altKey && event.code === 'KeyF') {
			event.preventDefault();

			toggleFocusMode(notepad);
		}
	};

	// Font selection handler
	const fontSelect = document.getElementById('font');
	
	// Check for legacy font preferences and migrate them to the new system
	function migrateLegacyFontPrefs() {
		const dyslexicFont = localStorage.getItem('dyslexicFont') === 'true';
		const monospacedFont = localStorage.getItem('monospaced') === 'true';
		const serifFont = localStorage.getItem('serifFont') === 'true';
		
		if (dyslexicFont) {
			localStorage.setItem('selectedFont', 'dyslexic');
		} else if (monospacedFont) {
			localStorage.setItem('selectedFont', 'monospaced');
		} else if (serifFont) {
			localStorage.setItem('selectedFont', 'serif');
		} else {
			localStorage.setItem('selectedFont', 'default');
		}
		
		// Clear old preferences
		localStorage.removeItem('dyslexicFont');
		localStorage.removeItem('monospaced');
		localStorage.removeItem('serifFont');
	}
	
	// Apply font based on selection
	function applyFont(fontType) {
		// Remove all font classes first
		notepad.note.removeClass('dyslexic monospaced serif handwritten humanist pixel typewriter crayon');
		
		// Add the selected font class
		switch(fontType) {
			case 'dyslexic':
				notepad.note.addClass('dyslexic');
				break;
			case 'monospaced':
				notepad.note.addClass('monospaced');
				break;
			case 'serif':
				notepad.note.addClass('serif');
				break;
			case 'handwritten':
				notepad.note.addClass('handwritten');
				break;
			case 'humanist':
				notepad.note.addClass('humanist');
				break;
			case 'pixel':
				notepad.note.addClass('pixel');
				break;
			case 'typewriter':
				notepad.note.addClass('typewriter');
				break;
			case 'crayon':
				notepad.note.addClass('crayon');
				break;
			// 'default' case doesn't need any class
		}
	}
	
	// Initialize font selection
	function initFontSelection() {
		// Migrate legacy preferences if needed
		if (localStorage.getItem('dyslexicFont') !== null || 
			localStorage.getItem('monospaced') !== null || 
			localStorage.getItem('serifFont') !== null) {
			migrateLegacyFontPrefs();
		}
		
		// Get the selected font or default to 'default'
		const selectedFont = localStorage.getItem('selectedFont') || 'default';
		
		// Set the dropdown value
		fontSelect.value = selectedFont;
		
		// Apply the font
		applyFont(selectedFont);
	}
	
	// Handle font selection change
	fontSelect.addEventListener('change', (e) => {
		const selectedFont = e.target.value;
		localStorage.setItem('selectedFont', selectedFont);
		applyFont(selectedFont);
	});
	
	// Initialize font selection on page load
	initFontSelection();

	// ==================== Tabbypad Integration ====================
	let currentLinkedTabbypadId = null;
	let currentLinkedTabbypadBaseContent = null;
	let tabbypadNotesCache = [];

	function getFirstLineTitle(content) {
		if (!content) return '(空白筆記)';
		const line = content.split(/[\r\n]/, 1)[0].trim();
		return line || '(空白筆記)';
	}

	function formatTabbypadDate(dateString) {
		if (!dateString) return '';
		const d = new Date(dateString);
		if (isNaN(d.getTime())) return '';
		return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function updateTabbypadPillUI() {
		if (!currentLinkedTabbypadId) {
			notepad.tabbypadLinkedPill.hide();
			notepad.tabbypadUpdateLinkedBtn.hide();
			return;
		}

		const currentVal = notepad.note.val();
		const isDirty = currentVal !== currentLinkedTabbypadBaseContent;
		const title = getFirstLineTitle(currentLinkedTabbypadBaseContent);

		notepad.tabbypadPillTitle.text(title + (isDirty ? ' (未更新)' : ''));
		if (isDirty) {
			notepad.tabbypadLinkedPill.addClass('dirty');
		} else {
			notepad.tabbypadLinkedPill.removeClass('dirty');
		}
		notepad.tabbypadLinkedPill.show();
		notepad.tabbypadUpdateLinkedBtn.show();
	}

	function unlinkTabbypadNote(showToast = true) {
		currentLinkedTabbypadId = null;
		currentLinkedTabbypadBaseContent = null;
		updateTabbypadPillUI();
		if (showToast) {
			Swal.fire({
				toast: true,
				position: 'bottom',
				icon: 'info',
				title: '已解除 Tabbypad 項目連結（保留目前草稿）',
				showConfirmButton: false,
				timer: 2000
			});
		}
	}

	async function refreshTabbypadList(searchTerm = '') {
		if (typeof window.TabbypadStorage === 'undefined') return;
		try {
			tabbypadNotesCache = await window.TabbypadStorage.getAllNotes();
		} catch (err) {
			console.error('Failed to load Tabbypad notes:', err);
			notepad.tabbypadList.html('<li class="tabbypad-empty-state">無法讀取 Tabbypad 資料庫</li>');
			return;
		}

		const term = searchTerm.trim().toLowerCase();
		const filtered = term
			? tabbypadNotesCache.filter(n => (n.content || '').toLowerCase().includes(term))
			: tabbypadNotesCache;

		notepad.tabbypadStats.text(`${tabbypadNotesCache.length} 個項目`);

		if (filtered.length === 0) {
			notepad.tabbypadList.html('<li class="tabbypad-empty-state">尚無 Tabbypad 項目</li>');
			return;
		}

		notepad.tabbypadList.empty();
		filtered.forEach(note => {
			const title = getFirstLineTitle(note.content);
			const dateStr = formatTabbypadDate(note.created_at || note.id);
			const isCurrentlyActive = (note.id === currentLinkedTabbypadId);

			const li = $(`
				<li class="tabbypad-item ${isCurrentlyActive ? 'active-item' : ''}" data-id="${note.id}">
					<div class="tabbypad-item-info">
						<div class="tabbypad-item-title">${escapeHtml(title)}</div>
						<div class="tabbypad-item-meta">
							<span>建立時間：${dateStr}</span>
							<span>字數：${(note.content || '').length}</span>
						</div>
					</div>
					<div class="tabbypad-item-actions">
						<button type="button" class="tabbypad-action-btn tabbypad-load-btn">${isCurrentlyActive ? '重新載入' : '載入編輯'}</button>
					</div>
				</li>
			`);

			li.find('.tabbypad-load-btn').on('click', function (e) {
				e.stopPropagation();
				confirmAndLoadTabbypadNote(note);
			});

			li.on('click', function () {
				confirmAndLoadTabbypadNote(note);
			});

			notepad.tabbypadList.append(li);
		});
	}

	function escapeHtml(str) {
		return $('<div>').text(str || '').html();
	}

	async function saveCurrentAsNewTabbypadItem() {
		const content = notepad.note.val();
		if (!content || !content.trim()) {
			Swal.fire({
				toast: true,
				position: 'bottom',
				icon: 'warning',
				title: '目前編輯區為空白，無法建立項目',
				showConfirmButton: false,
				timer: 2000
			});
			return null;
		}

		try {
			const newNote = await window.TabbypadStorage.createNote(content);
			currentLinkedTabbypadId = newNote.id;
			currentLinkedTabbypadBaseContent = newNote.content;
			updateTabbypadPillUI();
			await refreshTabbypadList(notepad.tabbypadSearchInput.val());

			Swal.fire({
				toast: true,
				position: 'bottom',
				icon: 'success',
				title: '已存為新的 Tabbypad 項目！',
				showConfirmButton: false,
				timer: 2000
			});
			return newNote;
		} catch (err) {
			console.error('Failed to save new Tabbypad item:', err);
			Swal.fire({
				toast: true,
				position: 'bottom',
				icon: 'error',
				title: '儲存失敗，請檢查資料庫狀態',
				showConfirmButton: false,
				timer: 3000
			});
			return null;
		}
	}

	async function updateLinkedTabbypadItem() {
		if (!currentLinkedTabbypadId) {
			Swal.fire({
				toast: true,
				position: 'bottom',
				icon: 'info',
				title: '目前未連結任何 Tabbypad 項目',
				showConfirmButton: false,
				timer: 2000
			});
			return;
		}

		const content = notepad.note.val();

		// Conflict detection: verify database state first
		let dbNote;
		try {
			dbNote = await window.TabbypadStorage.getNoteById(currentLinkedTabbypadId);
		} catch (err) {
			console.error('Error fetching note for conflict check:', err);
		}

		if (!dbNote) {
			// Deleted by other tab
			const result = await Swal.fire({
				icon: 'warning',
				title: '原項目已不存在',
				text: '此項目已被其他分頁或視窗刪除。目前編輯內容已保留，您可存為新的 Tabbypad 項目。',
				showCancelButton: true,
				confirmButtonText: '存為新項目',
				cancelButtonText: '取消'
			});
			if (result.isConfirmed) {
				await saveCurrentAsNewTabbypadItem();
			}
			return;
		}

		// Content modified by other tab
		if (dbNote.content !== currentLinkedTabbypadBaseContent) {
			const result = await Swal.fire({
				icon: 'warning',
				title: '偵測到內容衝突',
				text: '此項目已在其他分頁被修改。為保護資料，已阻止覆蓋。您希望如何處理？',
				showCancelButton: true,
				confirmButtonText: '重新載入最新版本',
				cancelButtonText: '另存為新項目'
			});

			if (result.value || result.isConfirmed) {
				try {
					setState('note', dbNote.content);
				} catch (err) {
					Swal.fire({
						type: 'error',
						icon: 'error',
						title: '載入失敗',
						text: '儲存空間不足或寫入失敗，未載入新版本，原草稿已保留。'
					});
					return;
				}
				currentLinkedTabbypadId = dbNote.id;
				currentLinkedTabbypadBaseContent = dbNote.content;
				notepad.note.val(dbNote.content);
				notepad.note[0].dispatchEvent(new Event('input', { bubbles: true }));
				updateWordCountPill(dbNote.content);
				updateTabbypadPillUI();
				if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function') {
					window.MarkdownPreview.disable({ contentChanged: true });
				}
				if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function') {
					window.HtmlPreview.disable({ contentChanged: true });
				}
			} else if (result.dismiss === Swal.DismissReason.cancel) {
				await saveCurrentAsNewTabbypadItem();
			}
			return;
		}

		// Safe to update
		try {
			await window.TabbypadStorage.updateNote(currentLinkedTabbypadId, content);
			currentLinkedTabbypadBaseContent = content;
			updateTabbypadPillUI();
			await refreshTabbypadList(notepad.tabbypadSearchInput.val());

			Swal.fire({
				toast: true,
				position: 'bottom',
				icon: 'success',
				title: 'Tabbypad 原項目已成功更新！',
				showConfirmButton: false,
				timer: 2000
			});
		} catch (err) {
			console.error('Failed to update Tabbypad item:', err);
			Swal.fire({
				toast: true,
				position: 'bottom',
				icon: 'error',
				title: '更新失敗，原草稿已完整保留',
				showConfirmButton: false,
				timer: 3000
			});
		}
	}

	async function confirmAndLoadTabbypadNote(targetNote) {
		const currentVal = notepad.note.val();
		const hasDifferentContent = currentVal.trim() && currentVal !== targetNote.content;

		if (hasDifferentContent) {
			const result = await Swal.fire({
				icon: 'question',
				title: '更換編輯內容確認',
				text: '目前編輯區有未保存至該項目的內容。您希望另存新項目後載入，還是直接捨棄目前內容載入？',
				showCancelButton: true,
				confirmButtonText: '另存新項目後載入',
				cancelButtonText: '捨棄並載入'
			});

			if (result.value || result.isConfirmed) {
				await saveCurrentAsNewTabbypadItem();
			} else if (result.dismiss !== Swal.DismissReason.cancel) {
				return; // Closed by clicking backdrop / escape
			}
		}

		const newContent = targetNote.content || '';
		try {
			setState('note', newContent);
		} catch (err) {
			Swal.fire({
				type: 'error',
				icon: 'error',
				title: '載入失敗',
				text: '儲存空間不足或寫入失敗，未載入 Tabbypad 項目，原草稿已保留。'
			});
			return;
		}

		currentLinkedTabbypadId = targetNote.id;
		currentLinkedTabbypadBaseContent = newContent;
		notepad.note.val(newContent);
		notepad.note[0].dispatchEvent(new Event('input', { bubbles: true }));
		updateWordCountPill(newContent);
		updateTabbypadPillUI();
		if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function') {
			window.MarkdownPreview.disable({ contentChanged: true });
		}
		if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function') {
			window.HtmlPreview.disable({ contentChanged: true });
		}
		notepad.tabbypadModal.modal('hide');
		Swal.fire({
			toast: true,
			position: 'bottom',
			icon: 'success',
			title: '已載入 Tabbypad 項目至編輯區',
			showConfirmButton: false,
			timer: 2000
		});
	}

	// Event Listeners for Tabbypad
	notepad.openTabbypadModalBtn.on('click', function () {
		notepad.tabbypadSearchInput.val('');
		refreshTabbypadList('');
		updateTabbypadPillUI();
		notepad.tabbypadModal.modal('show');
	});

	notepad.tabbypadSaveNewBtn.on('click', async function () {
		await saveCurrentAsNewTabbypadItem();
	});

	notepad.tabbypadUpdateLinkedBtn.on('click', async function () {
		await updateLinkedTabbypadItem();
	});

	notepad.tabbypadPillUpdateBtn.on('click', async function () {
		await updateLinkedTabbypadItem();
	});

	notepad.tabbypadPillUnlinkBtn.on('click', function () {
		unlinkTabbypadNote(true);
	});

	notepad.tabbypadSearchInput.on('input', debounce(function () {
		refreshTabbypadList(this.value);
	}, 200));

	// Monitor editor input to update linked pill dirty status
	notepad.note.on('input', function () {
		if (currentLinkedTabbypadId) {
			updateTabbypadPillUI();
		}
	});

	// Local imports stay text-only, including HTML, SVG and executable source files.
	const localFileExtensions = new Set([
		'txt', 'html', 'md', 'js', 'php', 'py', 'css',
		'htm', 'markdown', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte',
		'scss', 'sass', 'less', 'svg', 'xml',
		'json', 'jsonc', 'jsonl', 'csv', 'tsv', 'log', 'sql',
		'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'rst', 'adoc',
		'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
		'rb', 'pl', 'lua', 'r', 'go', 'rs', 'c', 'h', 'cpp', 'hpp',
		'cs', 'java', 'kt', 'swift', 'dart'
	]);
	const localFileNames = new Set(['.env', '.gitignore', '.editorconfig', 'dockerfile', 'makefile']);
	let localFileImportBusy = false;

	notepad.openLocalFile.on('click', function () {
		if (!localFileImportBusy) notepad.localFileInput[0].click();
	});

	notepad.localFileInput.on('change', async function () {
		const file = this.files[0];
		this.value = ''; // Allow selecting the same file again, even after a failed read.
		if (!file || localFileImportBusy) return;

		localFileImportBusy = true;
		notepad.openLocalFile.prop('disabled', true).attr('aria-busy', 'true');
		let failureMessage = '無法讀取本機檔案，原草稿已保留。';
		try {
			const name = file.name.toLowerCase();
			const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
			if (!localFileExtensions.has(extension) && !localFileNames.has(name) && !/^\.env\..+$/.test(name)) {
				failureMessage = '不支援此檔案格式，請選擇支援的文字、程式碼或設定檔。';
				throw new Error('Unsupported local file');
			}
			if (file.size > 1024 * 1024) {
				failureMessage = '檔案超過 1 MiB（1,048,576 bytes），原草稿已保留。';
				throw new Error('Local file too large');
			}

			const bytes = await file.arrayBuffer();
			failureMessage = '檔案不是有效的 UTF-8，請先轉成 UTF-8 後再開啟。原草稿已保留。';
			// Match textarea's newline normalization before comparison and persistence.
			const imported = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
			// Capture the latest draft AFTER reading; do not overwrite input typed while reading.
			const draft = notepad.note.val();
			const linkedId = currentLinkedTabbypadId;
			const linkedBase = currentLinkedTabbypadBaseContent;
			const draftUnchanged = () => notepad.note.val() === draft
				&& currentLinkedTabbypadId === linkedId
				&& currentLinkedTabbypadBaseContent === linkedBase;

			let action = 'overwrite';
			if (draft !== '' && draft !== imported) {
				const result = await Swal.fire({
					customClass: { popup: 'local-file-dialog' },
					title: '載入本機檔案',
					text: `「${file.name}」將改變目前草稿。請選擇處理方式：`,
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
				// SweetAlert2 v9 returns value, not isConfirmed.
				if (result.dismiss || !result.value) return;
				action = result.value;
			}

			failureMessage = '草稿或 Tabbypad 連結已變更，已停止載入。請重新選檔；如已建立備份，該備份仍會保留。';
			if (!draftUnchanged()) throw new Error('Draft changed during import');

			if (action === 'backup') {
				failureMessage = 'Tabbypad 備份失敗，未載入檔案，原草稿已保留。';
				// Use the committed storage operation, without relinking or mutating the editor.
				await window.TabbypadStorage.createNote(draft);
				failureMessage = '備份期間草稿或 Tabbypad 連結已變更，已停止載入；已建立的備份仍會保留。';
				if (!draftUnchanged()) throw new Error('Draft changed during backup');
			}

			const content = action === 'append' ? draft + '\n\n' + imported : imported;
			failureMessage = '無法儲存新草稿，可能是本機儲存空間不足。未載入檔案，原草稿已保留。';
			// setItem is atomic on failure. Commit before changing the editor or its link.
			setState('note', content);
			notepad.note.val(content);
			notepad.note[0].dispatchEvent(new Event('input', { bubbles: true }));
			if (action !== 'append') unlinkTabbypadNote(false);
			updateTabbypadPillUI();
			updateWordCountPill(content);
			if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function') {
				window.MarkdownPreview.disable({ contentChanged: true });
			}
			if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function') {
				window.HtmlPreview.disable({ contentChanged: true });
			}
			if (window.SyntaxHighlighter && typeof window.SyntaxHighlighter.onFileImported === 'function') {
				window.SyntaxHighlighter.onFileImported(file.name);
			}
			notepad.note[0].focus();
			Swal.fire({
				toast: true,
				position: 'bottom',
				type: 'success',
				title: '已載入本機檔案並儲存草稿',
				showConfirmButton: false,
				timer: 2000
			});
		} catch (err) {
			await Swal.fire({
				customClass: { popup: 'local-file-dialog' },
				type: 'error',
				title: '未載入本機檔案',
				text: failureMessage,
				confirmButtonText: '確定'
			});
		} finally {
			localFileImportBusy = false;
			notepad.openLocalFile.prop('disabled', false).removeAttr('aria-busy');
		}
	});

	// ==================== Google Cloud Sync Initialization ====================
	if (typeof window.GoogleCloudSync !== 'undefined') {
		window.GoogleCloudSync.init();
	}
	// ==================== Cross-Window Match Receiver (AI-RegExr) ====================
	async function handleImportedMatches(matchesText) {
		// Preserve whitespace drafts and detect edits or relinking while confirmation is open.
		const draft = notepad.note.val();
		const linkedId = currentLinkedTabbypadId;
		const linkedBase = currentLinkedTabbypadBaseContent;
		const draftUnchanged = () => notepad.note.val() === draft
			&& currentLinkedTabbypadId === linkedId
			&& currentLinkedTabbypadBaseContent === linkedBase;
		let failureMessage = '草稿或 Tabbypad 連結已變更，已停止寫入；原草稿已保留。';
		try {
			let action = 'overwrite';
			if (draft !== '') {
				const result = await Swal.fire({
					customClass: { popup: 'local-file-dialog' },
					title: '接收正則比對資料',
					text: '主頁目前已有草稿，請選擇處理方式：',
					input: 'radio',
					inputOptions: {
						overwrite: '覆蓋目前內容',
						append: '附加於末尾',
						backup: '備份至 Tabbypad 後載入'
					},
					inputValue: 'append',
					showCancelButton: true,
					confirmButtonText: '確定寫入',
					cancelButtonText: '取消'
				});
				if (result.dismiss || !result.value) return;
				action = result.value;
			}
			if (!draftUnchanged()) throw new Error('Draft changed during import');
			if (action === 'backup') {
				failureMessage = 'Tabbypad 備份失敗，未載入匹配資料，原草稿已保留。';
				await window.TabbypadStorage.createNote(draft);
				failureMessage = '備份期間草稿或連結已變更，已停止寫入；已建立的備份仍保留。';
				if (!draftUnchanged()) throw new Error('Draft changed during backup');
			}
			const content = action === 'append' ? draft + '\n\n' + matchesText : matchesText;
			failureMessage = '無法儲存新草稿，可能是本機儲存空間不足。原草稿已保留。';
			// localStorage commits atomically before the visible editor or link changes.
			setState('note', content);
			notepad.note.val(content);
			notepad.note[0].dispatchEvent(new Event('input', { bubbles: true }));
			if (action !== 'append') unlinkTabbypadNote(false);
			updateTabbypadPillUI();
			updateWordCountPill(content);
			if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function') {
				window.MarkdownPreview.disable({ contentChanged: true });
			}
			if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function') {
				window.HtmlPreview.disable({ contentChanged: true });
			}
			notepad.note[0].focus();
			Swal.fire({
				toast: true,
				position: 'bottom',
				type: 'success',
				title: '已自 AI-RegExr 載入匹配資料',
				showConfirmButton: false,
				timer: 2500
			});
		} catch (error) {
			await Swal.fire({
				customClass: { popup: 'local-file-dialog' },
				type: 'error',
				title: '未載入匹配資料',
				text: failureMessage,
				confirmButtonText: '確定'
			});
		}
	}

	const regexrReceiverId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	let regexrImportBusy = false;
	async function receiveRegexrMessage(data, reply) {
		if (!data || typeof data.id !== 'string') return;
		if (data.type === 'REGEXR_PING') {
			reply({ type: 'REGEXR_READY', id: data.id, receiver: regexrReceiverId });
			return;
		}
		if (data.type !== 'REGEXR_SEND_MATCHES' || data.receiver !== regexrReceiverId
			|| typeof data.matches !== 'string'
			|| new TextEncoder().encode(data.matches).byteLength > 1024 * 1024) return;
		const busy = regexrImportBusy || localFileImportBusy;
		reply({ type: 'REGEXR_MATCHES_ACK', id: data.id, received: !busy });
		if (busy) return;
		regexrImportBusy = true;
		try { await handleImportedMatches(data.matches.replace(/\r\n?/g, '\n')); }
		finally { regexrImportBusy = false; }
	}

	if (typeof BroadcastChannel !== 'undefined') {
		try {
			const channel = new BroadcastChannel('notepad_bus');
			channel.onmessage = event => {
				void receiveRegexrMessage(event.data, message => channel.postMessage(message));
			};
		} catch (error) {
			console.warn('BroadcastChannel initialization error:', error);
		}
	}
	window.addEventListener('message', event => {
		if (event.origin !== location.origin || !event.source) return;
		void receiveRegexrMessage(event.data, message => {
			event.source.postMessage(message, event.origin);
		});
	});

	// ==================== PWA Installation Prompt ====================
	let deferredInstallPrompt = null;
	const installContainer = $('#installAppContainer');
	const installBtn = $('#installAppBtn');

	window.addEventListener('beforeinstallprompt', (e) => {
		// Prevent the mini-infobar from appearing on mobile
		e.preventDefault();
		// Stash the event so it can be triggered later.
		deferredInstallPrompt = e;
		// Update UI notify the user they can install the PWA
		if (installContainer.length) {
			installContainer.show();
		}
	});

	if (installBtn.length) {
		installBtn.on('click', async () => {
			if (!deferredInstallPrompt) {
				// If not supported or already installed, provide guidance
				if (typeof Swal !== 'undefined' && Swal.fire) {
					Swal.fire({
						title: '加到主畫面',
						text: '若使用 iOS/iPadOS，請點擊 Safari 的「分享」按鈕，再點「加入主畫面」。Android 亦可透過瀏覽器選單「安裝應用程式」。',
						type: 'info',
						confirmButtonText: '了解'
					});
				}
				return;
			}
			// Show the install prompt
			deferredInstallPrompt.prompt();
			// Wait for the user to respond to the prompt
			const { outcome } = await deferredInstallPrompt.userChoice;
			// Clear the deferredPrompt variable, since it can only be used once
			deferredInstallPrompt = null;
			if (outcome === 'accepted') {
				installContainer.hide();
			}
		});
	}

	window.addEventListener('appinstalled', () => {
		deferredInstallPrompt = null;
		if (installContainer.length) {
			installContainer.hide();
		}
		console.log('LazyDraft PWA was installed successfully');
	});
});

document.addEventListener("fullscreenchange", function () {
	if (!document.fullscreenElement) {
		$('#arrowPointsIn').hide();
		$('#arrowPointsOut').show();
	}
});

// Registering ServiceWorker
if (window.isSecureContext && 'serviceWorker' in navigator) {
	navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (registration) {
		console.log('ServiceWorker registration successful with scope: ', registration.scope);
	}).catch(function (err) {
		console.log('ServiceWorker registration failed: ', err);
	});
}

