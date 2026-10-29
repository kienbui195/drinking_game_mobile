import { useEffect, useRef } from 'react';
import { BellRingIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { vibrate } from '@/hooks/use-mobile-shell';
import { cn } from '@/lib/utils';

// Trình duyệt chặn phát âm thanh trước lần chạm đầu tiên: phát thử một lần (tắt tiếng) ngay ở
// lần chạm đó để các lần báo lượt sau vang được.
const chime = typeof Audio !== 'undefined' ? new Audio('/your-turn.wav') : null;
if (chime) {
  chime.preload = 'auto';
  const unlock = () => {
    chime.muted = true;
    void chime
      .play()
      .then(() => {
        chime.pause();
        chime.currentTime = 0;
      })
      .catch(() => {})
      .finally(() => (chime.muted = false));
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
}

/**
 * Báo lượt: một banner đập nhẹ kèm chuông ngắn và rung. Chuông chỉ vang đúng lúc lượt vừa
 * chuyển sang người này, không phát lại ở mỗi lần state phòng được đồng bộ.
 */
export function TurnAlert({ active, label }: { active: boolean; label: string }) {
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) {
      vibrate([120, 60, 120]);
      if (chime) {
        chime.currentTime = 0;
        void chime.play().catch(() => {
          /* Chưa được phép phát âm thanh; banner vẫn đủ để báo lượt. */
        });
      }
    }
    wasActive.current = active;
  }, [active]);
  return (
    <Badge
      variant={active ? 'default' : 'secondary'}
      className={cn(
        'h-8 shrink-0 rounded-full px-3 text-xs font-bold',
        active && 'animate-turn-pulse h-9 px-4 text-sm font-black ring-2 ring-ring',
      )}
    >
      {active && <BellRingIcon data-icon="inline-start" />}
      {label}
    </Badge>
  );
}
