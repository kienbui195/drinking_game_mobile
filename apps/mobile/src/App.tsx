import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import type { Socket } from 'socket.io-client';
import {
  defaultPackId,
  packById,
  packs,
  type Action,
  type Card,
  type RoomSummary,
  type RoomView,
  type Session,
} from '@chamly/shared';
import { apiUrl, connect, loadSession, request, RequestError, saveSession } from './connection';
import { Button, Copy, Field, Heading, Panel } from './ui';
import { DeckEditor } from './DeckEditor';
import { AdminDashboard } from './AdminDashboard';
import { PausedNotice } from './PausedNotice';
import { RoomScreen } from './RoomScreen';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'list' | 'create' | 'join'>('list');
  const [packId, setPackId] = useState(defaultPackId);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editor, setEditor] = useState<{
    cards: Card[];
    revision: number;
    editable: boolean;
  } | null>(null);
  const [resumedDespiteOffline, setResumedDespiteOffline] = useState('');
  const createId = useRef(Crypto.randomUUID());
  const accept = useCallback((next: RoomView) => {
    if (roomRef.current?.id === next.id && roomRef.current.revision > next.revision) return;
    roomRef.current = next;
    setRoom(next);
  }, []);
  const remember = useCallback(async (value: Session | null) => {
    await saveSession(value);
    sessionRef.current = value;
    setSession(value);
  }, []);
  const forgetRoom = useCallback(() => {
    setMode('list');
    roomRef.current = null;
    setRoom(null);
    setEditor(null);
    if (sessionRef.current)
      void remember({ ...sessionRef.current, roomId: undefined }).catch((e) => setError(String(e)));
  }, [remember]);
  useEffect(() => {
    void loadSession()
      .then((s) => {
        sessionRef.current = s;
        setSession(s);
        setName(s?.name ?? '');
      })
      .catch(() => setError('Không đọc được bộ nhớ máy.'))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!session?.token) return;
    const socket = connect(session.token);
    socketRef.current = socket;
    const sync = async () => {
      if (sessionRef.current?.roomId) {
        try {
          accept(
            await request<RoomView>(socket, 'room:sync', { roomId: sessionRef.current.roomId }),
          );
        } catch (e) {
          if (e instanceof RequestError && ['ROOM_NOT_FOUND', 'NOT_MEMBER'].includes(e.code))
            forgetRoom();
          setError(e instanceof Error ? e.message : 'Không đồng bộ được phòng.');
        }
      } else {
        try {
          setRooms(await request<RoomSummary[]>(socket, 'rooms:list'));
        } catch {
          /* Connection status already shown. */
        }
      }
    };
    socket.on('connect', () => {
      setOnline(true);
      void sync();
    });
    socket.on('disconnect', () => setOnline(false));
    socket.on('connect_error', (e) => {
      setOnline(false);
      setError(
        e.message === 'UNAUTHORIZED'
          ? 'Phiên đã hết hạn. Hãy đăng xuất và nhập lại tên.'
          : `Không kết nối được ${apiUrl}. Kiểm tra server và mạng.`,
      );
    });
    socket.on('room:state', (next: RoomView) => {
      if (next.id !== sessionRef.current?.roomId) return;
      if (!next.players.some((p) => p.id === sessionRef.current?.playerId && p.active)) {
        forgetRoom();
        return;
      }
      accept(next);
    });
    socket.on('server:notice', (message: string) => setError(`📢 ${message}`));
    socket.on('room:left', forgetRoom);
    socket.on('room:expired', () => {
      forgetRoom();
      setError('Phòng đã hết hạn.');
    });
    socket.connect();
    // Periodic snapshots recover missed broadcasts, including commit-before-crash windows.
    const timer = setInterval(() => {
      if (socket.connected) void sync();
    }, 15_000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && socket.connected) void sync();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.token, accept, forgetRoom]);
  async function work(action: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được thao tác.');
      if (socketRef.current?.connected && sessionRef.current?.roomId) {
        try {
          accept(
            await request<RoomView>(socketRef.current, 'room:sync', {
              roomId: sessionRef.current.roomId,
            }),
          );
        } catch {
          /* Show original error. */
        }
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function send(action: Action, revision = roomRef.current?.revision): Promise<boolean> {
    return work(async () => {
      if (!socketRef.current || !roomRef.current || revision === undefined)
        throw new Error('Chưa vào phòng.');
      const next = await request<RoomView>(socketRef.current, 'room:command', {
        roomId: roomRef.current.id,
        revision,
        requestId: Crypto.randomUUID(),
        action,
      });
      if (action.type === 'leave') forgetRoom();
      else accept(next);
    });
  }
  async function enter(event: 'room:create' | 'room:join') {
    await work(async () => {
      if (!socketRef.current || !sessionRef.current) throw new Error('Chưa kết nối.');
      const next = await request<RoomView | { admin: true }>(
        socketRef.current,
        event,
        event === 'room:create'
          ? { name: roomName, password, requestId: createId.current, packId }
          : { roomId: code, password },
      );
      // Cổng quản trị: server trả về quyền thay vì một phòng chơi.
      if ('admin' in next) {
        setAdmin(true);
        setPassword('');
        setMode('list');
        return;
      }
      await remember({ ...sessionRef.current, roomId: next.id });
      accept(next);
      setPassword('');
      createId.current = Crypto.randomUUID();
    });
  }
  // `online` của từng người chơi do server suy ra từ socket đang ở trong room, nên danh sách
  // này cập nhật ngay khi có người rớt mạng hoặc quay lại.
  const seated = room?.players.filter((p) => p.active) ?? [];
  const disconnected = seated.filter((p) => !p.online);
  const disconnectedKey = disconnected
    .map((p) => p.id)
    .sort()
    .join(',');
  const everyoneReady = seated.length >= 2 && disconnected.length === 0;
  useEffect(() => {
    // Quyết định "vẫn tiếp tục" chỉ áp dụng cho đúng nhóm người đang mất kết nối lúc đó.
    setResumedDespiteOffline((old) => (old === disconnectedKey ? old : ''));
  }, [disconnectedKey]);
  const paused =
    !!room &&
    online &&
    room.phase !== 'lobby' &&
    room.phase !== 'ended' &&
    disconnected.length > 0 &&
    resumedDespiteOffline !== disconnectedKey;
  const locked = busy || !online || paused;
  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-night">
        <StatusBar style="light" />
        {session && admin ? (
          <AdminDashboard socket={socketRef.current!} onExit={() => setAdmin(false)} />
        ) : session && room ? (
          <RoomScreen
            room={room}
            session={session}
            busy={busy}
            locked={locked}
            disconnected={disconnected}
            everyoneReady={everyoneReady}
            error={error}
            onDismissError={() => setError('')}
            onOpenDeck={() =>
              setEditor({
                cards: room.deck,
                revision: room.revision,
                editable: room.hostId === session.playerId,
              })
            }
            send={send}
          />
        ) : (
          <ScrollView
            className="w-full self-center"
            style={{ maxWidth: 430 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              flexGrow: 1,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 32,
            }}
          >
            <View className="w-full gap-4">
              <View className="flex-row items-center justify-between py-2 gap-3">
                <View className="flex-1">
                  <Text className="text-violet-300 text-xs tracking-widest font-bold">
                    GOOD FRIENDS. GREAT STORIES.
                  </Text>
                  <Text className="text-white text-3xl font-black mt-1">
                    Chạm Ly <Text className="text-2xl">🥂</Text>
                  </Text>
                </View>
                {session && (
                  <Text className={`text-xs ${online ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {online ? '● Trực tuyến' : '○ Đang kết nối'}
                  </Text>
                )}
              </View>
              {!!error && (
                <View
                  accessibilityRole="alert"
                  className="bg-rose-950 border border-rose-800 rounded-2xl p-4 gap-3"
                >
                  <Text className="text-rose-200">{error}</Text>
                  <Button title="Đóng thông báo" secondary onPress={() => setError('')} />
                </View>
              )}
              {!ready ? (
                <Copy>Đang khôi phục phiên…</Copy>
              ) : !session ? (
                <>
                  <View className="py-5 gap-3">
                    <Text className="text-white text-3xl font-bold leading-tight">
                      Một phòng chơi.{'\n'}Cả hội cùng vui.
                    </Text>
                    <Copy>
                      Mỗi người một chiếc điện thoại. Cùng vào phòng, chọn bài và tạo những câu
                      chuyện đáng nhớ.
                    </Copy>
                  </View>
                  <Panel>
                    <Heading>Bắt đầu với tên của bạn</Heading>
                    <Field
                      label="Tên người chơi"
                      placeholder="Mọi người gọi bạn là gì?"
                      value={name}
                      maxLength={30}
                      onChangeText={setName}
                    />
                    <Button
                      title="Vào sảnh →"
                      busy={busy}
                      disabled={!name.trim()}
                      onPress={() =>
                        void work(async () => {
                          const response = await fetch(`${apiUrl}/sessions`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name }),
                            signal: AbortSignal.timeout(12_000),
                          });
                          if (!response.ok)
                            throw new Error(
                              'Không tạo được phiên. Tên cần 1–30 ký tự; nếu thao tác nhiều hãy chờ một phút.',
                            );
                          await remember(await response.json());
                        })
                      }
                    />
                  </Panel>
                  <Copy>Không cần tài khoản. Tên và phiên được ghi nhớ trên thiết bị này.</Copy>
                </>
              ) : !room ? (
                <>
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1">
                      <Heading>Xin chào, {session.name} 👋</Heading>
                    </View>
                    <Button
                      title="Đổi tên"
                      secondary
                      disabled={busy}
                      onPress={() => void work(() => remember(null))}
                    />
                  </View>
                  {session.roomId && (
                    <Panel>
                      <Copy>Đang khôi phục phòng {session.roomId}…</Copy>
                      <Button
                        title="Về sảnh (giữ chỗ trong phòng cũ)"
                        secondary
                        onPress={forgetRoom}
                      />
                    </Panel>
                  )}
                  {mode === 'list' ? (
                    <>
                      <Panel>
                        <Heading>Hôm nay chơi cùng ai?</Heading>
                        <Copy>Tạo phòng có mật khẩu hoặc nhập mã để tham gia cùng bạn bè.</Copy>
                        <Button
                          title="+ Tạo phòng mới"
                          disabled={locked}
                          onPress={() => {
                            setMode('create');
                            setPassword('');
                            createId.current = Crypto.randomUUID();
                          }}
                        />
                        <Button
                          title="Nhập mã phòng"
                          secondary
                          disabled={locked}
                          onPress={() => {
                            setMode('join');
                            setPassword('');
                          }}
                        />
                      </Panel>
                      <View className="flex-row items-center justify-between gap-3">
                        <View className="flex-1">
                          <Heading>Các phòng hiện tại</Heading>
                        </View>
                        <Button
                          title="Làm mới"
                          secondary
                          disabled={locked}
                          onPress={() =>
                            void work(async () =>
                              setRooms(
                                await request<RoomSummary[]>(socketRef.current!, 'rooms:list'),
                              ),
                            )
                          }
                        />
                      </View>
                      {rooms.length === 0 && <Copy>Chưa có phòng nào. Hãy mở bàn đầu tiên!</Copy>}
                      {rooms.map((r) => (
                        <Panel key={r.id}>
                          <Heading>{r.name}</Heading>
                          <Copy>
                            {packById(r.packId).icon} {packById(r.packId).name} · #{r.id} ·{' '}
                            {r.playerCount}/12 người ·{' '}
                            {r.phase === 'lobby' ? 'Đang chờ' : 'Đã bắt đầu'}
                          </Copy>
                          <Button
                            title={`Vào phòng ${r.id}`}
                            secondary
                            disabled={locked || r.phase !== 'lobby' || r.playerCount >= 12}
                            onPress={() => {
                              setCode(r.id);
                              setPassword('');
                              setMode('join');
                            }}
                          />
                        </Panel>
                      ))}
                    </>
                  ) : (
                    <Panel>
                      <Heading>
                        {mode === 'create' ? 'Mở một bàn mới' : 'Tham gia cùng cả hội'}
                      </Heading>
                      {mode === 'create' ? (
                        <>
                          <Field
                            label="Tên phòng"
                            maxLength={60}
                            value={roomName}
                            onChangeText={setRoomName}
                            placeholder="Hội bạn cuối tuần"
                          />
                          <Text className="text-slate-300 text-sm font-semibold">
                            Chủ đề bộ bài
                          </Text>
                          <View className="gap-2">
                            {packs.map((pack) => (
                              <Pressable
                                key={pack.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Chủ đề ${pack.name}`}
                                aria-selected={packId === pack.id}
                                onPress={() => setPackId(pack.id)}
                                className={`rounded-2xl border p-3 gap-0.5 ${
                                  packId === pack.id
                                    ? 'bg-violet-900 border-violet-300'
                                    : 'bg-night border-slate-700'
                                }`}
                              >
                                <Text className="text-white font-bold">
                                  {pack.icon} {pack.name}
                                </Text>
                                <Text className="text-slate-400 text-xs leading-5">
                                  {pack.tagline}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </>
                      ) : (
                        <Field
                          label="Mã phòng (6 ký tự)"
                          maxLength={6}
                          autoCapitalize="characters"
                          value={code}
                          onChangeText={(v) => setCode(v.toUpperCase())}
                          placeholder="A1B2C3"
                        />
                      )}
                      <Field
                        label="Mật khẩu phòng (ít nhất 4 ký tự)"
                        secureTextEntry
                        maxLength={128}
                        value={password}
                        onChangeText={setPassword}
                      />
                      <Button
                        title={mode === 'create' ? 'Tạo phòng' : 'Tham gia phòng'}
                        disabled={
                          locked ||
                          password.length < 4 ||
                          (mode === 'create' ? !roomName.trim() : code.length !== 6)
                        }
                        busy={busy}
                        onPress={() => void enter(mode === 'create' ? 'room:create' : 'room:join')}
                      />
                      <Button
                        title="Quay lại sảnh"
                        secondary
                        disabled={busy}
                        onPress={() => setMode('list')}
                      />
                    </Panel>
                  )}
                  <Copy>Server: {apiUrl}</Copy>
                </>
              ) : null}
              <Text className="text-slate-600 text-xs text-center mt-5">
                CHẠM LY · MỘT KẾT NỐI, NHIỀU CÂU CHUYỆN
              </Text>
            </View>
          </ScrollView>
        )}
        {paused && (
          <PausedNotice
            names={disconnected.map((p) => p.name)}
            host={room?.hostId === session?.playerId}
            onContinue={() => setResumedDespiteOffline(disconnectedKey)}
          />
        )}
        {editor && (
          <DeckEditor
            cards={editor.cards}
            editable={editor.editable}
            packId={room?.packId ?? defaultPackId}
            onClose={() => setEditor(null)}
            onSave={(cards) => send({ type: 'saveDeck', cards }, editor.revision)}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
