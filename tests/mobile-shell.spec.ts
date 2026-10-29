import { test, expect, devices, type Page } from '@playwright/test';

// Trải nghiệm trên trình duyệt điện thoại (xem ~/Learning/MOBILE_WEB.md): document không bao giờ
// cuộn (nên không có pull-to-refresh / thanh địa chỉ nhảy), vuốt ngang thuộc về băng chuyền,
// và nút back không thoát khỏi app.
const phone = { ...devices['Pixel 7'] };

/** Vuốt bằng sự kiện touch thật của Chromium (CDP), giống ngón tay trên điện thoại. */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: point(from.x, from.y),
  });
  const steps = 12;
  for (let i = 1; i <= steps; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      ),
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const documentScroll = (page: Page) =>
  page.evaluate(() => ({
    top: document.scrollingElement!.scrollTop,
    left: document.scrollingElement!.scrollLeft,
  }));

async function register(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Tạo tài khoản mới', exact: true }).tap();
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(name);
  await page.getByLabel('Mật khẩu đăng ký', { exact: true }).fill('mobile-shell-password');
  await page.getByRole('button', { name: 'Tạo tài khoản và vào sảnh', exact: true }).tap();
  await expect(page.getByText('● Trực tuyến', { exact: true })).toBeVisible();
}

test('the app shell never scrolls the document and blocks pull-to-refresh', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  try {
    await page.goto('/');
    const shell = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const viewport = document.querySelector('meta[name=viewport]')!.getAttribute('content');
      return {
        htmlOverscroll: html.overscrollBehaviorY,
        bodyOverscroll: body.overscrollBehaviorY,
        bodyOverflow: body.overflow,
        touchAction: body.touchAction,
        viewport,
        manifest: !!document.querySelector('link[rel=manifest]'),
      };
    });
    expect(shell).toMatchObject({
      htmlOverscroll: 'none',
      bodyOverscroll: 'none',
      bodyOverflow: 'hidden',
      touchAction: 'manipulation',
      manifest: true,
    });
    expect(shell.viewport).toContain('viewport-fit=cover');
    // Kéo mạnh xuống từ đầu trang (động tác gây pull-to-refresh) rồi kéo lên: trang đứng yên.
    await swipe(page, { x: 200, y: 150 }, { x: 200, y: 700 });
    await swipe(page, { x: 200, y: 700 }, { x: 200, y: 100 });
    expect(await documentScroll(page)).toEqual({ top: 0, left: 0 });
    await expect(page.getByRole('button', { name: 'Tạo tài khoản mới' })).toBeVisible();
    // Ô nhập >= 16px để iOS không tự zoom khi focus.
    await page.getByRole('button', { name: 'Tạo tài khoản mới' }).tap();
    const fontSize = await page
      .getByLabel('Tên hiển thị', { exact: true })
      .evaluate((input) => parseFloat(getComputedStyle(input).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    // Back của Android đóng màn hình con thay vì rời khỏi app.
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Tạo tài khoản mới' })).toBeVisible();
    await page.goBack();
    await expect(page.getByText('Bấm back lần nữa để thoát Chạm Ly')).toBeVisible();
    await expect(page).toHaveURL(/localhost:45102/);
  } finally {
    await context.close();
  }
});

test('swiping the card carousel on a touch screen moves cards, not the page', async ({
  browser,
}) => {
  const a = await browser.newContext(phone);
  const b = await browser.newContext(phone);
  const host = await a.newPage();
  const guest = await b.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  try {
    await register(host, 'Chủ Vuốt');
    await register(guest, 'Khách Vuốt');
    await host.getByRole('button', { name: 'Tạo phòng mới', exact: true }).tap();
    await host.getByLabel('Tên phòng', { exact: true }).fill('Phòng vuốt chạm');
    await host.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill('swipe-123');
    await host.getByRole('button', { name: 'Tạo phòng', exact: true }).tap();
    const code = (await host.getByLabel(/^Mã phòng [A-F0-9]{6}$/).innerText())
      .replace('#', '')
      .trim();
    await guest.getByRole('button', { name: 'Nhập mã phòng', exact: true }).tap();
    await guest.getByLabel('Mã phòng (6 ký tự)', { exact: true }).fill(code);
    await guest.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill('swipe-123');
    await guest.getByRole('button', { name: 'Tham gia phòng', exact: true }).tap();
    await host.getByRole('button', { name: 'Bắt đầu ván chơi', exact: true }).tap();

    const first = host.getByRole('button', { name: 'Lá bài 1', exact: true });
    const second = host.getByRole('button', { name: 'Lá bài 2', exact: true });
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await host.waitForTimeout(400);
    await host.screenshot({ path: 'test-results/carousel-mobile.png' });
    const box = (await first.boundingBox())!;
    const y = box.y + box.height / 2;
    // Vuốt sang trái: lá 2 vào giữa, document không bị cuộn ngang/dọc.
    await swipe(host, { x: 320, y }, { x: 90, y });
    await expect(second).toHaveAttribute('aria-selected', 'true');
    expect(await documentScroll(host)).toEqual({ top: 0, left: 0 });
    // Vuốt dọc trên băng chuyền vẫn cuộn vùng nội dung, không đổi lá.
    await swipe(host, { x: 200, y }, { x: 200, y: y - 250 });
    await expect(second).toHaveAttribute('aria-selected', 'true');
    expect(await documentScroll(host)).toEqual({ top: 0, left: 0 });
    // Chạm lá ở giữa để lật: popup lá bài hiện ra.
    await second.scrollIntoViewIfNeeded();
    await second.tap();
    await expect(host.getByRole('dialog')).toBeVisible();
    await host.waitForTimeout(500);
    await host.screenshot({ path: 'test-results/card-modal-mobile.png' });
    // Back không đóng popup lá bài (kết quả phải được xác nhận) và không rời app.
    await host.goBack();
    await expect(host.getByRole('dialog')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
