import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { packById, type Action, type Player, type RoomView, type Session } from '@chamly/shared';
import { CardModal } from './CardModal';
import { GameBoard, TurnHint } from './GameBoard';
import { PouchModal } from './PouchModal';
import { TurnAlert } from './TurnAlert';
import { Button, Copy, Heading, Panel } from './ui';

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
  const label = clock(seconds);
  const urgent = seconds <= 60;
  return (
    <View
      className={`rounded-2xl border p-4 gap-1 ${
        urgent ? 'bg-rose-950 border-rose-800' : 'bg-amber-950 border-amber-800'
      }`}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className={`font-bold ${urgent ? 'text-rose-200' : 'text-amber-200'}`}>
          Phòng sẽ tự đóng
        </Text>
        <Text className={`text-2xl font-black ${urgent ? 'text-rose-200' : 'text-amber-200'}`}>
          {label}
        </Text>
      </View>
      <Text className={`text-sm leading-6 ${urgent ? 'text-rose-100' : 'text-amber-100'}`}>
        Phòng chỉ có một người nên chỉ được giữ 10 phút để tiết kiệm tài nguyên. Khi có người thứ
        hai vào, đồng hồ dừng lại. Hết giờ, phòng bị xóa và bạn được đưa về sảnh.
      </Text>
    </View>
  );
}

/**
 * Màn hình phòng chia ba tầng cố định: thông tin phòng ở trên, hành động ở dưới, chỉ khối
 * giữa cuộn. Giữ nút hành động luôn trong tầm tay trên cả web lẫn điện thoại.
 */
export function RoomScreen({
  room,
  session,
  busy,
  locked,
  disconnected,
  everyoneReady,
  onOpenDeck,
  send,
}: {
  room: RoomView;
  session: Session;
  busy: boolean;
  locked: boolean;
  disconnected: Player[];
  everyoneReady: boolean;
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
  const [pouchOpen, setPouchOpen] = useState(false);
  const countdown = useExpiryCountdown(room);
  const solo = seated.length <= 1;
  return (
    <View className="flex-1 w-full self-center" style={{ maxWidth: 430 }}>
      {/* Header giữ ở mức thấp nhất có thể khi đang chơi: một dòng nhận dạng phòng, một dòng
          trạng thái lượt kèm người chơi. Mọi thứ còn lại nằm trong vùng cuộn. */}
      <View className="border-b border-slate-700 px-3 pb-2 pt-1.5 gap-1.5">
        <View className="flex-row items-center justify-between gap-2">
          <Text numberOfLines={1} className="text-slate-400 text-xs flex-1">
            <Text
              selectable
              accessibilityLabel={`Mã phòng ${room.id}`}
              className="text-violet-300 font-bold"
            >
              #{room.id}
            </Text>{' '}
            · {room.name} · {pack.icon}
          </Text>
          <Text className="text-violet-300 text-xs font-bold">
            {lobby ? `${seated.length}/12 người` : `V${room.round} · ${room.remainingCount} lá`}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {room.phase === 'playing' && (
            <TurnAlert
              active={mine}
              label={mine ? 'Đến lượt bạn!' : `Lượt của ${current?.name ?? '…'}`}
            />
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingRight: 6 }}
          >
            {seated.map((p) => (
              <View key={p.id} className="bg-night rounded-full px-2 py-1">
                <Text className="text-slate-300 text-xs">
                  {p.online ? '🟢' : '⚪'} {p.name}
                  {p.id === room.hostId ? ' 👑' : ''}
                  {p.id === session.playerId ? ' (bạn)' : ''}
                  {(p.pouch?.length ?? 0) > 0 ? ` 🎒${p.pouch.length}` : ''}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {solo && <Countdown seconds={countdown} />}
        {lobby ? (
          <>
            <Panel>
              <Heading>Sẵn sàng cho một ván mới?</Heading>
              <Copy>
                Chủ đề {pack.name}: {pack.tagline} Thứ tự lượt theo thứ tự vào phòng. Bộ bài riêng
                có {room.deck.length} lá. Sau khi bắt đầu, danh sách người chơi và bộ bài được khóa
                đối với người mới.
              </Copy>
              <Copy>Chia sẻ mã phòng và mật khẩu cho bạn bè để cùng vào.</Copy>
            </Panel>
            {disconnected.length > 0 && (
              <View className="bg-amber-950 border border-amber-800 rounded-2xl p-4 gap-1">
                <Text className="text-amber-200 font-bold">Chưa sẵn sàng</Text>
                <Text className="text-amber-100 text-sm leading-6">
                  {disconnected.map((p) => p.name).join(', ')} đang mất kết nối. Ván chỉ bắt đầu khi
                  tất cả người trong phòng đều trực tuyến.
                </Text>
              </View>
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
        <Copy>
          Chủ phòng rời đi: quyền được chuyển cho thành viên tiếp theo. Khi mất mạng, chỗ ngồi được
          giữ tối đa 30 phút nếu cả phòng đều offline; chủ phòng có thể bỏ lượt đang chờ. Phòng
          không còn thành viên sẽ được xóa ngay.
        </Copy>
      </ScrollView>

      <View className="border-t border-slate-700 bg-night px-4 pb-2 pt-3 gap-3">
        {lobby ? (
          <>
            <Button
              title={
                host
                  ? `Chỉnh bộ bài · ${room.deck.length} lá`
                  : `Xem bộ bài · ${room.deck.length} lá`
              }
              secondary
              disabled={locked}
              onPress={onOpenDeck}
            />
            {host ? (
              everyoneReady ? (
                <Button
                  title="Bắt đầu ván chơi"
                  disabled={locked}
                  onPress={() => void send({ type: 'start' })}
                />
              ) : (
                <Copy>
                  {seated.length < 2
                    ? 'Cần ít nhất 2 người trong phòng để bắt đầu.'
                    : 'Nút bắt đầu hiện lại khi mọi người đã trực tuyến.'}
                </Copy>
              )
            ) : (
              <Copy>Đang chờ chủ phòng bắt đầu…</Copy>
            )}
            <Button
              title="Rời phòng"
              secondary
              disabled={locked}
              onPress={() => void send({ type: 'leave' })}
            />
          </>
        ) : (
          <>
            <TurnHint room={room} playerId={session.playerId} />
            <View className="flex-row gap-3">
              {host && room.phase !== 'ended' && (
                <View className="flex-1">
                  <Button
                    title="Kết thúc ván"
                    danger
                    disabled={locked}
                    onPress={() => void send({ type: 'end' })}
                  />
                </View>
              )}
              <View className="flex-1">
                <Button
                  title="Rời phòng"
                  secondary
                  disabled={locked}
                  onPress={() => void send({ type: 'leave' })}
                />
              </View>
            </View>
          </>
        )}
      </View>
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
      {pouchOpen && (
        <PouchModal
          cards={pouch}
          canUse={mine && !card && room.phase === 'playing'}
          busy={locked}
          onClose={() => setPouchOpen(false)}
          send={send}
        />
      )}
    </View>
  );
}
