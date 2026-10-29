import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from '@chamly/shared';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';
import { cn } from '@/lib/utils';

/**
 * Băng chuyền bài: vuốt ngang để đưa một lá vào giữa, bấm lá ở giữa để lật. Embla tự đặt
 * `touch-action: pan-y` nên vuốt dọc vẫn cuộn được trang, còn vuốt ngang thuộc về băng chuyền.
 * Lá ở rìa thu nhỏ và mờ dần theo khoảng cách tới giữa, tính trực tiếp trên DOM ở mỗi khung
 * hình để không render lại React khi đang vuốt.
 */
export function CardCarousel({
  room,
  enabled,
  onPick,
}: {
  room: RoomView;
  enabled: boolean;
  onPick: (slot: number) => void;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [active, setActive] = useState(0);
  const slides = useRef<(HTMLDivElement | null)[]>([]);

  const tween = useCallback((embla: NonNullable<CarouselApi>) => {
    const progress = embla.scrollProgress();
    const snaps = embla.scrollSnapList();
    const step = snaps.length > 1 ? snaps[1] - snaps[0] : 1;
    snaps.forEach((snap, index) => {
      const node = slides.current[index];
      if (!node) return;
      const distance = Math.min(1, Math.abs(snap - progress) / step);
      node.style.transform = `translateY(${distance * 16}px) scale(${1 - distance * 0.14})`;
      node.style.opacity = String(1 - distance * 0.55);
    });
  }, []);

  useEffect(() => {
    if (!api) return;
    const select = () => setActive(api.selectedScrollSnap());
    const frame = () => tween(api);
    select();
    frame();
    api.on('select', select).on('scroll', frame).on('reInit', frame).on('reInit', select);
    return () => {
      api.off('select', select).off('scroll', frame).off('reInit', frame).off('reInit', select);
    };
  }, [api, tween]);

  // Vòng mới chia lại bài: đưa băng chuyền về lá đầu tiên thay vì giữ vị trí cuộn cũ.
  useEffect(() => {
    api?.scrollTo(0, true);
  }, [api, room.round]);

  function press(index: number) {
    if (index !== active) {
      api?.scrollTo(index);
      return;
    }
    if (enabled && !room.slots[index]?.pickedBy) onPick(index);
  }

  const current = room.slots[active];
  return (
    <div className="flex flex-col gap-2">
      <Carousel setApi={setApi} opts={{ align: 'center', containScroll: false }} className="-mx-4">
        <CarouselContent className="-ml-3.5 py-4">
          {room.slots.map((slot, index) => {
            const taken = !!slot.pickedBy;
            const focused = index === active;
            return (
              <CarouselItem key={`${room.round}-${index}`} className="basis-[56%] pl-3.5">
                <div
                  ref={(node) => {
                    slides.current[index] = node;
                  }}
                  className="will-change-transform"
                >
                  <button
                    type="button"
                    aria-label={`Lá bài ${index + 1}`}
                    aria-selected={focused}
                    aria-disabled={taken}
                    onClick={() => press(index)}
                    className={cn(
                      'flex h-56 w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 p-4 shadow-lg transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      taken
                        ? 'bg-card border-border'
                        : focused
                          ? 'bg-accent border-ring shadow-primary/25'
                          : 'border-accent bg-[#1e1638]',
                      focused && enabled && !taken && 'active:scale-[0.97]',
                    )}
                  >
                    <span className="text-success text-4xl">{taken ? '✓' : '🥂'}</span>
                    <span className="text-accent-foreground text-center text-sm font-bold">
                      {slot.card?.title ?? 'CHẠM LY'}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {taken
                        ? (room.players.find((p) => p.id === slot.pickedBy)?.name ?? 'Đã lật')
                        : `#${index + 1}`}
                    </span>
                  </button>
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </Carousel>
      <div className="flex items-center justify-center gap-2" aria-hidden>
        {room.slots.map((_, index) => (
          <span
            key={index}
            className={cn(
              'h-1.5 rounded-full transition-all',
              index === active ? 'bg-ring w-5' : 'bg-border w-1.5',
            )}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-center text-sm leading-6">
        {current?.pickedBy
          ? 'Lá ở giữa đã được lật. Vuốt sang lá khác.'
          : enabled
            ? 'Vuốt để chọn lá, bấm vào lá ở chính giữa để lật.'
            : 'Vuốt để xem các lá. Chỉ người đang ở lượt mới lật được bài.'}
      </p>
    </div>
  );
}
