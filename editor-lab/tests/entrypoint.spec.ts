import { test, expect } from '@playwright/test';
import { ALL_EDITORS, waitForEditorReady } from './helpers.ts';

test('the static lab entry opens the comparison hub and each editor', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Lab base URL is required');
  const entry = new URL('../index.html', baseURL).href;
  await page.goto(entry);
  await expect(page).toHaveURL(new URL('./', baseURL).href, { timeout: 5000 });
  await waitForEditorReady(page);
  await expect(page.locator('body')).toHaveAttribute('data-editor', 'hub');
  for (const id of ALL_EDITORS) {
    await page.locator(`a[href="./${id}/index.html"]`).first().click();
    await waitForEditorReady(page, id);
    await expect(page.locator('body')).toHaveAttribute('data-editor', id);
    await page.goto(entry);
    await waitForEditorReady(page);
    await expect(page.locator('body')).toHaveAttribute('data-editor', 'hub');
  }
});
