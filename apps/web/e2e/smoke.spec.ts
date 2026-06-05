import { test, expect } from '@playwright/test';

// Phase 0 smoke test: confirms the app boots and renders. The full human-gate
// flow (sign in → review → edit → approve) is added in Phase 3.
test('home page renders the app name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Article Engine/i })).toBeVisible();
});
