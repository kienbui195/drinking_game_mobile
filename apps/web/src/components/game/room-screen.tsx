import { useEffect, useState } from 'react';
import { TimerIcon, TriangleAlertIcon } from 'lucide-react';
import { packById, type Action, type Player, type RoomView, type Session } from '@chamly/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWakeLock } from '@/hooks/use-mobile-shell';
import { cn } from '@/lib/utils';
import { FullscreenButton } from './app-chrome';
import { CardModal } from './card-modal';
import { GameBoard, TurnHint } from './game-board';
import { PouchDrawer } from './pouch-drawer';
import { TurnAlert } from './turn-alert';

/**
 * Đồng hồ đếm ngược tới lúc server thu hồi phòng. Chênh lệch giờ giữa máy và server được bù
 * bằng `serverTime` để con số hiển thị khớp với thời điểm phòng thực sự bị xóa.
 */
function useExpiryCountdown(room: RoomView) {
  const [now, setNow] = useState(Date.now());
  // Chốt lệch giờ một lần cho mỗi bản tin của server. Tính lại theo `now` từng nhịp sẽ khử
  // mất chính `now`, khiến đồng hồ đứng im ở một con số không đổi.
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(room.serverTime - Date.now());
  }, [room.serverTime]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil((room.expiresAt - now - offset) / 1000));
}

const pad = (value: number) => String(value).padStart(2, '0');
/** mm:ss, chuyển sang h:mm:ss khi còn hơn một giờ để phút không tràn thành số ba chữ số. */
function clock(seconds: number) {
  const s = pad(seconds % 60);
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${pad(m)}:${s}` : `${Math.floor(m / 60)}:${pad(m % 60)}:${s}`;
}

function Countdown({ seconds }: { seconds: number }) {
  const urgent = seconds <= 60;
  return (
    <Alert
      variant={urgent ? 'destructive' : 'default'}
      className={cn(!urgent && 'border-warning/40 text-warning')}
    >
      <TimerIcon />
      <AlertTitle className="flex items-center justify-between gap-3 font-bold">
        Phòng sẽ tự đóng
        <span className="text-2xl font-black tabular-nums">{clock(seconds)}</span>
      </AlertTitle>
      <AlertDescription className="leading-6">
        Phòng chỉ có một người nên chỉ được giữ 10 phút để tiết kiệm tài nguyên. Khi có người thứ
        hai vào, đồng hồ dừng lại. Hết giờ, phòng bị xóa và bạn được đưa về sảnh.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Màn hình phòng chia ba tầng cố định: thông tin phòng ở trên, hành động ở dưới, chỉ khối
 * giữa cuộn. Giữ nút hành động luôn trong tầm tay ngón cái.
 */
export function RoomScreen({
  room,
  session,
  locked,
  disconnected,
  everyoneReady,
  pouchOpen,
  setPouchOpen,
  onOpenDeck,
  send,
}: {
  room: RoomView;
  session: Session;
  locked: boolean;
  disconnected: Player[];
  everyoneReady: boolean;
  pouchOpen: boolean;
  setPouchOpen: (open: boolean) => void;
  onOpenDeck: () => void;
  send: (action: Action) => Promise<boolean>;
}) {
  const host = room.hostId === session.playerId;
  const lobby = room.phase === 'lobby';
  const seated = room.players.filter((p) => p.active);
  const pack = packById(room.packId);
  const mine = room.currentPlayerId === session.playerId;
  const current = room.players.find((p) => p.id === room.currentPlayerId);
  const card = room.revealed;
  const me = room.players.find((p) => p.id === session.playerId);
  const pouch = me?.pouch ?? [];
  const fromPouch = !!card && !room.slots.some((slot) => slot.card?.id === card.id);
  const countdown = useExpiryCountdown(room);
  const solo = seated.length <= 1;
  useWakeLock(true);
  return (
    <>
      {/* Header giữ ở mức thấp nhất có thể khi đang chơi: một dòng nhận dạng phòng, một dòng
          trạng thái lượt kèm người chơi. Mọi thứ còn lại nằm trong vùng cuộn. */}
      <header className="border-border flex shrink-0 flex-col gap-1.5 border-b px-3 pt-1.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            <span aria-label={`Mã phòng ${room.id}`} className="text-primary font-bold select-all">
              #{room.id}
            </span>{' '}
            · {room.name} · {pack.icon}
          </p>
          <span className="text-primary text-xs font-bold">
            {lobby ? `${seated.length}/12 người` : `V${room.round} · ${room.remainingCount} lá`}
          </span>
          <FullscreenButton />
        </div>
        <div className="flex items-center gap-2">
          {room.phase === 'playing' && (
            <TurnAlert
              active={mine}
              label={mine ? 'Đến lượt bạn!' : `Lượt của ${current?.name ?? '…'}`}
            />
          )}
          {/* Vuốt ngang danh sách người chơi; overscroll-x contain để không kích hoạt back. */}
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto overscroll-x-contain pr-1.5 [scrollbar-width:none]">
            {seated.map((p) => (
              <Badge key={p.id} variant="secondary" className="h-7 shrink-0 rounded-full">
                {p.online ? '🟢' : '⚪'} {p.name}
                {p.id === room.hostId ? ' 👑' : ''}
                {p.id === session.playerId ? ' (bạn)' : ''}
                {(p.pouch?.length ?? 0) > 0 ? ` 🎒${p.pouch.length}` : ''}
              </Badge>
            ))}
          </div>
        </div>
      </header>

      <main className="scroll-area flex min-h-0 flex-1 flex-col gap-4 p-4 pb-6">
        {solo && <Countdown seconds={countdown} />}
        {lobby ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-bold">Sẵn sàng cho một ván mới?</CardTitle>
                <CardDescription className="leading-6">
                  Chủ đề {pack.name}: {pack.tagline} Thứ tự lượt theo thứ tự vào phòng. Bộ bài riêng
                  có {room.deck.length} lá. Sau khi bắt đầu, danh sách người chơi và bộ bài được
                  khóa đối với người mới.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                Chia sẻ mã phòng và mật khẩu cho bạn bè để cùng vào.
              </CardContent>
            </Card>
            {disconnected.length > 0 && (
              <Alert className="border-warning/40 text-warning">
                <TriangleAlertIcon />
                <AlertTitle className="font-bold">Chưa sẵn sàng</AlertTitle>
                <AlertDescription className="leading-6">
                  {disconnected.map((p) => p.name).join(', ')} đang mất kết nối. Ván chỉ bắt đầu khi
                  tất cả người trong phòng đều trực tuyến.
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <GameBoard
            room={room}
            playerId={session.playerId}
            busy={locked}
            onOpenPouch={() => setPouchOpen(true)}
            send={send}
          />
        )}
        <p className="text-muted-foreground text-sm leading-6">
          Chủ phòng rời đi: quyền được chuyển cho thành viên tiếp theo. Khi mất mạng, chỗ ngồi được
          giữ tối đa 30 phút nếu cả phòng đều offline; chủ phòng có thể bỏ lượt đang chờ. Phòng
          không còn thành viên sẽ được xóa ngay.
        </p>
      </main>

      <footer className="border-border bg-background pb-safe flex shrink-0 flex-col gap-3 border-t px-4 pt-3">
        {lobby ? (
          <>
            <Button variant="secondary" disabled={locked} onClick={onOpenDeck}>
              {host
                ? `Chỉnh bộ bài · ${room.deck.length} lá`
                : `Xem bộ bài · ${room.deck.length} lá`}
            </Button>
            {host ? (
              everyoneReady ? (
                <Button size="lg" disabled={locked} onClick={() => void send({ type: 'start' })}>
                  Bắt đầu ván chơi
                </Button>
              ) : (
                <p className="text-muted-foreground text-center text-sm">
                  {seated.length < 2
                    ? 'Cần ít nhất 2 người trong phòng để bắt đầu.'
                    : 'Nút bắt đầu hiện lại khi mọi người đã trực tuyến.'}
                </p>
              )
            ) : (
              <p className="text-muted-foreground text-center text-sm">
                Đang chờ chủ phòng bắt đầu…
              </p>
            )}
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => void send({ type: 'leave' })}
            >
              Rời phòng
            </Button>
          </>
        ) : (
          <>
            <TurnHint room={room} playerId={session.playerId} />
            <div className="flex gap-3 *:flex-1">
              {host && room.phase !== 'ended' && (
                <Button
                  variant="destructive"
                  disabled={locked}
                  onClick={() => void send({ type: 'end' })}
                >
                  Kết thúc ván
                </Button>
              )}
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => void send({ type: 'leave' })}
              >
                Rời phòng
              </Button>
            </div>
          </>
        )}
      </footer>
      {card && room.phase === 'playing' && (
        <CardModal
          room={room}
          card={card}
          mine={mine}
          playerId={session.playerId}
          playerName={current?.name ?? ''}
          pouchCount={pouch.length}
          fromPouch={fromPouch}
          busy={locked}
          send={send}
        />
      )}
      <PouchDrawer
        open={pouchOpen}
        cards={pouch}
        canUse={mine && !card && room.phase === 'playing'}
        busy={locked}
        onClose={() => setPouchOpen(false)}
        send={send}
      />
    </>
  );
}
