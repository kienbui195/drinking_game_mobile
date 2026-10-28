import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { categoryLabels, packById, type Action, type RoomView } from '@chamly/shared';
import { CardCarousel } from './CardCarousel';
import { Button, Copy, Heading, Panel } from './ui';

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
    <Panel>
      <Heading>✨ Tổng kết ván chơi</Heading>
      <Copy>Nhìn lại những khoảnh khắc của cả bàn trước khi bắt đầu ván mới.</Copy>
      <Text className="text-slate-100">🃏 Rút nhiều bài nhất: {leaders('cardsDrawnCount')}</Text>
      <Text className="text-slate-100">
        🏆 Hoàn thành nhiều nhất: {leaders('challengesCompleted')}
      </Text>
      <Text className="text-violet-200 font-bold">Khoảnh khắc đáng nhớ</Text>
      {moments.length ? (
        moments.map((entry, index) => (
          <Copy key={`${entry.at}-${index}`}>
            {entry.playerName} hoàn thành “{entry.card?.title}”
            {entry.votes ? ` · cả bàn bình chọn ${entry.votes.accepted} đạt` : ''}
          </Copy>
        ))
      ) : (
        <Copy>Chưa có thử thách nào được hoàn thành trong ván này.</Copy>
      )}
    </Panel>
  );
}

/** Dải trạng thái vòng chơi, đặt trong vùng header cố định của màn hình phòng. */
export function RoundStatus({ room }: { room: RoomView }) {
  return (
    <View className="gap-0.5">
      <Text className="text-violet-300 font-bold text-xs tracking-widest">
        VÒNG {room.round} · CÒN {room.remainingCount} LÁ TRONG CHỒNG
      </Text>
      {/* Lượt của ai do TurnAlert hiển thị khi đang chơi, tránh lặp cùng một câu hai lần. */}
      {room.phase !== 'playing' && (
        <Text className="text-white text-lg font-bold">
          {room.phase === 'ended' ? 'Hẹn ván tiếp theo ✨' : 'Không đủ bài cho vòng mới'}
        </Text>
      )}
    </View>
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
          <Button
            title={`🎒 Túi thần kỳ · ${pouch.length} lá`}
            secondary
            disabled={busy}
            onPress={onOpenPouch}
          />
          <CardCarousel
            room={room}
            enabled={mine && !busy && !card}
            onPick={(slot) => void send({ type: 'pick', slot })}
          />
          {host && (
            <Button
              title="Bỏ lượt hiện tại (chủ phòng)"
              secondary
              disabled={busy}
              onPress={() => void send({ type: 'skip' })}
            />
          )}
        </>
      )}
      {room.phase !== 'playing' && (
        <Heading>
          {room.phase === 'ended' ? 'Hẹn ván tiếp theo ✨' : 'Không đủ bài cho vòng mới'}
        </Heading>
      )}
      {room.phase === 'depleted' &&
        (host ? (
          <Button
            title="Xáo lại toàn bộ bài · tiếp tục"
            disabled={busy}
            onPress={() => void send({ type: 'reshuffle' })}
          />
        ) : (
          <Copy>Đang chờ chủ phòng xáo lại bài.</Copy>
        ))}
      {room.phase === 'ended' &&
        (host ? (
          <Button
            title="Về phòng chờ · chuẩn bị ván mới"
            disabled={busy}
            onPress={() => void send({ type: 'restart' })}
          />
        ) : (
          <Copy>Ván đã kết thúc. Đang chờ chủ phòng mở ván mới.</Copy>
        ))}
      {room.phase === 'ended' && <GameRecap room={room} />}
      <Panel>
        <Heading>Bảng thành tích</Heading>
        <Copy>Số {pack.unitLabel} chỉ được cộng khi bỏ qua.</Copy>
        {room.players.map((p) => (
          <View key={p.id} className="flex-row items-start justify-between gap-3">
            <Text className="text-slate-200 flex-1">
              {p.name}
              {!p.active ? ' (đã rời)' : ''}
            </Text>
            <Text className="text-violet-200 text-right max-w-[55%]">
              {p.cardsDrawnCount} lá · {p.drinksTaken} {pack.unitLabel} · {p.challengesCompleted} ✓
            </Text>
          </View>
        ))}
      </Panel>
      <Panel>
        <Heading>Diễn biến gần đây</Heading>
        {room.history.length === 0 ? (
          <Copy>Chưa có lượt hoàn thành.</Copy>
        ) : (
          room.history
            .slice(-20)
            .reverse()
            .map((entry, i) => (
              <View key={`${entry.at}-${i}`} className="border-b border-slate-700 pb-3 gap-1">
                <Text className="text-slate-200">
                  V{entry.round} · {entry.playerName} ·{' '}
                  {entry.skipped ? 'Chủ phòng / hệ thống bỏ lượt' : entry.card?.title}
                  {entry.fromPouch ? ' 🎒' : ''}
                </Text>
                <Copy>
                  {entry.skipped
                    ? 'Không cộng thống kê.'
                    : entry.stashed
                      ? 'Đã cất vào túi thần kỳ · không bị phạt'
                      : entry.completed
                        ? 'Hoàn thành · không bị phạt'
                        : `Bỏ qua · ${entry.drinks} ${pack.unitLabel}`}
                </Copy>
                {entry.votes && (
                  <Copy>
                    Cả bàn bình chọn: {entry.votes.accepted} đạt · {entry.votes.rejected} chưa đạt
                  </Copy>
                )}
              </View>
            ))
        )}
      </Panel>
    </>
  );
}

/** Dòng trạng thái ngắn cho vùng footer; mọi hành động của lá bài nằm trong popup. */
export function TurnHint({ room, playerId }: { room: RoomView; playerId: string }) {
  const { mine, player, card } = useTurn(room, playerId);
  if (room.phase === 'depleted') return <Copy>Hết bài cho vòng mới — xem hành động bên trên.</Copy>;
  if (room.phase === 'ended') return <Copy>Ván đã kết thúc.</Copy>;
  if (card)
    return (
      <Copy>{mine ? 'Xác nhận kết quả trong popup lá bài.' : `Đang chờ ${player?.name}.`}</Copy>
    );
  return (
    <Copy>
      {mine
        ? 'Bấm lá ở chính giữa băng chuyền để lật bài.'
        : `Đang chờ ${player?.name ?? '…'} lật bài.`}
    </Copy>
  );
}
