import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import type { Reply, RoomView } from '@chamly/shared';

test('two independent browsers create, edit, join, play and resume', async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const b = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const host = await a.newPage();
  const guest = await b.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  async function login(page: Page, name: string) {
    await page.goto('http://localhost:45102');
    await page.getByRole('button', { name: 'Tạo tài khoản mới', exact: true }).click();
    await page.getByLabel('Tên hiển thị', { exact: true }).fill(name);
    await page.getByLabel('Mật khẩu đăng ký', { exact: true }).fill('ui-account-password');
    await page.getByRole('button', { name: 'Tạo tài khoản và vào sảnh', exact: true }).click();
    await expect(page.getByText('● Trực tuyến', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Bộ bài của tôi', exact: true }).click();
    // AC-03.2: thư viện trống hiển thị trạng thái trống thay vì danh sách rỗng im lặng.
    await expect(
      page.getByText('Chưa có bộ bài nào cho chủ đề này.', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Tên bộ bài mới', { exact: true }).fill(`Deck ${name}`);
    await page.getByRole('button', { name: 'Sao chép bộ mặc định', exact: true }).click();
    await expect(page.getByText(`Deck ${name}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Quay lại sảnh', exact: true }).click();
  }
  try {
    await host.goto('http://localhost:45102');
    await expect(host.getByText('Bắt đầu', { exact: true })).toBeVisible();
    await host.screenshot({ path: 'test-results/welcome-mobile.png', fullPage: true });
    await login(host, 'Host UI');
    await login(guest, 'Guest UI');
    const desktopShell = await guest.locator('#root').evaluate((root) => ({
      width: root.getBoundingClientRect().width,
      left: root.getBoundingClientRect().left,
      viewport: window.innerWidth,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }));
    expect(desktopShell.width).toBeLessThanOrEqual(430);
    expect(desktopShell.left).toBeCloseTo((desktopShell.viewport - desktopShell.width) / 2, 0);
    expect(desktopShell.bodyOverflow).toBe('hidden');
    await host.getByRole('button', { name: 'Tạo phòng mới', exact: true }).click();
    await host.getByLabel('Tên phòng', { exact: true }).fill('Phòng kiểm thử UI');
    await host.getByLabel('Bộ bài Deck Host UI', { exact: true }).click();
    await host.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill('ui-test-123');
    await host.getByRole('button', { name: 'Tạo phòng', exact: true }).click();
    const roomCode = host.getByLabel(/^Mã phòng [A-F0-9]{6}$/);
    await expect(roomCode).toBeVisible();
    const code = (await roomCode.innerText()).replace('#', '').trim();
    await host.getByRole('button', { name: 'Chỉnh bộ bài · 54 lá', exact: true }).click();
    await host.getByRole('button', { name: 'Sửa', exact: true }).first().click();
    await host.getByLabel('Tên lá bài', { exact: true }).fill('Lá bài đã sửa UI');
    await host.getByRole('button', { name: 'Xong lá bài', exact: true }).click();
    await host.getByRole('button', { name: '+ Thêm lá mới', exact: true }).click();
    await host.getByLabel('Tên lá bài', { exact: true }).fill('Lá thêm mới');
    await host.getByLabel('Nội dung', { exact: true }).fill('Kể một câu chuyện vui.');
    await host.getByLabel('Hình phạt / kết quả', { exact: true }).fill('Cả bàn vỗ tay.');
    await host.getByRole('button', { name: 'Xong lá bài', exact: true }).click();
    await expect(host.getByText('Bộ bài · 55 lá', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Xóa', exact: true }).last().click();
    await expect(host.getByText('Bộ bài · 54 lá', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Lưu bộ bài (54 lá)', exact: true }).click();
    await expect(host.getByText('Bộ bài · 54 lá', { exact: true })).not.toBeVisible();
    // Pin a small all-challenge room deck so the vote path is deterministic after shuffle.
    const storedSession = await host.evaluate(() => localStorage.getItem('chamly.session.v1'));
    const token = JSON.parse(storedSession!).token as string;
    const socket = io('http://localhost:45100', { auth: { token }, autoConnect: false });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
      });
      const rpc = <T>(event: string, body: unknown): Promise<T> =>
        new Promise((resolve, reject) =>
          socket.emit(event, body, (reply: Reply<T>) =>
            reply.ok ? resolve(reply.data) : reject(new Error(reply.message)),
          ),
        );
      const snapshot = await rpc<RoomView>('room:sync', { roomId: code });
      await rpc<RoomView>('room:command', {
        roomId: code,
        revision: snapshot.revision,
        requestId: randomUUID(),
        action: {
          type: 'saveDeck',
          cards: snapshot.deck.filter((card) => card.category === 'challenge').slice(0, 4),
        },
      });
    } finally {
      socket.disconnect();
    }
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
    await expect(
      guest.getByText('Vuốt để xem các lá. Chỉ người đang ở lượt mới lật được bài.'),
    ).toBeVisible();
    // Băng chuyền chỉ lật lá đang ở chính giữa; lá 1 là lá mặc định ở giữa khi vào vòng mới.
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
    await host.getByRole('button', { name: 'Nhờ cả bàn bình chọn kết quả' }).click();
    await expect(guest.getByRole('button', { name: 'Bình chọn · Đạt' })).toBeVisible();
    await guest.getByRole('button', { name: 'Bình chọn · Đạt' }).click();
    await expect(guest.getByText('Đến lượt bạn!')).toBeVisible();
    // Bấm lần đầu chỉ cuốn lá 2 vào giữa, bấm lần thứ hai mới lật.
    await guest.getByRole('button', { name: 'Lá bài 2', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Lá bài 2', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await guest.getByRole('button', { name: 'Lá bài 2', exact: true }).click();
    await guest.getByRole('button', { name: 'Đã hoàn thành thử thách', exact: true }).click();
    await expect(host.getByText(/^V2 · \d+ lá$/)).toBeVisible();
    await guest.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await expect(host.getByText('Hẹn ván tiếp theo ✨')).toBeVisible();
    await expect(host.getByText('✨ Tổng kết ván chơi')).toBeVisible();
    await expect(host.getByText(/Rút nhiều bài nhất:/)).toBeVisible();
    await expect(host.getByText(/cả bàn bình chọn 1 đạt/)).toBeVisible();
    await host.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
