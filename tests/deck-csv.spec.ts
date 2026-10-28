import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test('export a deck, reject invalid CSV, import a corrected draft and save it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Tạo tài khoản mới' }).click();
  await page.getByLabel('Tên hiển thị').fill(`CSV ${Date.now()}`);
  await page.getByLabel('Mật khẩu đăng ký').fill('csv-test-password');
  await page.getByRole('button', { name: 'Tạo tài khoản và vào sảnh' }).click();
  await expect(page.getByText('● Trực tuyến')).toBeVisible();
  await page.getByRole('button', { name: 'Bộ bài của tôi' }).click();
  await page.getByLabel('Tên bộ bài mới').fill('Bộ thử CSV');
  await page.getByRole('button', { name: 'Sao chép bộ mặc định' }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa lá bài' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất bộ bài CSV' }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe('chamly-50-bo-bai.csv');
  const csv = await readFile(await exported.path(), 'utf8');
  expect(csv).toContain('"packId","id","title","category"');
  const invalid = csv.replace('"challenge"', '"quiz"');
  await upload(page, invalid);
  await expect(page.getByText(/Dòng 2: category không hợp lệ/)).toBeVisible();
  await expect(page.getByText('Đã nạp bản nháp từ CSV')).toHaveCount(0);

  const edited = csv.replace(/("card-1",)"[^"]*"/, '$1"Lá bài sửa nhanh bằng CSV"');
  expect(edited).not.toBe(csv);
  await upload(page, edited);
  await expect(page.getByText('Lá bài sửa nhanh bằng CSV')).toBeVisible();
  await expect(page.getByText(/Đã nạp bản nháp từ CSV/)).toBeVisible();
  await page.getByRole('button', { name: /Lưu bộ bài \(/ }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa lá bài' }).click();
  await expect(page.getByText('Lá bài sửa nhanh bằng CSV')).toBeVisible();
});

async function upload(page: Page, csv: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Nhập file CSV' }).click();
  await (
    await chooser
  ).setFiles({ name: 'deck.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
}
