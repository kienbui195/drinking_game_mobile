import type { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export function Button({
  title,
  onPress,
  disabled,
  secondary,
  danger,
  busy,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || busy}
      onPress={onPress}
      className={`min-h-12 rounded-2xl px-5 py-3 items-center justify-center border ${disabled || busy ? 'opacity-40' : ''} ${danger ? 'bg-rose-950 border-rose-800' : secondary ? 'bg-panel border-slate-700' : 'bg-violet-400 border-violet-300'}`}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text
          className={`font-bold text-base ${secondary || danger ? 'text-white' : 'text-slate-950'}`}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View className="gap-2">
      <Text className="text-slate-300 text-sm font-semibold">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#64748b"
        autoCorrect={false}
        className="rounded-2xl border border-slate-700 bg-night text-white p-4 text-base"
        {...props}
      />
    </View>
  );
}
export function Panel({ children }: PropsWithChildren) {
  return <View className="bg-panel border border-slate-700 rounded-3xl p-5 gap-4">{children}</View>;
}
export function Heading({ children }: PropsWithChildren) {
  return <Text className="text-white text-xl font-bold">{children}</Text>;
}
export function Copy({ children }: PropsWithChildren) {
  return <Text className="text-slate-400 text-sm leading-6">{children}</Text>;
}
