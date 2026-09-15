import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import type { Socket } from 'socket.io-client';
import type { Action, Card, RoomSummary, RoomView, Session } from '@chamly/shared';
import { apiUrl, connect, loadSession, request, RequestError, saveSession } from './connection';
import { Button, Copy, Field, Heading, Panel } from './ui';
import { DeckEditor } from './DeckEditor';
import { GameBoard } from './GameBoard';

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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editor, setEditor] = useState<{
    cards: Card[];
    revision: number;
    editable: boolean;
  } | null>(null);
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
      const next = await request<RoomView>(
        socketRef.current,
        event,
        event === 'room:create'
          ? { name: roomName, password, requestId: createId.current }
          : { roomId: code, password },
      );
      await remember({ ...sessionRef.current, roomId: next.id });
      accept(next);
      setPassword('');
      createId.current = Crypto.randomUUID();
    });
  }
  const locked = busy || !online;
  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-night">
        <StatusBar style="light" />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            alignItems: 'center',
            padding: 20,
            paddingBottom: 48,
          }}
        >
          <View className="w-full max-w-3xl gap-5">
            <View className="flex-row items-center justify-between py-3">
              <View>
                <Text className="text-violet-300 text-xs tracking-widest font-bold">
                  GOOD FRIENDS. GREAT STORIES.
                </Text>
                <Text className="text-white text-4xl font-black mt-2">
                  Chạm Ly <Text className="text-3xl">🥂</Text>
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
                <View className="py-8 gap-4">
                  <Text className="text-white text-4xl font-bold leading-tight">
                    Một phòng chơi.{'\n'}Cả hội cùng vui.
                  </Text>
                  <Copy>
                    Mỗi người một chiếc điện thoại. Cùng vào phòng, chọn bài và tạo những câu chuyện
                    đáng nhớ.
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
                <View className="flex-row items-center justify-between">
                  <Heading>Xin chào, {session.name} 👋</Heading>
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
                    <View className="flex-row items-center justify-between">
                      <Heading>Các phòng hiện tại</Heading>
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
                          #{r.id} · {r.playerCount}/12 người ·{' '}
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
                      <Field
                        label="Tên phòng"
                        maxLength={60}
                        value={roomName}
                        onChangeText={setRoomName}
                        placeholder="Hội bạn cuối tuần"
                      />
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
            ) : (
              <>
                <Panel>
                  <Text selectable className="text-violet-300 font-bold tracking-widest">
                    PHÒNG #{room.id}
                  </Text>
                  <Heading>{room.name}</Heading>
                  <Copy>Chia sẻ mã phòng và mật khẩu cho bạn bè · {room.playerCount}/12 người</Copy>
                  <View className="flex-row flex-wrap gap-2">
                    {room.players
                      .filter((p) => p.active)
                      .map((p) => (
                        <View key={p.id} className="bg-night rounded-full px-3 py-2">
                          <Text className="text-slate-200 text-sm">
                            {p.online ? '🟢' : '⚪'} {p.name}
                            {p.id === room.hostId ? ' 👑' : ''}
                            {p.id === session.playerId ? ' (bạn)' : ''}
                          </Text>
                        </View>
                      ))}
                  </View>
                </Panel>
                {room.phase === 'lobby' ? (
                  <Panel>
                    <Heading>Sẵn sàng cho một ván mới?</Heading>
                    <Copy>
                      Thứ tự lượt theo thứ tự vào phòng. Bộ bài riêng có {room.deck.length} lá. Sau
                      khi bắt đầu, danh sách người chơi và bộ bài được khóa đối với người mới.
                    </Copy>
                    <Button
                      title={
                        room.hostId === session.playerId
                          ? `Chỉnh bộ bài · ${room.deck.length} lá`
                          : `Xem bộ bài · ${room.deck.length} lá`
                      }
                      secondary
                      disabled={locked}
                      onPress={() =>
                        setEditor({
                          cards: room.deck,
                          revision: room.revision,
                          editable: room.hostId === session.playerId,
                        })
                      }
                    />
                    {room.hostId === session.playerId ? (
                      <Button
                        title="Bắt đầu ván chơi"
                        disabled={locked || room.playerCount < 2}
                        onPress={() => void send({ type: 'start' })}
                      />
                    ) : (
                      <Copy>Đang chờ chủ phòng bắt đầu…</Copy>
                    )}
                  </Panel>
                ) : (
                  <GameBoard room={room} playerId={session.playerId} busy={locked} send={send} />
                )}
                {room.hostId === session.playerId &&
                  room.phase !== 'ended' &&
                  room.phase !== 'lobby' && (
                    <Button
                      title="Kết thúc ván"
                      danger
                      disabled={locked}
                      onPress={() => void send({ type: 'end' })}
                    />
                  )}
                <Button
                  title="Rời phòng"
                  secondary
                  disabled={locked}
                  onPress={() => void send({ type: 'leave' })}
                />
                <Copy>
                  Chủ phòng rời đi: quyền được chuyển cho thành viên tiếp theo. Khi mất mạng, chỗ
                  ngồi được giữ; chủ phòng có thể bỏ lượt đang chờ.
                </Copy>
              </>
            )}
            <Text className="text-slate-600 text-xs text-center mt-5">
              CHẠM LY · MỘT KẾT NỐI, NHIỀU CÂU CHUYỆN
            </Text>
          </View>
        </ScrollView>
        {editor && (
          <DeckEditor
            cards={editor.cards}
            editable={editor.editable}
            onClose={() => setEditor(null)}
            onSave={(cards) => send({ type: 'saveDeck', cards }, editor.revision)}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
