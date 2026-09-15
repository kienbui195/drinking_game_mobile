import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Socket } from 'socket.io-client';
import { packById, type AdminOverview, type AdminRoom } from '@chamly/shared';
import { request } from './connection';
import { Button, Copy, Field, Heading, Panel } from './ui';

const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="flex-1 bg-panel border border-slate-700 rounded-2xl p-3 gap-0.5 min-w-28">
      <Text className="text-violet-300 text-2xl font-black">{value}</Text>
      <Text className="text-slate-400 text-xs">{label}</Text>
    </View>
  );
}

function RoomCard({
  room,
  now,
  busy,
  onAction,
}: {
  room: AdminRoom;
  now: number;
  busy: boolean;
  onAction: (event: string, body: Record<string, unknown>) => void;
}) {
  const [rename, setRename] = useState('');
  const [open, setOpen] = useState(false);
  const pack = packById(room.packId);
  const activePlayers = room.players.filter((p) => p.active);
  return (
    <Panel>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-violet-300 text-xs font-bold tracking-widest">#{room.id}</Text>
          <Heading>{room.name}</Heading>
          <Copy>
            {pack.icon} {pack.name} · {room.phase} · vòng {room.round} · {room.remainingCount}/
            {room.deckSize} lá · còn {clock(room.expiresAt - now)}
          </Copy>
        </View>
        <Text className="text-slate-300 text-sm">{activePlayers.length}/12</Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {activePlayers.map((p) => (
          <View key={p.id} className="bg-night rounded-full px-2 py-1">
            <Text className="text-slate-300 text-xs">
              {p.online ? '🟢' : '⚪'} {p.name}
              {p.id === room.hostId ? ' 👑' : ''}
              {p.pouch > 0 ? ` 🎒${p.pouch}` : ''}
            </Text>
          </View>
        ))}
      </View>
      {open ? (
        <>
          <Field
            label={`Đổi tên phòng ${room.id}`}
            maxLength={60}
            value={rename}
            onChangeText={setRename}
            placeholder={room.name}
          />
          <Button
            title={`Lưu tên phòng ${room.id}`}
            secondary
            disabled={busy || !rename.trim()}
            onPress={() => {
              onAction('admin:renameRoom', { roomId: room.id, name: rename.trim() });
              setRename('');
            }}
          />
          <Text className="text-slate-400 text-xs">Đuổi người chơi khỏi phòng:</Text>
          {activePlayers.map((p) => (
            <Button
              key={p.id}
              title={`Kick ${p.name}`}
              secondary
              disabled={busy}
              onPress={() => onAction('admin:kickPlayer', { roomId: room.id, playerId: p.id })}
            />
          ))}
          {room.phase !== 'ended' && room.phase !== 'lobby' && (
            <Button
              title={`Buộc kết thúc ván ${room.id}`}
              secondary
              disabled={busy}
              onPress={() => onAction('admin:endGame', { roomId: room.id })}
            />
          )}
          <Button
            title={`Xóa phòng ${room.id}`}
            danger
            disabled={busy}
            onPress={() => onAction('admin:deleteRoom', { roomId: room.id })}
          />
          <Button title={`Thu gọn ${room.id}`} secondary onPress={() => setOpen(false)} />
        </>
      ) : (
        <Button title={`Quản lý phòng ${room.id}`} secondary onPress={() => setOpen(true)} />
      )}
    </Panel>
  );
}

/**
 * Bảng điều khiển quản trị. Mọi quyền được cấp ở phía server cho đúng kết nối đã xác thực,
 * nên màn hình này chỉ hiển thị dữ liệu và gửi lệnh, không tự quyết định quyền.
 */
export function AdminDashboard({ socket, onExit }: { socket: Socket; onExit: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    try {
      setData(await request<AdminOverview>(socket, 'admin:overview'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
    }
  }, [socket]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 5000);
    return () => clearInterval(t);
  }, [auto, load]);
  async function act(event: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await request(socket, event, body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại.');
    } finally {
      setBusy(false);
    }
  }
  const rooms = data?.rooms ?? [];
  const playing = rooms.filter((r) => r.phase === 'playing').length;
  const seated = rooms.reduce((sum, r) => sum + r.players.filter((p) => p.active).length, 0);
  return (
    <View className="flex-1 w-full self-center" style={{ maxWidth: 560 }}>
      <View className="border-b border-slate-700 px-4 pb-3 pt-2 gap-1">
        <View className="flex-row items-center justify-between gap-3">
          <Heading>🛠️ Bảng điều khiển</Heading>
          <Text className={`text-xs ${auto ? 'text-emerald-300' : 'text-slate-500'}`}>
            {auto ? '● Tự làm mới 5s' : '○ Đang tạm dừng'}
          </Text>
        </View>
        <Copy>Dữ liệu lấy trực tiếp từ server. Mọi thao tác có hiệu lực ngay với người chơi.</Copy>
      </View>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {!!error && (
          <View
            accessibilityRole="alert"
            className="bg-rose-950 border border-rose-800 rounded-2xl p-4 gap-3"
          >
            <Text className="text-rose-200">{error}</Text>
            <Button title="Đóng thông báo" secondary onPress={() => setError('')} />
          </View>
        )}
        <View className="flex-row flex-wrap gap-3">
          <Stat label="Kết nối đang mở" value={data?.connections ?? '—'} />
          <Stat label="Người đang online" value={data?.onlinePlayers ?? '—'} />
          <Stat label="Phòng đang có" value={rooms.length} />
        </View>
        <View className="flex-row flex-wrap gap-3">
          <Stat label="Phòng đang chơi" value={playing} />
          <Stat label="Người trong phòng" value={seated} />
          <Stat label="Phiên còn hiệu lực" value={data?.sessions ?? '—'} />
        </View>

        <Panel>
          <Heading>Chủ đề đang được chơi</Heading>
          {(data?.packUsage.length ?? 0) === 0 ? (
            <Copy>Chưa có phòng nào.</Copy>
          ) : (
            data?.packUsage.map((u) => (
              <View key={u.packId} className="flex-row items-center justify-between gap-3">
                <Text className="text-slate-200 flex-1">
                  {packById(u.packId).icon} {packById(u.packId).name}
                </Text>
                <Text className="text-violet-200">
                  {u.rooms} phòng · {u.players} người
                </Text>
              </View>
            ))
          )}
        </Panel>

        <Panel>
          <Heading>Thông báo tới toàn bộ người chơi</Heading>
          <Copy>Tin nhắn hiện ngay trên màn hình của mọi người đang kết nối.</Copy>
          <Field
            label="Nội dung thông báo"
            maxLength={300}
            value={notice}
            onChangeText={setNotice}
            placeholder="Server sẽ bảo trì sau 10 phút nữa."
          />
          <Button
            title="Gửi thông báo"
            disabled={busy || !notice.trim()}
            onPress={async () => {
              await act('admin:notice', { message: notice.trim() });
              setNotice('');
            }}
          />
        </Panel>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button title="Làm mới ngay" secondary disabled={busy} onPress={() => void load()} />
          </View>
          <View className="flex-1">
            <Button
              title={auto ? 'Tạm dừng tự làm mới' : 'Bật tự làm mới'}
              secondary
              onPress={() => setAuto((v) => !v)}
            />
          </View>
        </View>
        <Button
          title="Dọn phòng đã hết hạn"
          secondary
          disabled={busy}
          onPress={() => void act('admin:prune')}
        />

        <Heading>Danh sách phòng ({rooms.length})</Heading>
        {rooms.length === 0 ? (
          <Copy>Chưa có phòng nào đang hoạt động.</Copy>
        ) : (
          rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              now={now}
              busy={busy}
              onAction={(event, body) => void act(event, body)}
            />
          ))
        )}
      </ScrollView>
      <View className="border-t border-slate-700 px-4 pb-2 pt-3">
        <Button title="Thoát trang quản trị" secondary onPress={onExit} />
      </View>
    </View>
  );
}
