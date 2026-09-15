import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  categoryLabels,
  packById,
  pouchLimit,
  type Action,
  type Card,
  type RoomView,
} from '@chamly/shared';
import { Button, Copy, Panel } from './ui';

const NATIVE = Platform.OS !== 'web';

/** Đáp án chỉ hiện khi có người chủ động mở, tránh lộ trước khi cả bàn kịp trả lời. */
function AnswerReveal({ answer }: { answer: string }) {
  const [shown, setShown] = useState(false);
  return shown ? (
    <View className="bg-night border border-emerald-800 rounded-2xl p-3 gap-1">
      <Text className="text-emerald-300 text-xs font-bold tracking-widest">ĐÁP ÁN</Text>
      <Text className="text-slate-100 leading-6">{answer}</Text>
    </View>
  ) : (
    <Button title="Xem đáp án" secondary onPress={() => setShown(true)} />
  );
}

/**
 * Lá bài vừa lật hiện thành popup phủ toàn màn hình: cả bàn cùng đọc một nội dung, và người
 * đang ở lượt xác nhận kết quả ngay trong popup. Kết quả gửi đi xong thì popup tự đóng vì
 * server xóa lá đang mở khỏi state phòng.
 */
export function CardModal({
  room,
  card,
  mine,
  playerName,
  pouchCount,
  fromPouch,
  busy,
  send,
}: {
  room: RoomView;
  card: Card;
  mine: boolean;
  playerName: string;
  pouchCount: number;
  fromPouch: boolean;
  busy: boolean;
  send: (action: Action) => Promise<boolean>;
}) {
  const pack = packById(room.packId);
  const [drinks, setDrinks] = useState(card.drinksCount);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    setDrinks(card.drinksCount);
  }, [card.id, card.drinksCount]);
  useEffect(() => {
    setOffset(room.serverTime - Date.now());
  }, [room.serverTime]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: NATIVE, damping: 16 }).start();
  }, [card.id, enter]);
  return (
    <Modal transparent animationType="fade" onRequestClose={() => {}}>
      <SafeAreaView className="flex-1 bg-black/85">
        <View className="flex-1 items-center justify-center p-4">
          <Animated.View
            className="w-full"
            style={{
              maxWidth: 430,
              opacity: enter,
              transform: [
                { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            }}
          >
            <Panel>
              <ScrollView
                style={{ maxHeight: 420 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ gap: 12 }}
              >
                <Text className="text-amber-300 font-bold uppercase text-xs tracking-widest">
                  {categoryLabels[card.category]}
                </Text>
                <Text className="text-white text-3xl font-extrabold">{card.title}</Text>
                {card.keepable && !fromPouch && (
                  <Text className="text-emerald-300 text-xs font-bold">
                    🎒 Lá này có thể cất vào túi thần kỳ để dùng ở vòng sau.
                  </Text>
                )}
                {fromPouch && (
                  <Text className="text-emerald-300 text-xs font-bold">
                    🎒 Lá lấy ra từ túi thần kỳ.
                  </Text>
                )}
                <Text className="text-slate-200 text-base leading-7">{card.description}</Text>
                <Text className="text-amber-200 leading-6">{card.penalty}</Text>
                {!!card.answer && <AnswerReveal answer={card.answer} />}
                {card.hasTimer && (
                  <>
                    <Text className="text-violet-300 text-5xl font-bold text-center">
                      {room.timerEndsAt
                        ? Math.max(0, Math.ceil((room.timerEndsAt - now - offset) / 1000))
                        : card.timerSeconds}
                      s
                    </Text>
                    {mine && !room.timerEndsAt && (
                      <Button
                        title="Bắt đầu đồng hồ chung"
                        secondary
                        disabled={busy}
                        onPress={() => void send({ type: 'timer' })}
                      />
                    )}
                  </>
                )}
              </ScrollView>
              {mine ? (
                <View className="gap-3 border-t border-slate-700 pt-3">
                  <Button
                    title={pack.completeLabel}
                    disabled={busy}
                    onPress={() => void send({ type: 'complete', drinks: 0, completed: true })}
                  />
                  <View className="flex-row items-center justify-between gap-3">
                    <Button
                      title="−"
                      secondary
                      disabled={busy || drinks <= 0}
                      onPress={() => setDrinks((v) => v - 1)}
                    />
                    <Text className="text-slate-300 text-sm flex-1 text-center">
                      Phạt khi bỏ qua:{' '}
                      <Text className="text-white font-bold">
                        {drinks} {pack.unitLabel}
                      </Text>
                    </Text>
                    <Button
                      title="+"
                      secondary
                      disabled={busy || drinks >= 20}
                      onPress={() => setDrinks((v) => v + 1)}
                    />
                  </View>
                  <Button
                    title={`${pack.skipLabel} · ${drinks} ${pack.unitLabel}`}
                    secondary
                    disabled={busy}
                    onPress={() => void send({ type: 'complete', drinks, completed: false })}
                  />
                  {card.keepable && !fromPouch && (
                    <Button
                      title={
                        pouchCount >= pouchLimit
                          ? `Túi đã đầy (${pouchLimit} lá)`
                          : 'Cất vào túi thần kỳ · không bị phạt'
                      }
                      secondary
                      disabled={busy || pouchCount >= pouchLimit}
                      onPress={() => void send({ type: 'stash' })}
                    />
                  )}
                </View>
              ) : (
                <View className="border-t border-slate-700 pt-3">
                  <Copy>Đang chờ {playerName} xác nhận kết quả…</Copy>
                </View>
              )}
            </Panel>
          </Animated.View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
