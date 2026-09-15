import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categoryLabels, pouchLimit, type Action, type Card } from '@chamly/shared';
import { Button, Copy, Heading, Panel } from './ui';

/**
 * Túi thần kỳ của một người chơi. Lá trong túi chỉ dùng được vào đúng lượt của chủ túi và khi
 * chưa có lá nào đang mở, vì nó thay chỗ cho việc rút bài của vòng đó.
 */
export function PouchModal({
  cards,
  canUse,
  busy,
  onClose,
  send,
}: {
  cards: Card[];
  canUse: boolean;
  busy: boolean;
  onClose: () => void;
  send: (action: Action) => Promise<boolean>;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-black/85">
        <View className="flex-1 w-full self-center" style={{ maxWidth: 430 }}>
          <View className="px-4 pb-3 pt-2 gap-1">
            <Heading>
              🎒 Túi thần kỳ · {cards.length}/{pouchLimit}
            </Heading>
            <Copy>
              {canUse
                ? 'Chọn một lá để dùng thay cho lượt rút bài của vòng này.'
                : 'Lá trong túi chỉ dùng được vào lượt của bạn, khi chưa lật lá nào.'}
            </Copy>
          </View>
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}
          >
            {cards.length === 0 ? (
              <Panel>
                <Copy>
                  Túi đang trống. Khi lật trúng một lá có thể để dành, hãy chọn “Cất vào túi thần
                  kỳ” thay vì xử lý ngay.
                </Copy>
              </Panel>
            ) : (
              cards.map((card) => (
                <Panel key={card.id}>
                  <Text className="text-violet-300 text-xs font-bold tracking-widest">
                    {categoryLabels[card.category]}
                  </Text>
                  <Heading>{card.title}</Heading>
                  {opened === card.id ? (
                    <>
                      <Copy>{card.description}</Copy>
                      <Text className="text-amber-200 leading-6">{card.penalty}</Text>
                      <Button title="Thu gọn" secondary onPress={() => setOpened(null)} />
                    </>
                  ) : (
                    <Button title="Xem nội dung" secondary onPress={() => setOpened(card.id)} />
                  )}
                  {canUse && (
                    <Button
                      title="Dùng lá này"
                      disabled={busy}
                      onPress={async () => {
                        if (await send({ type: 'usePouch', cardId: card.id })) onClose();
                      }}
                    />
                  )}
                </Panel>
              ))
            )}
          </ScrollView>
          <View className="border-t border-slate-700 px-4 pb-2 pt-3">
            <Button title="Đóng túi" secondary onPress={onClose} disabled={busy} />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
