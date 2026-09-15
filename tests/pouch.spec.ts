import { test, expect, type Page } from '@playwright/test';

test('a keepable card can be stashed and played in a later round', async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await a.newPage();
  const guest = await b.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  async function login(page: Page, name: string) {
    await page.goto('http://localhost:45102');
    await page.getByLabel('Tên người chơi', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Vào sảnh →', exact: true }).click();
    await expect(page.getByText('● Trực tuyến', { exact: true })).toBeVisible();
  }
  // Lá đang ở giữa băng chuyền lật ngay từ lần bấm đầu; lá ở rìa cần một lần bấm để cuốn vào
  // giữa trước. Bấm thêm sau khi popup đã mở sẽ bị chính popup chặn, nên phải kiểm tra trước.
  async function flip(page: Page, index: number) {
    const card = page.getByRole('button', { name: `Lá bài ${index}`, exact: true });
    const dialog = page.getByRole('dialog');
    await card.click();
    try {
      await expect(dialog).toBeVisible({ timeout: 3000 });
      return;
    } catch {
      // Lá nằm ở rìa: lần bấm vừa rồi chỉ cuốn nó vào giữa.
    }
    await card.click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
  }
  try {
    await login(host, 'Chủ Túi');
    await login(guest, 'Khách Túi');
    await host.getByRole('button', { name: '+ Tạo phòng mới', exact: true }).click();
    await host.getByLabel('Tên phòng', { exact: true }).fill('Phòng túi thần kỳ');
    await host.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill('pouch-1234');
    await host.getByRole('button', { name: 'Tạo phòng', exact: true }).click();
    const code = (await host.getByLabel(/^Mã phòng [A-F0-9]{6}$/).innerText())
      .replace('#', '')
      .trim();

    // Bộ bài rút gọn về đúng hai lá giữ được, để vòng nào cũng chắc chắn lật trúng.
    await host.getByRole('button', { name: /^Chỉnh bộ bài/ }).click();
    await host.getByRole('button', { name: '+ Thêm lá mới', exact: true }).click();
    await host.getByLabel('Tên lá bài', { exact: true }).fill('Lá để dành A');
    await host.getByRole('button', { name: 'Quyền lực', exact: true }).click();
    await host.getByLabel('Nội dung', { exact: true }).fill('Dùng bất cứ lúc nào bạn muốn.');
    await host.getByLabel('Hình phạt / kết quả', { exact: true }).fill('Không phạt gì cả.');
    await host.getByRole('button', { name: /Cất được vào túi thần kỳ · Tắt/ }).click();
    await host.getByRole('button', { name: 'Xong lá bài', exact: true }).click();
    await host.getByRole('button', { name: '+ Thêm lá mới', exact: true }).click();
    await host.getByLabel('Tên lá bài', { exact: true }).fill('Lá để dành B');
    await host.getByRole('button', { name: 'Quyền lực', exact: true }).click();
    await host.getByLabel('Nội dung', { exact: true }).fill('Cũng dùng được về sau.');
    await host.getByLabel('Hình phạt / kết quả', { exact: true }).fill('Không phạt gì cả.');
    await host.getByRole('button', { name: /Cất được vào túi thần kỳ · Tắt/ }).click();
    await host.getByRole('button', { name: 'Xong lá bài', exact: true }).click();
    for (let i = 0; i < 50; i++)
      await host.getByRole('button', { name: 'Xóa', exact: true }).first().click();
    await expect(host.getByText('Bộ bài · 2 lá', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Lưu bộ bài (2 lá)', exact: true }).click();

    await guest.getByRole('button', { name: 'Nhập mã phòng', exact: true }).click();
    await guest.getByLabel('Mã phòng (6 ký tự)', { exact: true }).fill(code);
    await guest.getByLabel('Mật khẩu phòng (ít nhất 4 ký tự)', { exact: true }).fill('pouch-1234');
    await guest.getByRole('button', { name: 'Tham gia phòng', exact: true }).click();
    await expect(host.getByText('🟢 Khách Túi', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Bắt đầu ván chơi', exact: true }).click();

    // Host cất lá vào túi: không bị phạt, túi lên 1 lá.
    await flip(host, 1);
    await expect(host.getByRole('button', { name: /Cất vào túi thần kỳ/ })).toBeVisible();
    await host.getByRole('button', { name: /Cất vào túi thần kỳ/ }).click();
    await expect(
      host.getByRole('button', { name: '🎒 Túi thần kỳ · 1 lá', exact: true }),
    ).toBeVisible();
    await expect(host.getByText('Đã cất vào túi thần kỳ · không bị phạt')).toBeVisible();
    await host.screenshot({ path: 'test-results/pouch-stashed.png' });

    // Guest xử lý lượt của mình để sang vòng 2.
    await flip(guest, 2);
    await guest.getByRole('button', { name: 'Đã hoàn thành thử thách', exact: true }).click();
    // Bộ bài rút gọn chỉ đủ một vòng, nên chủ phòng xáo lại để bước sang vòng 2.
    await expect(host.getByText('Không đủ bài cho vòng mới')).toBeVisible();
    await host.getByRole('button', { name: 'Xáo lại toàn bộ bài · tiếp tục', exact: true }).click();
    await expect(host.getByText(/^V2 · \d+ lá$/)).toBeVisible();

    // Vòng 2: host lấy lá trong túi ra dùng thay cho việc rút bài.
    await host.getByRole('button', { name: '🎒 Túi thần kỳ · 1 lá', exact: true }).click();
    await host.screenshot({ path: 'test-results/pouch-open.png' });
    await host.getByRole('button', { name: 'Dùng lá này', exact: true }).click();
    await expect(host.getByText('🎒 Lá lấy ra từ túi thần kỳ.')).toBeVisible();
    await expect(guest.getByText('Đang chờ Chủ Túi xác nhận kết quả…')).toBeVisible();
    await host.getByRole('button', { name: 'Đã hoàn thành thử thách', exact: true }).click();
    await expect(
      host.getByRole('button', { name: '🎒 Túi thần kỳ · 0 lá', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
