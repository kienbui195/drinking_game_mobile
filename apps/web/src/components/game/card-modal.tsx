import { useEffect, useState } from 'react';
import { MinusIcon, PlusIcon } from 'lucide-react';
import {
  categoryLabels,
  packById,
  pouchLimit,
  type Action,
  type Card,
  type RoomView,
} from '@chamly/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

/** Đáp án chỉ hiện khi có người chủ động mở, tránh lộ trước khi cả bàn kịp trả lời. */
function AnswerReveal({ answer }: { answer: string }) {
  const [shown, setShown] = useState(false);
  return shown ? (
    <Alert className="border-success/40">
      <AlertTitle className="text-success text-xs font-bold tracking-widest">ĐÁP ÁN</AlertTitle>
      <AlertDescription className="text-foreground leading-6">{answer}</AlertDescription>
    </Alert>
  ) : (
    <Button variant="secondary" onClick={() => setShown(true)}>
      Xem đáp án
    </Button>
  );
}

/**
 * Lá bài vừa lật hiện thành popup: cả bàn cùng đọc một nội dung, và người đang ở lượt xác nhận
 * kết quả ngay trong popup. Popup không tự đóng bằng chạm ra ngoài; kết quả gửi đi xong thì
 * server xóa lá đang mở khỏi state phòng và popup biến mất theo.
 */
export function CardModal({
  room,
  card,
  mine,
  playerId,
  playerName,
  pouchCount,
  fromPouch,
  busy,
  send,
}: {
  room: RoomView;
  card: Card;
  mine: boolean;
  playerId: string;
  playerName: string;
  pouchCount: number;
  fromPouch: boolean;
  busy: boolean;
  send: (action: Action) => Promise<boolean>;
}) {
  const pack = packById(room.packId);
  const vote = room.vote;
  const canVote = card.category === 'challenge' || card.category === 'minigame';
  const [drinks, setDrinks] = useState(card.drinksCount);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setDrinks(card.drinksCount);
  }, [card.id, card.drinksCount]);
  useEffect(() => {
    setOffset(room.serverTime - Date.now());
  }, [room.serverTime]);
  useEffect(() => {
    if (!card.hasTimer) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [card.hasTimer]);
  const block = (e: Event) => e.preventDefault();
  return (
    <Dialog open>
      <DialogContent
        key={card.id}
        showCloseButton={false}
        onEscapeKeyDown={block}
        onInteractOutside={block}
        className="animate-card-pop flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-3 sm:max-w-[398px]"
      >
        <div className="scroll-area -mx-1 flex min-h-0 flex-col gap-3 px-1">
          <DialogHeader className="gap-3">
            <Badge variant="outline" className="text-warning border-warning/40 w-fit uppercase">
              {categoryLabels[card.category]}
            </Badge>
            <DialogTitle className="text-3xl leading-tight font-extrabold">
              {card.title}
            </DialogTitle>
            {card.keepable && !fromPouch && (
              <p className="text-success text-xs font-bold">
                🎒 Lá này có thể cất vào túi thần kỳ để dùng ở vòng sau.
              </p>
            )}
            {fromPouch && (
              <p className="text-success text-xs font-bold">🎒 Lá lấy ra từ túi thần kỳ.</p>
            )}
            <DialogDescription className="text-foreground/90 text-base leading-7">
              {card.description}
            </DialogDescription>
          </DialogHeader>
          <p className="text-warning leading-6">{card.penalty}</p>
          {!!card.answer && <AnswerReveal answer={card.answer} />}
          {card.hasTimer && (
            <>
              <p className="text-primary text-center text-5xl font-bold tabular-nums">
                {room.timerEndsAt
                  ? Math.max(0, Math.ceil((room.timerEndsAt - now - offset) / 1000))
                  : card.timerSeconds}
                s
              </p>
              {mine && !room.timerEndsAt && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void send({ type: 'timer' })}
                >
                  Bắt đầu đồng hồ chung
                </Button>
              )}
            </>
          )}
        </div>
        {vote && (
          <p className="text-muted-foreground text-sm">
            Bình chọn kết quả · {vote.votedPlayerIds.length}/{vote.total} phiếu
            {vote.votedPlayerIds.includes(playerId) ? ' · Bạn đã bình chọn' : ''}
          </p>
        )}
        <Separator />
        {mine ? (
          <div className="flex shrink-0 flex-col gap-2.5">
            {!vote && (
              <Button
                size="lg"
                disabled={busy}
                onClick={() => void send({ type: 'complete', drinks: 0, completed: true })}
              >
                {pack.completeLabel}
              </Button>
            )}
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Giảm mức phạt"
                disabled={busy || drinks <= 0}
                onClick={() => setDrinks((v) => v - 1)}
              >
                <MinusIcon />
              </Button>
              <p className="text-muted-foreground flex-1 text-center text-sm">
                Phạt khi bỏ qua:{' '}
                <span className="text-foreground font-bold">
                  {drinks} {pack.unitLabel}
                </span>
              </p>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Tăng mức phạt"
                disabled={busy || drinks >= 20}
                onClick={() => setDrinks((v) => v + 1)}
              >
                <PlusIcon />
              </Button>
            </div>
            {!vote && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void send({ type: 'complete', drinks, completed: false })}
              >
                {`${pack.skipLabel} · ${drinks} ${pack.unitLabel}`}
              </Button>
            )}
            {canVote && !vote && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void send({ type: 'requestVote', drinks })}
              >
                Nhờ cả bàn bình chọn kết quả
              </Button>
            )}
            {vote && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void send({ type: 'cancelVote' })}
              >
                Hủy bình chọn · tự xác nhận
              </Button>
            )}
            {!vote && card.keepable && !fromPouch && (
              <Button
                variant="outline"
                disabled={busy || pouchCount >= pouchLimit}
                onClick={() => void send({ type: 'stash' })}
              >
                {pouchCount >= pouchLimit
                  ? `Túi đã đầy (${pouchLimit} lá)`
                  : 'Cất vào túi thần kỳ · không bị phạt'}
              </Button>
            )}
          </div>
        ) : vote && !vote.votedPlayerIds.includes(playerId) ? (
          <div className="flex shrink-0 flex-col gap-2.5">
            <p className="text-muted-foreground text-sm">
              {playerName} đã thực hiện xong? Bạn đánh giá thế nào?
            </p>
            <Button disabled={busy} onClick={() => void send({ type: 'vote', accepted: true })}>
              Bình chọn · Đạt
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void send({ type: 'vote', accepted: false })}
            >
              Bình chọn · Chưa đạt
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {vote ? 'Đang chờ các phiếu còn lại…' : `Đang chờ ${playerName} xác nhận kết quả…`}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
