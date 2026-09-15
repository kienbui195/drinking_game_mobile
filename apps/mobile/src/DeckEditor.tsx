import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { categories, categoryLabels, type Card } from '@chamly/shared';
import { Button, Copy, Field, Heading, Panel } from './ui';

export function DeckEditor({
  cards,
  editable,
  onClose,
  onSave,
}: {
  cards: Card[];
  editable: boolean;
  onClose: () => void;
  onSave: (cards: Card[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => cards.map((c) => ({ ...c })));
  const [editing, setEditing] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function add() {
    setEditing({
      id: Crypto.randomUUID(),
      title: '',
      category: 'challenge',
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
      setError('Số ngụm: 0–20. Đồng hồ: 1–600 giây.');
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
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <Heading>{editing ? 'Biên tập lá bài' : `Bộ bài · ${draft.length} lá`}</Heading>
          <Copy>
            {editable
              ? 'Bản sao riêng của phòng. Thay đổi chỉ có hiệu lực sau khi lưu bộ bài.'
              : 'Nội dung bộ bài của phòng. Thứ tự bài úp được giữ kín trên server.'}
          </Copy>
          {!!error && <Text className="text-rose-300">{error}</Text>}
          {editing ? (
            <Panel>
              <Field
                label="Tên lá bài"
                maxLength={100}
                value={editing.title}
                onChangeText={(title) => setEditing({ ...editing, title })}
              />
              <View className="flex-row flex-wrap gap-2">
                {categories.map((category) => (
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
              <Field
                label="Hình phạt / kết quả"
                multiline
                maxLength={500}
                value={editing.penalty}
                onChangeText={(penalty) => setEditing({ ...editing, penalty })}
              />
              <Field
                label="Số ngụm mặc định (0–20)"
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
              <Button title="Xong lá bài" onPress={update} />
              <Button
                title="Hủy sửa lá"
                secondary
                onPress={() => {
                  setEditing(null);
                  setError('');
                }}
              />
            </Panel>
          ) : (
            <>
              {editable && (
                <Button title="+ Thêm lá mới" onPress={add} disabled={draft.length >= 200} />
              )}
              {draft.map((card, index) => (
                <Panel key={card.id}>
                  <Text className="text-violet-300 text-xs font-bold">
                    {index + 1} · {categoryLabels[card.category]}
                  </Text>
                  <Heading>{card.title}</Heading>
                  <Copy>{card.description}</Copy>
                  <Text className="text-amber-200">{card.penalty}</Text>
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
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </>
          )}
          <Button title="Đóng bộ bài" secondary onPress={onClose} disabled={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
