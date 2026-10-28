import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categoryLabels, packById, type Card } from '@chamly/shared';
import { deckCsvTemplate, exportDeckCsv, importDeckCsv } from './deck-csv';
import { pickDeckCsv, saveDeckCsv } from './deck-file';
import { Button, Copy, Field, Heading, Panel } from './ui';

const newId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (part) => {
    const value = Math.floor(Math.random() * 16);
    return (part === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });

export function DeckEditor({
  cards,
  editable,
  packId,
  onClose,
  onSave,
  description,
}: {
  cards: Card[];
  editable: boolean;
  packId: string;
  onClose: () => void;
  onSave: (cards: Card[]) => Promise<boolean>;
  description?: string;
}) {
  const pack = packById(packId);
  const [draft, setDraft] = useState(() => cards.map((c) => ({ ...c })));
  const [editing, setEditing] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(false);
  async function exportCsv(template = false) {
    try {
      await saveDeckCsv(
        `${packId}-${template ? 'mau' : 'bo-bai'}.csv`,
        template ? deckCsvTemplate() : exportDeckCsv(packId, draft),
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xuất được file CSV.');
    }
  }
  async function importCsv() {
    setError('');
    try {
      const csv = await pickDeckCsv();
      if (csv === null) return;
      const next = importDeckCsv(csv, packId);
      setDraft(next);
      setImported(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đọc được file CSV.');
    }
  }
  function add() {
    setEditing({
      id: newId(),
      title: '',
      category: pack.categories[0],
      description: '',
      penalty: '',
      drinksCount: 1,
    });
  }
  function update() {
    if (!editing) return;
    if (!editing.title.trim() || !editing.description.trim() || !editing.penalty.trim()) {
      setError('Điền đủ tên, nội dung và hình phạt.');
      return;
    }
    if (
      !Number.isInteger(editing.drinksCount) ||
      editing.drinksCount < 0 ||
      editing.drinksCount > 20 ||
      (editing.hasTimer &&
        (!Number.isInteger(editing.timerSeconds) ||
          !editing.timerSeconds ||
          editing.timerSeconds > 600))
    ) {
      setError(`Số ${pack.unitLabel}: 0–20. Đồng hồ: 1–600 giây.`);
      return;
    }
    const card = {
      ...editing,
      title: editing.title.trim(),
      description: editing.description.trim(),
      penalty: editing.penalty.trim(),
    };
    setDraft((old) =>
      old.some((c) => c.id === card.id)
        ? old.map((c) => (c.id === card.id ? card : c))
        : [...old, card],
    );
    setEditing(null);
    setError('');
  }
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-night">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Cột giữa cố định chiều cao: header và footer bám hai đầu, chỉ khối giữa cuộn. */}
          <View className="flex-1 w-full self-center" style={{ maxWidth: 430 }}>
            <View className="border-b border-slate-700 px-4 pb-3 pt-2 gap-2">
              <Heading>{editing ? 'Biên tập lá bài' : `Bộ bài · ${draft.length} lá`}</Heading>
              <Copy>
                {editing
                  ? 'Điền nội dung lá bài rồi bấm Xong lá bài để đưa vào bản nháp.'
                  : editable
                    ? (description ??
                      'Bản sao riêng của phòng. Thay đổi chỉ có hiệu lực sau khi lưu bộ bài.')
                    : 'Nội dung bộ bài của phòng. Thứ tự bài úp được giữ kín trên server.'}
              </Copy>
              {!!error && <Text className="text-rose-300">{error}</Text>}
              {imported && !editing && (
                <Text className="text-emerald-300 text-sm">
                  Đã nạp bản nháp từ CSV. Bấm “Lưu bộ bài” để áp dụng lên server.
                </Text>
              )}
              {editable && !editing && (
                <Button title="+ Thêm lá mới" onPress={add} disabled={draft.length >= 200} />
              )}
            </View>

            <ScrollView
              className="flex-1"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              {editing ? (
                <Panel>
                  <Field
                    label="Tên lá bài"
                    maxLength={100}
                    value={editing.title}
                    onChangeText={(title) => setEditing({ ...editing, title })}
                  />
                  {/* Xuống dòng thay vì cuộn ngang: chuột trên web không kéo được ScrollView. */}
                  <View className="flex-row flex-wrap gap-2">
                    {pack.categories.map((category) => (
                      <Button
                        key={category}
                        title={categoryLabels[category]}
                        secondary={editing.category !== category}
                        onPress={() => setEditing({ ...editing, category })}
                      />
                    ))}
                  </View>
                  <Field
                    label="Nội dung"
                    multiline
                    maxLength={1500}
                    value={editing.description}
                    onChangeText={(description) => setEditing({ ...editing, description })}
                  />
                  <Button
                    title={
                      editing.keepable
                        ? '🎒 Cất được vào túi thần kỳ · Bật'
                        : '🎒 Cất được vào túi thần kỳ · Tắt'
                    }
                    secondary={!editing.keepable}
                    onPress={() =>
                      setEditing({ ...editing, keepable: editing.keepable ? undefined : true })
                    }
                  />
                  <Field
                    label="Đáp án tham chiếu (có thể bỏ trống)"
                    multiline
                    maxLength={500}
                    value={editing.answer ?? ''}
                    onChangeText={(answer) =>
                      setEditing({ ...editing, answer: answer || undefined })
                    }
                  />
                  <Field
                    label="Hình phạt / kết quả"
                    multiline
                    maxLength={500}
                    value={editing.penalty}
                    onChangeText={(penalty) => setEditing({ ...editing, penalty })}
                  />
                  <Field
                    label={`Số ${pack.unitLabel} mặc định (0–20)`}
                    keyboardType="number-pad"
                    value={String(editing.drinksCount)}
                    onChangeText={(v) => setEditing({ ...editing, drinksCount: Number(v) })}
                  />
                  <Field
                    label="Đồng hồ (giây, 0 = không dùng)"
                    keyboardType="number-pad"
                    value={String(editing.timerSeconds ?? 0)}
                    onChangeText={(v) =>
                      setEditing({
                        ...editing,
                        hasTimer: Number(v) > 0,
                        timerSeconds: Number(v) || undefined,
                      })
                    }
                  />
                </Panel>
              ) : (
                <>
                  <Panel>
                    <Heading>Chỉnh sửa hàng loạt bằng CSV</Heading>
                    <Copy>
                      Xuất bộ hiện tại rồi mở bằng Excel/Google Sheets. Giữ nguyên dòng header và
                      packId; để trống id cho lá mới. CSV phải có 2–200 lá, category đúng chủ đề,
                      drinksCount 0–20, hasTimer/keepable là true/false; timerSeconds 1–600 nếu
                      hasTimer=true. Tải về dưới dạng CSV UTF-8, dấu phẩy phân cách cột.
                    </Copy>
                    <Button title="Xuất bộ bài CSV" secondary onPress={() => void exportCsv()} />
                    {editable && (
                      <>
                        <Button
                          title="Tải mẫu CSV"
                          secondary
                          onPress={() => void exportCsv(true)}
                        />
                        <Button title="Nhập file CSV" secondary onPress={() => void importCsv()} />
                        <Copy>
                          Import thay toàn bộ bản nháp, không ghi ngay lên server. File sai sẽ không
                          làm mất bản nháp hiện tại.
                        </Copy>
                      </>
                    )}
                  </Panel>
                  {draft.map((card, index) => (
                    <Panel key={card.id}>
                      <Text className="text-violet-300 text-xs font-bold">
                        {index + 1} · {categoryLabels[card.category]}
                      </Text>
                      <Heading>{card.title}</Heading>
                      <Copy>{card.description}</Copy>
                      <Text className="text-amber-200">{card.penalty}</Text>
                      {card.keepable && (
                        <Text className="text-emerald-300 text-xs font-bold">
                          🎒 Cất được vào túi thần kỳ
                        </Text>
                      )}
                      {editable && (
                        <View className="flex-row gap-3">
                          <Button title="Sửa" secondary onPress={() => setEditing({ ...card })} />
                          <Button
                            title="Xóa"
                            danger
                            onPress={() => setDraft((old) => old.filter((c) => c.id !== card.id))}
                          />
                        </View>
                      )}
                    </Panel>
                  ))}
                </>
              )}
            </ScrollView>

            <View className="border-t border-slate-700 bg-night px-4 pb-2 pt-3 gap-3">
              {editing ? (
                <>
                  <Button title="Xong lá bài" onPress={update} />
                  <Button
                    title="Hủy sửa lá"
                    secondary
                    onPress={() => {
                      setEditing(null);
                      setError('');
                    }}
                  />
                </>
              ) : (
                <>
                  {editable && (
                    <Button
                      title={`Lưu bộ bài (${draft.length} lá)`}
                      busy={busy}
                      disabled={draft.length < 2}
                      onPress={async () => {
                        setBusy(true);
                        try {
                          if (await onSave(draft)) onClose();
                          else setError('Chưa lưu được. Đóng bộ bài để xem thông báo và thử lại.');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Không lưu được bộ bài.');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                  <Button title="Đóng bộ bài" secondary onPress={onClose} disabled={busy} />
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
