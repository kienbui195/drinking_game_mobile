import { Pressable, Text } from 'react-native';

/**
 * Toast dùng chung cho cả app: pill gọn nổi trên nội dung, bấm để tắt ngay.
 * Thời gian tự ẩn: success 3s, warning/error/info 5s (caller hẹn giờ).
 * - `info`: thông báo thoáng qua (vd tin từ admin).
 * - `success`: thao tác thành công.
 * - `warning`/`error`: cần người dùng đọc rồi tự ẩn sau 5s.
 */
const tones = {
  info: { bar: 'border-violet-300 bg-violet-950', text: 'text-violet-100', x: 'text-violet-300' },
  success: {
    bar: 'border-emerald-400 bg-emerald-950',
    text: 'text-emerald-100',
    x: 'text-emerald-300',
  },
  warning: { bar: 'border-amber-400 bg-amber-950', text: 'text-amber-100', x: 'text-amber-300' },
  error: { bar: 'border-rose-700 bg-rose-950', text: 'text-rose-100', x: 'text-rose-300' },
} as const;
export function Toast({
  message,
  tone = 'info',
  onClose,
}: {
  message: string;
  tone?: keyof typeof tones;
  onClose: () => void;
}) {
  const style = tones[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Đóng thông báo"
      accessibilityLiveRegion="polite"
      onPress={onClose}
      className={`w-full flex-row items-center gap-2 rounded-2xl border px-4 py-3 shadow-lg ${style.bar}`}
      style={{ maxWidth: 430 }}
    >
      <Text className={`flex-1 text-sm font-semibold ${style.text}`}>{message}</Text>
      <Text className={`text-base font-bold ${style.x}`}>✕</Text>
    </Pressable>
  );
}
