import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { categoryLabels, type Action, type RoomView } from '@chamly/shared';
import { Button, Copy, Heading, Panel } from './ui';

export function GameBoard({
  room,
  playerId,
  busy,
  send,
}: {
  room: RoomView;
  playerId: string;
  busy: boolean;
  send: (action: Action) => Promise<boolean>;
}) {
  const host = room.hostId === playerId;
  const mine = room.currentPlayerId === playerId;
  const player = room.players.find((p) => p.id === room.currentPlayerId);
  const card = room.revealed;
  const [drinks, setDrinks] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setDrinks(card?.drinksCount ?? 0);
  }, [card?.id, room.currentPlayerId, room.round]);
  useEffect(() => {
    setOffset(room.serverTime - Date.now());
  }, [room.serverTime]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <Panel>
        <Text className="text-violet-300 font-bold text-xs tracking-widest">
          VÒNG {room.round} · CÒN {room.remainingCount} LÁ TRONG CHỒNG
        </Text>
        <Heading>
          {room.phase === 'ended'
            ? 'Hẹn ván tiếp theo ✨'
            : room.phase === 'depleted'
              ? 'Không đủ bài cho vòng mới'
              : mine
                ? 'Đến lượt bạn rồi!'
                : `Lượt của ${player?.name ?? '…'}`}
        </Heading>
        <Copy>
          {room.phase === 'playing'
            ? 'Chọn một lá úp. Mọi người trong phòng sẽ cùng thấy lá bài được mở.'
            : 'Chủ phòng có thể chọn hành động tiếp theo bên dưới.'}
        </Copy>
      </Panel>
      {room.phase === 'playing' && (
        <>
          <View className="flex-row flex-wrap gap-3 justify-center py-3">
            {room.slots.map((slot, index) => (
              <Pressable
                key={`${room.round}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`Lá bài ${index + 1}`}
                disabled={!mine || busy || !!card || !!slot.pickedBy}
                onPress={() => void send({ type: 'pick', slot: index })}
                className={`w-28 h-40 rounded-3xl border items-center justify-center p-3 gap-3 ${slot.pickedBy ? 'bg-panel border-slate-700 opacity-60' : 'bg-violet-950 border-violet-400'}`}
              >
                <Text className="text-3xl text-emerald-300">{slot.pickedBy ? '✓' : '🥂'}</Text>
                <Text className="text-violet-200 text-xs text-center font-bold">
                  {slot.card?.title ?? 'CHẠM LY'}
                </Text>
                <Text className="text-slate-400 text-xs">
                  {slot.pickedBy
                    ? room.players.find((p) => p.id === slot.pickedBy)?.name
                    : `#${index + 1}`}
                </Text>
              </Pressable>
            ))}
          </View>
          {card && (
            <Panel>
              <Text className="text-amber-300 font-bold uppercase">
                {categoryLabels[card.category]}
              </Text>
              <Text className="text-white text-3xl font-extrabold">{card.title}</Text>
              <Text className="text-slate-200 text-base leading-7">{card.description}</Text>
              <Text className="text-amber-200 leading-6">{card.penalty}</Text>
              {card.hasTimer && (
                <>
                  <Text className="text-violet-300 text-4xl font-bold text-center">
                    {room.timerEndsAt
                      ? Math.max(0, Math.ceil((room.timerEndsAt - now - offset) / 1000))
                      : card.timerSeconds}
                    s
                  </Text>
                  {mine && !room.timerEndsAt && (
                    <Button
                      title="Bắt đầu đồng hồ chung"
                      secondary
                      disabled={busy}
                      onPress={() => void send({ type: 'timer' })}
                    />
                  )}
                </>
              )}
              {mine ? (
                <>
                  <Copy>
                    Ghi nhận số ngụm của người đang ở lượt. Các luật chỉ định người khác được cả bàn
                    thực hiện trực tiếp.
                  </Copy>
                  <View className="flex-row items-center justify-center gap-5">
                    <Button
                      title="−"
                      secondary
                      disabled={busy || drinks <= 0}
                      onPress={() => setDrinks((v) => v - 1)}
                    />
                    <Text className="text-white text-xl">{drinks} ngụm</Text>
                    <Button
                      title="+"
                      secondary
                      disabled={busy || drinks >= 20}
                      onPress={() => setDrinks((v) => v + 1)}
                    />
                  </View>
                  <Button
                    title="Đã hoàn thành thử thách"
                    disabled={busy}
                    onPress={() => void send({ type: 'complete', drinks, completed: true })}
                  />
                  <Button
                    title="Bỏ qua thử thách · chuyển lượt"
                    secondary
                    disabled={busy}
                    onPress={() => void send({ type: 'complete', drinks, completed: false })}
                  />
                </>
              ) : (
                <Copy>Đang chờ {player?.name} xác nhận kết quả…</Copy>
              )}
            </Panel>
          )}
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
      {room.phase === 'depleted' && host && (
        <Button
          title="Xáo lại toàn bộ bài · tiếp tục"
          disabled={busy}
          onPress={() => void send({ type: 'reshuffle' })}
        />
      )}
      {room.phase === 'ended' && host && (
        <Button
          title="Về phòng chờ · chuẩn bị ván mới"
          disabled={busy}
          onPress={() => void send({ type: 'restart' })}
        />
      )}
      <Panel>
        <Heading>Bảng thành tích</Heading>
        {room.players.map((p) => (
          <View key={p.id} className="flex-row justify-between gap-2">
            <Text className="text-slate-200 flex-1">
              {p.name}
              {!p.active ? ' (đã rời)' : ''}
            </Text>
            <Text className="text-violet-200">
              {p.cardsDrawnCount} lá · {p.drinksTaken} ngụm · {p.challengesCompleted} ✓
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
                </Text>
                <Copy>
                  {entry.skipped
                    ? 'Không cộng thống kê.'
                    : `${entry.drinks} ngụm · ${entry.completed ? 'Hoàn thành' : 'Bỏ thử thách'}`}
                </Copy>
              </View>
            ))
        )}
      </Panel>
    </>
  );
}
