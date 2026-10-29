import { packById, type Action, type RoomView } from '@chamly/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CardCarousel } from './card-carousel';

function useTurn(room: RoomView, playerId: string) {
  return {
    host: room.hostId === playerId,
    mine: room.currentPlayerId === playerId,
    player: room.players.find((p) => p.id === room.currentPlayerId),
    card: room.revealed,
  };
}

function GameRecap({ room }: { room: RoomView }) {
  const players = room.players.filter((player) => player.cardsDrawnCount > 0);
  const leaders = (field: 'cardsDrawnCount' | 'challengesCompleted') => {
    const highest = Math.max(0, ...players.map((player) => player[field]));
    return highest
      ? `${players
          .filter((player) => player[field] === highest)
          .map((player) => player.name)
          .join(', ')} · ${highest}`
      : 'Chưa có';
  };
  const moments = room.history
    .filter((entry) => entry.completed && entry.card && !entry.skipped)
    .slice(-3)
    .reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold">✨ Tổng kết ván chơi</CardTitle>
        <CardDescription>
          Nhìn lại những khoảnh khắc của cả bàn trước khi bắt đầu ván mới.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-base">
        <p>🃏 Rút nhiều bài nhất: {leaders('cardsDrawnCount')}</p>
        <p>🏆 Hoàn thành nhiều nhất: {leaders('challengesCompleted')}</p>
        <p className="text-primary mt-1 font-bold">Khoảnh khắc đáng nhớ</p>
        {moments.length ? (
          moments.map((entry, index) => (
            <p key={`${entry.at}-${index}`} className="text-muted-foreground text-sm leading-6">
              {entry.playerName} hoàn thành “{entry.card?.title}”
              {entry.votes ? ` · cả bàn bình chọn ${entry.votes.accepted} đạt` : ''}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            Chưa có thử thách nào được hoàn thành trong ván này.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Phần cuộn giữa: băng chuyền bài, lá đang mở, thống kê và diễn biến. */
export function GameBoard({
  room,
  playerId,
  busy,
  onOpenPouch,
  send,
}: {
  room: RoomView;
  playerId: string;
  busy: boolean;
  onOpenPouch: () => void;
  send: (action: Action) => Promise<boolean>;
}) {
  const { host, mine, card } = useTurn(room, playerId);
  const pack = packById(room.packId);
  const pouch = room.players.find((p) => p.id === playerId)?.pouch ?? [];
  return (
    <>
      {room.phase === 'playing' && (
        <>
          <Button variant="secondary" disabled={busy} onClick={onOpenPouch}>
            {`🎒 Túi thần kỳ · ${pouch.length} lá`}
          </Button>
          <CardCarousel
            room={room}
            enabled={mine && !busy && !card}
            onPick={(slot) => void send({ type: 'pick', slot })}
          />
          {host && (
            <Button variant="outline" disabled={busy} onClick={() => void send({ type: 'skip' })}>
              Bỏ lượt hiện tại (chủ phòng)
            </Button>
          )}
        </>
      )}
      {room.phase !== 'playing' && (
        <h2 className="text-xl font-bold">
          {room.phase === 'ended' ? 'Hẹn ván tiếp theo ✨' : 'Không đủ bài cho vòng mới'}
        </h2>
      )}
      {room.phase === 'depleted' &&
        (host ? (
          <Button disabled={busy} onClick={() => void send({ type: 'reshuffle' })}>
            Xáo lại toàn bộ bài · tiếp tục
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">Đang chờ chủ phòng xáo lại bài.</p>
        ))}
      {room.phase === 'ended' &&
        (host ? (
          <Button disabled={busy} onClick={() => void send({ type: 'restart' })}>
            Về phòng chờ · chuẩn bị ván mới
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            Ván đã kết thúc. Đang chờ chủ phòng mở ván mới.
          </p>
        ))}
      {room.phase === 'ended' && <GameRecap room={room} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold">Bảng thành tích</CardTitle>
          <CardDescription>Số {pack.unitLabel} chỉ được cộng khi bỏ qua.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {room.players.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 text-base">
              <span className="flex-1">
                {p.name}
                {!p.active ? ' (đã rời)' : ''}
              </span>
              <span className="text-primary max-w-[55%] text-right">
                {p.cardsDrawnCount} lá · {p.drinksTaken} {pack.unitLabel} · {p.challengesCompleted}{' '}
                ✓
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold">Diễn biến gần đây</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {room.history.length === 0 ? (
            <p className="text-muted-foreground text-sm">Chưa có lượt hoàn thành.</p>
          ) : (
            room.history
              .slice(-20)
              .reverse()
              .map((entry, i, list) => (
                <div key={`${entry.at}-${i}`} className="flex flex-col gap-1">
                  <p className="text-base">
                    V{entry.round} · {entry.playerName} ·{' '}
                    {entry.skipped ? 'Chủ phòng / hệ thống bỏ lượt' : entry.card?.title}
                    {entry.fromPouch ? ' 🎒' : ''}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {entry.skipped
                      ? 'Không cộng thống kê.'
                      : entry.stashed
                        ? 'Đã cất vào túi thần kỳ · không bị phạt'
                        : entry.completed
                          ? 'Hoàn thành · không bị phạt'
                          : `Bỏ qua · ${entry.drinks} ${pack.unitLabel}`}
                  </p>
                  {entry.votes && (
                    <p className="text-muted-foreground text-sm">
                      Cả bàn bình chọn: {entry.votes.accepted} đạt · {entry.votes.rejected} chưa đạt
                    </p>
                  )}
                  {i < list.length - 1 && <Separator className="mt-2" />}
                </div>
              ))
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Dòng trạng thái ngắn cho vùng footer; mọi hành động của lá bài nằm trong popup. */
export function TurnHint({ room, playerId }: { room: RoomView; playerId: string }) {
  const { mine, player, card } = useTurn(room, playerId);
  const text =
    room.phase === 'depleted'
      ? 'Hết bài cho vòng mới — xem hành động bên trên.'
      : room.phase === 'ended'
        ? 'Ván đã kết thúc.'
        : card
          ? mine
            ? 'Xác nhận kết quả trong popup lá bài.'
            : `Đang chờ ${player?.name}.`
          : mine
            ? 'Bấm lá ở chính giữa băng chuyền để lật bài.'
            : `Đang chờ ${player?.name ?? '…'} lật bài.`;
  return <p className="text-muted-foreground text-center text-sm">{text}</p>;
}
