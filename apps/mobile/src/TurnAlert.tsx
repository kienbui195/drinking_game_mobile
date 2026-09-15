import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Text, View } from 'react-native';
import { useAudioPlayer } from 'expo-audio';

const NATIVE = Platform.OS !== 'web';
const chime = require('../assets/your-turn.wav');

/**
 * Báo lượt: một banner đập nhẹ kèm chuông ngắn. Chuông chỉ vang đúng lúc lượt vừa chuyển sang
 * người này, không phát lại ở mỗi lần state phòng được đồng bộ.
 */
export function TurnAlert({ active, label }: { active: boolean; label: string }) {
  const player = useAudioPlayer(chime);
  const pulse = useRef(new Animated.Value(0)).current;
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) {
      try {
        player.seekTo(0);
        player.play();
      } catch {
        /* Trình duyệt có thể chặn âm thanh; banner vẫn đủ để báo lượt. */
      }
    }
    wasActive.current = active;
  }, [active, player]);
  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: NATIVE,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: NATIVE,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);
  if (!active)
    return (
      <View className="bg-panel border border-slate-700 rounded-full px-3 py-1.5 self-start">
        <Text className="text-slate-300 text-xs font-bold">{label}</Text>
      </View>
    );
  return (
    <Animated.View
      style={{
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }),
      }}
      className="bg-violet-400 border-2 border-violet-200 rounded-full px-4 py-2 self-start"
    >
      <Text className="text-slate-950 font-black tracking-wide">🔔 {label}</Text>
    </Animated.View>
  );
}
