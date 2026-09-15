import { test, expect, type Page } from '@playwright/test';

test('two independent browsers create, edit, join, play and resume', async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const b = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const host = await a.newPage();
  const guest = await b.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  async function login(page: Page, name: string) {
    await page.goto('http://localhost:8081');
    await page.getByLabel('Tên người chơi', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Vào sảnh →', exact: true }).click();
    await expect(page.getByText('● Trực tuyến', { exact: true })).toBeVisible();
  }
  try {
    await host.goto('http://localhost:8081');
    await expect(host.getByText('Bắt đầu với tên của bạn')).toBeVisible();
    await host.screenshot({ path: 'test-results/welcome-mobile.png', fullPage: true });
    await login(host, 'Host UI');
    await login(guest, 'Guest UI');
    await host.getByRole('button', { name: '+ Tạo phòng mới', exact: true }).click();
    await host.getByLabel('Tên phòng', { exact: true }).fill('Phòng kiểm thử UI');
    await host.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill('ui-test-123');
    await host.getByRole('button', { name: 'Tạo phòng', exact: true }).click();
    await expect(host.getByText(/PHÒNG #[A-F0-9]{6}/)).toBeVisible();
    const code = (await host.getByText(/PHÒNG #[A-F0-9]{6}/).innerText()).split('#')[1];
    await host.getByRole('button', { name: 'Chỉnh bộ bài · 50 lá', exact: true }).click();
    await host.getByRole('button', { name: 'Sửa', exact: true }).first().click();
    await host.getByLabel('Tên lá bài', { exact: true }).fill('Lá bài đã sửa UI');
    await host.getByRole('button', { name: 'Xong lá bài', exact: true }).click();
    await host.getByRole('button', { name: '+ Thêm lá mới', exact: true }).click();
    await host.getByLabel('Tên lá bài', { exact: true }).fill('Lá thêm mới');
    await host.getByLabel('Nội dung', { exact: true }).fill('Kể một câu chuyện vui.');
    await host.getByLabel('Hình phạt / kết quả', { exact: true }).fill('Cả bàn vỗ tay.');
    await host.getByRole('button', { name: 'Xong lá bài', exact: true }).click();
    await expect(host.getByText('Bộ bài · 51 lá', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Xóa', exact: true }).last().click();
    await expect(host.getByText('Bộ bài · 50 lá', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Lưu bộ bài (50 lá)', exact: true }).click();
    await expect(host.getByText('Bộ bài · 50 lá', { exact: true })).not.toBeVisible();
    await guest.getByRole('button', { name: 'Nhập mã phòng', exact: true }).click();
    await guest.getByLabel('Mã phòng (6 ký tự)', { exact: true }).fill(code);
    await guest
      .getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true })
      .fill('wrong-password');
    await guest.getByRole('button', { name: 'Tham gia phòng', exact: true }).click();
    await expect(guest.getByText('Mật khẩu phòng chưa đúng.')).toBeVisible();
    await guest.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill('ui-test-123');
    await guest.getByRole('button', { name: 'Tham gia phòng', exact: true }).click();
    await expect(host.getByText('🟢 Guest UI', { exact: true })).toBeVisible();
    await host.screenshot({ path: 'test-results/lobby-mobile.png', fullPage: true });
    await host.getByRole('button', { name: 'Bắt đầu ván chơi', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Lá bài 1', exact: true })).toBeDisabled();
    await host.getByRole('button', { name: 'Lá bài 1', exact: true }).click();
    await expect(
      host.getByRole('button', { name: 'Đã hoàn thành thử thách', exact: true }),
    ).toBeVisible();
    await expect(guest.getByText('Đang chờ Host UI xác nhận kết quả…')).toBeVisible();
    await host.screenshot({ path: 'test-results/game-mobile.png', fullPage: true });
    await guest.screenshot({ path: 'test-results/game-web.png', fullPage: true });
    await host.reload();
    await expect(
      host.getByRole('button', { name: 'Đã hoàn thành thử thách', exact: true }),
    ).toBeVisible();
    await host.getByRole('button', { name: 'Đã hoàn thành thử thách', exact: true }).click();
    await expect(guest.getByText('Đến lượt bạn rồi!')).toBeVisible();
    await guest.getByRole('button', { name: 'Lá bài 2', exact: true }).click();
    await guest.getByRole('button', { name: 'Đã hoàn thành thử thách', exact: true }).click();
    await expect(host.getByText(/VÒNG 2 ·/)).toBeVisible();
    await guest.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await expect(host.getByText('Hẹn ván tiếp theo ✨')).toBeVisible();
    await host.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
