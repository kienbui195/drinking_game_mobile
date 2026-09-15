import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import type { RoomView } from '@chamly/shared';
import { Copy } from './ui';

const GAP = 14;
// Animated.Value chạy trên luồng JS ở web; native driver chỉ bật được trên iOS/Android.
const NATIVE = Platform.OS !== 'web';

export function CardCarousel({
  room,
  enabled,
  onPick,
}: {
  room: RoomView;
  enabled: boolean;
  onPick: (slot: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<any>(null);
  const cardWidth = Math.min(210, Math.max(150, Math.round(width * 0.56)));
  const interval = cardWidth + GAP;
  const sidePad = Math.max(0, (width - cardWidth) / 2);
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: NATIVE,
        listener: (e: any) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / interval);
          setActive((old) => (old === index ? old : index));
        },
      }),
    [interval, scrollX],
  );
  // Vòng mới chia lại bài: đưa băng chuyền về lá đầu tiên thay vì giữ vị trí cuộn cũ.
  useEffect(() => {
    setActive(0);
    scrollX.setValue(0);
    listRef.current?.scrollTo({ x: 0, animated: false });
  }, [room.round, scrollX]);
  function press(index: number) {
    if (index !== active) {
      listRef.current?.scrollTo({ x: index * interval, animated: true });
      return;
    }
    if (enabled && !room.slots[index]?.pickedBy) onPick(index);
  }
  const current = room.slots[active];
  return (
    <View
      className="gap-2"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <Animated.ScrollView
          ref={listRef}
          horizontal
          decelerationRate="fast"
          snapToInterval={interval}
          snapToAlignment="start"
          disableIntervalMomentum
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingHorizontal: sidePad, paddingVertical: 16 }}
        >
          {room.slots.map((slot, index) => {
            const range = [(index - 1) * interval, index * interval, (index + 1) * interval];
            const scale = scrollX.interpolate({
              inputRange: range,
              outputRange: [0.86, 1, 0.86],
              extrapolate: 'clamp',
            });
            const translateY = scrollX.interpolate({
              inputRange: range,
              outputRange: [16, 0, 16],
              extrapolate: 'clamp',
            });
            const opacity = scrollX.interpolate({
              inputRange: range,
              outputRange: [0.45, 1, 0.45],
              extrapolate: 'clamp',
            });
            const taken = !!slot.pickedBy;
            const focused = index === active;
            return (
              <Animated.View
                key={`${room.round}-${index}`}
                style={{
                  width: cardWidth,
                  marginRight: index === room.slots.length - 1 ? 0 : GAP,
                  transform: [{ scale }, { translateY }],
                  opacity,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Lá bài ${index + 1}`}
                  accessibilityState={{ selected: focused, disabled: taken }}
                  aria-selected={focused}
                  onPress={() => press(index)}
                  className={`h-56 rounded-3xl border-2 items-center justify-center p-4 gap-3 ${
                    taken
                      ? 'bg-panel border-slate-700'
                      : focused
                        ? 'bg-violet-900 border-violet-300'
                        : 'bg-violet-950 border-violet-800'
                  }`}
                >
                  <Text className="text-4xl text-emerald-300">{taken ? '✓' : '🥂'}</Text>
                  <Text className="text-violet-100 text-sm text-center font-bold">
                    {slot.card?.title ?? 'CHẠM LY'}
                  </Text>
                  <Text className="text-slate-400 text-xs">
                    {taken
                      ? (room.players.find((p) => p.id === slot.pickedBy)?.name ?? 'Đã lật')
                      : `#${index + 1}`}
                  </Text>
                </Pressable>
              </Animated.View>
            );
          })}
        </Animated.ScrollView>
      )}
      <View className="flex-row items-center justify-center gap-2">
        {room.slots.map((_, index) => (
          <View
            key={index}
            className={`h-1.5 rounded-full ${
              index === active ? 'w-5 bg-violet-300' : 'w-1.5 bg-slate-700'
            }`}
          />
        ))}
      </View>
      <Copy>
        {current?.pickedBy
          ? 'Lá ở giữa đã được lật. Vuốt sang lá khác.'
          : enabled
            ? 'Vuốt để chọn lá, bấm vào lá ở chính giữa để lật.'
            : 'Vuốt để xem các lá. Chỉ người đang ở lượt mới lật được bài.'}
      </Copy>
    </View>
  );
}
