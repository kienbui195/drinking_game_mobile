import { test, expect, type Page } from '@playwright/test';

// Tài khoản quản trị giữ nguyên như trước, nhưng đăng nhập qua form đăng nhập
// bằng nút "Đăng nhập quản trị" thay vì cổng tên phòng trong form tạo phòng.
// Chạy bộ test này bằng: ADMIN_PASSWORD=<mật khẩu của server dev> npx playwright test
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME ?? process.env.ADMIN_ROOM_NAME ?? 'adminserverday';
test.skip(!ADMIN_PASSWORD, 'Cần đặt biến môi trường ADMIN_PASSWORD để chạy nhóm test quản trị.');

async function login(page: Page, name: string) {
  await page.goto('http://localhost:45102');
  await page.getByRole('button', { name: 'Tạo tài khoản mới', exact: true }).click();
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(name);
  await page.getByLabel('Mật khẩu đăng ký', { exact: true }).fill('admin-spec-password');
  await page.getByRole('button', { name: 'Tạo tài khoản và vào sảnh', exact: true }).click();
  await expect(page.getByText('● Trực tuyến', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bộ bài của tôi', exact: true }).click();
  await page.getByLabel('Tên bộ bài mới', { exact: true }).fill(`Deck ${name}`);
  await page.getByRole('button', { name: 'Sao chép bộ mặc định', exact: true }).click();
  await expect(page.getByText(`Deck ${name}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại sảnh', exact: true }).click();
}
async function openCreate(page: Page, deckOwnerName: string, roomName: string, password: string) {
  await page.getByRole('button', { name: 'Tạo phòng mới', exact: true }).click();
  await page.getByLabel('Tên phòng', { exact: true }).fill(roomName);
  await page.getByLabel(`Bộ bài Deck ${deckOwnerName}`, { exact: true }).click();
  await page.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Tạo phòng', exact: true }).click();
}
async function adminLogin(page: Page, password: string) {
  await page.goto('http://localhost:45102');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(ADMIN_USERNAME);
  await page.getByLabel('Mật khẩu đăng nhập', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập vào sảnh', exact: true }).click();
}

test('the admin login needs the right password and no dashboard is shown', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    await adminLogin(page, 'sai-mat-khau');
    await expect(page.getByText('Username hoặc mật khẩu không đúng.')).toBeVisible();
    // Không vào được bảng điều khiển khi sai mật khẩu.
    await expect(page.getByText('🛠️ Bảng điều khiển')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('creating a room named like the admin account is just a normal room', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    await login(page, 'Người Thường');
    // Không còn cổng quản trị trong form tạo phòng: tên trùng account admin vẫn tạo phòng chơi.
    await openCreate(page, 'Người Thường', ADMIN_USERNAME, 'phong-1234');
    await expect(page.getByText('🛠️ Bảng điều khiển')).toHaveCount(0);
    await expect(page.getByLabel(/^Mã phòng [A-F0-9]{6}$/)).toBeVisible();
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
    await openCreate(player, 'Người Chơi A', 'Phòng bị quản lý', 'player-1234');
    const code = (await player.getByLabel(/^Mã phòng [A-F0-9]{6}$/).innerText())
      .replace('#', '')
      .trim();

    await adminLogin(admin, ADMIN_PASSWORD);
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

test('admin can open the system deck editor and a new user can create from the default deck', async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const admin = await a.newPage();
  const player = await b.newPage();
  try {
    await adminLogin(admin, ADMIN_PASSWORD);
    await expect(admin.getByText('🛠️ Bảng điều khiển')).toBeVisible();
    await admin.getByRole('button', { name: 'Sửa bộ mặc định · 🧠 Hỏi Đáp Kiến Thức' }).click();
    await expect(
      admin.getByText(
        'Bộ gốc của hệ thống. Chỉ phòng và bản sao tạo sau khi lưu mới nhận thay đổi.',
      ),
    ).toBeVisible();
    await expect(admin.getByRole('button', { name: '+ Thêm lá mới' })).toBeVisible();
    await admin.getByRole('button', { name: 'Đóng bộ bài' }).click();

    await player.goto('http://localhost:45102');
    await player.getByRole('button', { name: 'Tạo tài khoản mới', exact: true }).click();
    await player.getByLabel('Tên hiển thị', { exact: true }).fill(`Bộ Gốc ${Date.now()}`);
    await player.getByLabel('Mật khẩu đăng ký', { exact: true }).fill('admin-spec-password');
    await player.getByRole('button', { name: 'Tạo tài khoản và vào sảnh', exact: true }).click();
    await expect(player.getByText('● Trực tuyến', { exact: true })).toBeVisible();
    await player.getByRole('button', { name: 'Tạo phòng mới', exact: true }).click();
    await expect(player.getByLabel('Bộ mặc định của hệ thống')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await player.getByLabel('Tên phòng', { exact: true }).fill('Phòng dùng bộ gốc');
    await player
      .getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true })
      .fill('default-deck-test');
    await player.getByRole('button', { name: 'Tạo phòng', exact: true }).click();
    await expect(player.getByLabel(/^Mã phòng [A-F0-9]{6}$/)).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});
