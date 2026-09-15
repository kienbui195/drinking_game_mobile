import { test, expect, type Page } from '@playwright/test';

// Mật khẩu quản trị không nằm trong mã nguồn: lấy từ môi trường, giống hệt cách server đọc nó.
// Chạy bộ test này bằng: ADMIN_PASSWORD=<mật khẩu của server dev> npx playwright test
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
test.skip(!ADMIN_PASSWORD, 'Cần đặt biến môi trường ADMIN_PASSWORD để chạy nhóm test quản trị.');

async function login(page: Page, name: string) {
  await page.goto('http://localhost:45102');
  await page.getByLabel('Tên người chơi', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Vào sảnh →', exact: true }).click();
  await expect(page.getByText('● Trực tuyến', { exact: true })).toBeVisible();
}
async function openCreate(page: Page, name: string, password: string) {
  await page.getByRole('button', { name: '+ Tạo phòng mới', exact: true }).click();
  await page.getByLabel('Tên phòng', { exact: true }).fill(name);
  await page.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Tạo phòng', exact: true }).click();
}

test('the admin gate needs the right password and no room is created', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    await login(page, 'Kẻ Thử');
    await openCreate(page, 'adminserverday', 'sai-mat-khau');
    await expect(page.getByText('Mật khẩu phòng chưa đúng.')).toBeVisible();
    // Không có phòng nào được tạo ra từ lần thử sai.
    await expect(page.getByLabel(/^Mã phòng/)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('admin dashboard lists rooms and can manage them', async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 560, height: 900 } });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await a.newPage();
  const player = await b.newPage();
  const errors: string[] = [];
  for (const page of [admin, player]) page.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(player, 'Người Chơi A');
    await openCreate(player, 'Phòng bị quản lý', 'player-1234');
    const code = (await player.getByLabel(/^Mã phòng [A-F0-9]{6}$/).innerText())
      .replace('#', '')
      .trim();

    await login(admin, 'Quản Trị');
    await openCreate(admin, 'adminserverday', ADMIN_PASSWORD);
    await expect(admin.getByText('🛠️ Bảng điều khiển')).toBeVisible();
    await expect(admin.getByText(`#${code}`, { exact: true })).toBeVisible();
    await admin.screenshot({ path: 'test-results/admin-dashboard.png', fullPage: true });

    // Thông báo của admin hiện ngay trên máy người chơi.
    await admin.getByLabel('Nội dung thông báo', { exact: true }).fill('Sắp bảo trì nhé!');
    await admin.getByRole('button', { name: 'Gửi thông báo', exact: true }).click();
    await expect(player.getByText('📢 Sắp bảo trì nhé!')).toBeVisible();

    // Đổi tên phòng có hiệu lực ngay với người đang ở trong phòng.
    await admin.getByRole('button', { name: `Quản lý phòng ${code}`, exact: true }).click();
    await admin.getByLabel(`Đổi tên phòng ${code}`, { exact: true }).fill('Tên do admin đặt');
    await admin.getByRole('button', { name: `Lưu tên phòng ${code}`, exact: true }).click();
    await expect(player.getByText(/Tên do admin đặt/)).toBeVisible();

    // Xóa phòng đẩy người chơi về sảnh.
    await admin.getByRole('button', { name: `Xóa phòng ${code}`, exact: true }).click();
    await expect(player.getByText('Phòng đã hết hạn.')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
