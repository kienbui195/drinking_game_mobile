import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function saveDeckCsv(name: string, contents: string): Promise<void> {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(contents);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Thiết bị không hỗ trợ chia sẻ file CSV.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Lưu bộ bài CSV' });
}

export async function pickDeckCsv(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset.name.toLowerCase().endsWith('.csv')) throw new Error('Vui lòng chọn file .csv.');
  if (asset.size && asset.size > 1_000_000) throw new Error('File CSV vượt quá 1 MB.');
  return new File(asset.uri).text();
}
