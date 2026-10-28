import { expect, test } from '@playwright/test';

test('an expired or offline session can be cleared locally by logging out', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chamly.session.v1',
      JSON.stringify({
        token: 'a'.repeat(64),
        playerId: 'expired-session',
        name: 'Người chơi cũ',
        username: 'old-user',
      }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Hồ sơ' }).click();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('button', { name: 'Tạo tài khoản mới' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('chamly.session.v1')))
    .toBeNull();
});
