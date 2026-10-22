import { test, expect } from '@playwright/test';

const isMac = process.platform === 'darwin';
const toggleShortcut = isMac ? 'Meta+b' : 'Control+b';

/**
 * Helper to trigger the Control+Alt / Control+Option mode toggle chord.
 * Toggles when the first key of the chord is released.
 *
 * @param {import('@playwright/test').Page} target
 * @param {'ControlFirst' | 'AltFirst'} [order='ControlFirst']
 */
async function toggleModeChord(target, order = 'ControlFirst') {
  if (order === 'ControlFirst') {
    await target.keyboard.down('Control');
    await target.keyboard.down('Alt');
    await target.keyboard.up('Alt');
    await target.keyboard.up('Control');
  } else {
    await target.keyboard.down('Alt');
    await target.keyboard.down('Control');
    await target.keyboard.up('Control');
    await target.keyboard.up('Alt');
  }
}

async function setPreferencesVisible(page, visible) {
  // Bootstrap restores trigger focus after backdrop transitions, not when display first becomes none.
  await Promise.all([
    page.evaluate(visible => new Promise(resolve => {
      window.jQuery('#preferencesModal').one(visible ? 'shown.bs.modal' : 'hidden.bs.modal', () => resolve());
    }), visible),
    visible ? page.locator('a#preferences').click() : page.keyboard.press('Escape'),
  ]);
}

test.describe('Boshiamy IME Input Modes and Chord Switching', () => {
  test('lowercase radical composition vs uppercase passthrough cancels pending buffer without implicit commit', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    const note = page.locator('#note');
    await note.fill('');
    await note.focus();

    // 1. Lowercase radical composition displays candidate bar with roots and candidates
    await page.keyboard.type('a');
    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();
    await expect(page.locator('#boshiamyBuffer')).toHaveText(/^[aA]$/);

    // 2. Uppercase letter cancels pending composition immediately without committing candidate or raw roots
    await page.keyboard.type('B');
    await expect(candidateBar).toBeHidden();
    // Verify neither candidate ('對') nor root radical ('a') was committed into note value
    await expect(note).toHaveValue('B');

    // 3. Mode remains Chinese: subsequent lowercase typing still composes normally
    await page.keyboard.type('a');
    await expect(candidateBar).toBeVisible();
    await page.keyboard.press('Space');
    await expect(candidateBar).toBeHidden();
    await expect(note).toHaveValue('B對');

    // 4. Symbol radical composition followed by uppercase cancels as well
    await page.keyboard.type(',');
    await expect(candidateBar).toBeVisible();
    await page.keyboard.type('C');
    await expect(candidateBar).toBeHidden();
    await expect(note).toHaveValue('B對C');
  });

  test('Ctrl+Alt chord toggles mode once on release, supports both press orders, and enforces strict exclusions', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    const note = page.locator('#note');
    await note.fill('');
    await note.focus();
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeVisible();

    // --- Order 1: Control down -> Alt down -> release Alt ---
    await page.keyboard.down('Control');
    await page.keyboard.down('Alt');
    // Keydown must never trigger mode switch
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // Releasing first key toggles mode to English
    await page.keyboard.up('Alt');
    await expect(toggle).toHaveAttribute('title', /英文直輸/);
    await expect(page.locator('#boshiamyBar')).toBeHidden();
    await expect(note).toHaveValue('');

    // Releasing remaining key must not toggle again
    await page.keyboard.up('Control');
    await expect(toggle).toHaveAttribute('title', /英文直輸/);

    // --- Order 2: Alt down -> Control down -> release Control ---
    await page.keyboard.down('Alt');
    await page.keyboard.down('Control');
    // Keydown must never trigger mode switch
    await expect(toggle).toHaveAttribute('title', /英文直輸/);

    // Releasing first key toggles mode back to Chinese
    await page.keyboard.up('Control');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // Releasing remaining key must not toggle again
    await page.keyboard.up('Alt');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // --- Exclusion 1: Third key (Shift) invalidates chord without toggling ---
    await page.keyboard.down('Control');
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.keyboard.up('Control');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // --- Exclusion 2: Simulated AltGr signature must not toggle ---
    await note.evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'AltGraph',
        code: 'AltRight',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }));
      el.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'AltGraph',
        code: 'AltRight',
        ctrlKey: false,
        altKey: false,
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // --- Exclusion 3: Focus loss / blur during chord invalidates toggle ---
    await page.keyboard.down('Control');
    await page.keyboard.down('Alt');
    await note.blur();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Control');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // --- Exclusion 4: Chord initiated outside focused textarea must not toggle ---
    await note.blur();
    await page.keyboard.down('Control');
    await note.focus();
    await page.keyboard.down('Alt');
    await page.keyboard.up('Alt');
    await page.keyboard.up('Control');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // --- Exclusion 5: ReadOnly textarea must not toggle mode ---
    await note.evaluate((el) => { el.readOnly = true; });
    await note.focus();
    await page.keyboard.down('Control');
    await page.keyboard.down('Alt');
    await page.keyboard.up('Alt');
    await page.keyboard.up('Control');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);
    await note.evaluate((el) => { el.readOnly = false; });
  });

  test('English mode allows native typing with punctuation and restores editable spellcheck and autocorrect', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenSpellCheck', 'Yes'));
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    const note = page.locator('#note');
    const spellcheckCheckbox = page.locator('#spellCheck');
    const spellcheckNotice = page.locator('#spellCheckImeNotice');

    // 1. Enable IME: Chinese mode pauses spellcheck and autocorrect
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);
    await expect(note).toHaveAttribute('spellcheck', 'false');
    await expect(note).toHaveAttribute('autocorrect', 'off');
    await expect(spellcheckCheckbox).toBeDisabled();
    await expect(spellcheckCheckbox).not.toBeChecked();
    await setPreferencesVisible(page, true);
    await expect(spellcheckNotice).toBeVisible();
    await setPreferencesVisible(page, false);

    // 2. Toggle to English mode: restores saved spellcheck preference and turns autocorrect on
    await note.focus();
    await toggleModeChord(page);
    await expect(toggle).toHaveAttribute('title', /英文直輸/);
    await expect(note).toHaveAttribute('spellcheck', 'true');
    await expect(note).toHaveAttribute('autocorrect', 'on');
    await expect(note).toHaveAttribute('lang', 'en');
    await expect(spellcheckCheckbox).toBeEnabled();
    await expect(spellcheckCheckbox).toBeChecked();

    // 3. Typing in English mode: lowercases and punctuation pass through natively without candidate bar
    await note.fill('');
    await note.focus();
    await page.keyboard.type("hello, world! [test] 'quote'");
    await expect(page.locator('#boshiamyBar')).toBeHidden();
    await expect(note).toHaveValue("hello, world! [test] 'quote'");

    // 4. User can modify spellcheck setting while in English mode
    await setPreferencesVisible(page, true);
    await expect(spellcheckNotice).toBeHidden();
    await page.locator('#spellCheck + span').click();
    await expect(spellcheckCheckbox).not.toBeChecked();
    await expect(note).toHaveAttribute('spellcheck', 'false');
    expect(await page.evaluate(() => localStorage.getItem('userChosenSpellCheck'))).toBe('No');
    await setPreferencesVisible(page, false);

    // 5. Toggle back to Chinese locks spellcheck off again
    await note.focus();
    await toggleModeChord(page);
    await expect(toggle).toHaveAttribute('title', /中文輸入/);
    await expect(note).toHaveAttribute('spellcheck', 'false');
    await expect(note).toHaveAttribute('autocorrect', 'off');
    await expect(spellcheckCheckbox).toBeDisabled();
    await setPreferencesVisible(page, true);
    await expect(spellcheckNotice).toBeVisible();
    await setPreferencesVisible(page, false);
    await note.focus();

    // 6. Returning to English restores the newly modified preference ('No')
    await toggleModeChord(page);
    await expect(toggle).toHaveAttribute('title', /英文直輸/);
    await expect(spellcheckCheckbox).toBeEnabled();
    await expect(spellcheckCheckbox).not.toBeChecked();
    await expect(note).toHaveAttribute('spellcheck', 'false');
    await expect(note).toHaveAttribute('autocorrect', 'on');
  });

  test('per-enable and page reload reset input mode to Chinese without persisting English', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenBoshiamy', 'Yes'));
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    const note = page.locator('#note');

    // On startup with saved preference, IME starts in Chinese mode
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // Switch to English mode
    await note.focus();
    await toggleModeChord(page);
    await expect(toggle).toHaveAttribute('title', /英文直輸/);

    // Disable IME overall
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Re-enable IME: must reset to Chinese mode
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // Switch to English mode again
    await note.focus();
    await toggleModeChord(page);
    await expect(toggle).toHaveAttribute('title', /英文直輸/);

    // Reload page: restored IME must always reset to Chinese mode
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const reloadedToggle = page.locator('#boshiamyToggle');
    await expect(reloadedToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(reloadedToggle).toHaveAttribute('title', /中文輸入/);

    // Verify typing enters Chinese composition
    const reloadedNote = page.locator('#note');
    await reloadedNote.fill('');
    await reloadedNote.focus();
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#boshiamyBar')).toBeHidden();
  });

  test('pending dictionary completion preserves chosen English mode', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenSpellCheck', 'Yes'));

    // Intercept dictionary request to simulate network latency
    let fulfillDict;
    const dictPromise = new Promise((resolve) => {
      fulfillDict = resolve;
    });

    await page.route('**/boshiamy-dict.json', async (route) => {
      await dictPromise;
      await route.continue();
    });

    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    const note = page.locator('#note');
    await note.focus();

    // Trigger enable while dictionary fetch is intercepted
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-busy', 'true');
    await expect(toggle).toHaveAttribute('title', /載入中（中文輸入）/);

    // While dictionary is still loading, user switches mode chord to English
    await note.focus();
    await toggleModeChord(page);
    await expect(toggle).toHaveAttribute('title', /載入中（英文直輸）/);
    await expect(note).toHaveAttribute('spellcheck', 'true');
    await expect(note).toHaveAttribute('autocorrect', 'on');

    // Release dictionary response and wait for loading to settle
    fulfillDict();
    await expect(toggle).toHaveAttribute('aria-busy', 'false');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', /嘸蝦米：英文直輸/);

    // Verify English mode was preserved upon completion: typing is native
    await note.fill('');
    await note.focus();
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeHidden();
    await expect(note).toHaveValue('a');
  });

  test('floating Picture-in-Picture window supports mode switching and resumes seamlessly in main tab', async ({ page, context }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenSpellCheck', 'Yes'));
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    const note = page.locator('#note');
    await note.fill('');
    await note.focus();

    // Enable IME in main window (starts in Chinese mode)
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('title', /中文輸入/);

    // Open floating Picture-in-Picture editor
    const windowReady = context.waitForEvent('page');
    await page.locator('#pip').click();
    const floating = await windowReady;
    const floatingNote = floating.locator('#note');
    await floatingNote.focus();

    // 1. In floating window: switch to English mode via chord
    await toggleModeChord(floating);
    await expect(floating.locator('#toast')).toContainText('英文直輸');
    await expect(floatingNote).toHaveAttribute('spellcheck', 'true');
    await expect(floatingNote).toHaveAttribute('autocorrect', 'on');

    // Type native English text
    await floating.keyboard.type('pip');
    await expect(floating.locator('#boshiamyBar')).toBeHidden();
    await expect(floatingNote).toHaveValue('pip');

    // 2. Switch back to Chinese mode in floating window
    await toggleModeChord(floating);
    await expect(floating.locator('#toast')).toContainText('中文輸入');
    await expect(floatingNote).toHaveAttribute('spellcheck', 'false');
    await expect(floatingNote).toHaveAttribute('autocorrect', 'off');

    // Type Chinese composition in floating window
    await floating.keyboard.type('a');
    await expect(floating.locator('#boshiamyBar')).toBeVisible();
    await floating.keyboard.press('Space');
    await expect(floating.locator('#boshiamyBar')).toBeHidden();
    await expect(floatingNote).toHaveValue('pip對');

    // 3. Close floating window: document adoption back into main tab
    await floating.close();

    // In main window, value is preserved and Chinese mode continues
    await expect(note).toHaveValue('pip對');
    await expect(note).toHaveAttribute('spellcheck', 'false');
    await note.focus();
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(note).toHaveValue('pip對對');

    // Switch to English in main tab via chord
    await toggleModeChord(page);
    await expect(toggle).toHaveAttribute('title', /英文直輸/);
    await page.keyboard.type(' ok');
    await expect(page.locator('#boshiamyBar')).toBeHidden();
    await expect(note).toHaveValue('pip對對 ok');
  });
});
