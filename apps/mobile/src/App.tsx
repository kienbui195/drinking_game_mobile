import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Socket } from 'socket.io-client';
import {
  defaultPackId,
  packById,
  packs,
  type Action,
  type Card,
  type OwnedDeck,
  type Profile,
  type RoomSummary,
  type RoomView,
  type Session,
} from '@chamly/shared';
import { apiUrl, connect, loadSession, request, RequestError, saveSession } from './connection';
import { Button, Copy, Field, Heading, IconButton, Panel } from './ui';
import { Toast } from './Toast';
import { DeckEditor } from './DeckEditor';
import { AdminDashboard } from './AdminDashboard';
import { PausedNotice } from './PausedNotice';
import { RoomScreen } from './RoomScreen';

// Request IDs need UUID syntax for server idempotency, but web pages served over HTTP do not expose
// crypto.randomUUID(). These IDs are not authentication secrets.
const newId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (part) => {
    const value = Math.floor(Math.random() * 16);
    return (part === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [showAllRooms, setShowAllRooms] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'choose' | 'register' | 'login'>('choose');
  const [mode, setMode] = useState<'list' | 'create' | 'join' | 'profile' | 'decks'>('list');
  const [packId, setPackId] = useState(defaultPackId);
  const [decks, setDecks] = useState<OwnedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [deckName, setDeckName] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  // Thông báo từ admin hiện dạng toast nổi, tách khỏi banner lỗi để dễ theo dõi.
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  // Toast lỗi tự ẩn sau 5s như toast thường; tin mới sẽ hẹn lại từ đầu.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(t);
  }, [error]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editor, setEditor] = useState<{
    cards: Card[];
    revision: number;
    editable: boolean;
    deckId?: string;
    packId?: string;
  } | null>(null);
  const [resumedDespiteOffline, setResumedDespiteOffline] = useState('');
  const createId = useRef(newId());
  const scrollRef = useRef<ScrollView>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
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
        setDisplayName(s?.name ?? '');
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
      void request<Profile>(socket, 'profile:get')
        .then(setProfile)
        .catch(() => setProfile(null));
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
    socket.on('server:notice', (message: string) => showNotice(`📢 ${message}`));
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
  }, [session?.token, accept, forgetRoom, showNotice]);
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
        requestId: newId(),
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
          ? {
              name: roomName,
              password,
              requestId: createId.current,
              packId,
              ...(selectedDeckId ? { deckId: selectedDeckId } : {}),
            }
          : { roomId: code, password },
      );
      await remember({ ...sessionRef.current, roomId: next.id });
      accept(next);
      setPassword('');
      createId.current = newId();
    });
  }
  useEffect(() => {
    if (
      !session?.username ||
      !socketRef.current?.connected ||
      (mode !== 'create' && mode !== 'decks')
    )
      return;
    void request<OwnedDeck[]>(socketRef.current, 'decks:list', { packId })
      .then((next) => {
        setDecks(next);
        setSelectedDeckId((selected) =>
          next.some((deck) => deck.id === selected) ? selected : '',
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được bộ bài.'));
  }, [mode, packId, session?.username, online]);
  async function refreshProfile() {
    if (!socketRef.current) throw new Error('Chưa kết nối.');
    setProfile(await request<Profile>(socketRef.current, 'profile:get'));
  }
  async function refreshDecks(nextPackId = packId) {
    if (!socketRef.current) throw new Error('Chưa kết nối.');
    const next = await request<OwnedDeck[]>(socketRef.current, 'decks:list', {
      packId: nextPackId,
    });
    setDecks(next);
    setSelectedDeckId((selected) => (next.some((deck) => deck.id === selected) ? selected : ''));
    await refreshProfile();
  }
  async function authenticate(path: 'register' | 'login') {
    const response = await fetch(`${apiUrl}/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        path === 'register' ? { displayName, password } : { username, password },
      ),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? 'Không thể xác thực. Hãy kiểm tra thông tin và thử lại.');
    }
    await remember(await response.json());
    setPassword('');
  }
  async function exitAdmin() {
    try {
      if (socketRef.current?.connected) await request(socketRef.current, 'auth:logout');
    } catch {
      /* Phiên admin hết hạn thì chỉ cần xóa ở máy. */
    }
    await remember(null);
    setProfile(null);
    setMode('list');
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
        {session?.isAdmin ? (
          <AdminDashboard socket={socketRef.current!} onExit={() => void work(exitAdmin)} />
        ) : session && room ? (
          <RoomScreen
            room={room}
            session={session}
            busy={busy}
            locked={locked}
            disconnected={disconnected}
            everyoneReady={everyoneReady}
            onOpenDeck={() =>
              setEditor({
                cards: room.deck,
                revision: room.revision,
                editable: room.hostId === session.playerId,
                packId: room.packId,
              })
            }
            send={send}
          />
        ) : (
          <View className="flex-1 w-full self-center" style={{ maxWidth: 430 }}>
            <ScrollView
              ref={scrollRef}
              className="w-full self-center"
              style={{ maxWidth: 430 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onScroll={(e) => setShowScrollTop(e.nativeEvent.contentOffset.y > 400)}
              scrollEventThrottle={100}
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
                    {authMode === 'choose' ? (
                      <Panel>
                        <Heading>Bắt đầu</Heading>
                        <Copy>
                          Thông tin đăng nhập đã lưu sẽ được khôi phục tự động trên thiết bị này.
                        </Copy>
                        <Button title="Tạo tài khoản mới" onPress={() => setAuthMode('register')} />
                        <Button title="Đăng nhập" secondary onPress={() => setAuthMode('login')} />
                      </Panel>
                    ) : authMode === 'register' ? (
                      <Panel>
                        <Heading>Tạo tài khoản</Heading>
                        <Field
                          label="Tên hiển thị"
                          placeholder="Mọi người gọi bạn là gì?"
                          value={displayName}
                          maxLength={30}
                          onChangeText={setDisplayName}
                        />
                        <Field
                          label="Mật khẩu đăng ký"
                          secureTextEntry
                          value={password}
                          maxLength={128}
                          onChangeText={setPassword}
                        />
                        <Button
                          title="Tạo tài khoản và vào sảnh"
                          busy={busy}
                          disabled={!displayName.trim() || password.length < 8}
                          onPress={() => void work(() => authenticate('register'))}
                        />
                        <Button
                          title="Quay lại"
                          secondary
                          disabled={busy}
                          onPress={() => {
                            setPassword('');
                            setAuthMode('choose');
                          }}
                        />
                      </Panel>
                    ) : (
                      <Panel>
                        <Heading>Đăng nhập</Heading>
                        <Field
                          label="Username"
                          autoCapitalize="none"
                          value={username}
                          maxLength={40}
                          onChangeText={setUsername}
                        />
                        <Field
                          label="Mật khẩu đăng nhập"
                          secureTextEntry
                          value={password}
                          maxLength={128}
                          onChangeText={setPassword}
                        />
                        <Button
                          title="Đăng nhập vào sảnh"
                          busy={busy}
                          disabled={!username.trim() || password.length < 8}
                          onPress={() => void work(() => authenticate('login'))}
                        />
                        <Copy>
                          Nhập đúng username + mật khẩu quản trị để vào thẳng trang quản trị.
                        </Copy>
                        <Button
                          title="Quay lại"
                          secondary
                          disabled={busy}
                          onPress={() => {
                            setPassword('');
                            setAuthMode('choose');
                          }}
                        />
                      </Panel>
                    )}
                  </>
                ) : !room ? (
                  <>
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-1">
                        <Heading>Xin chào, {session.name} 👋</Heading>
                      </View>
                      <Button
                        title="Hồ sơ"
                        secondary
                        disabled={busy}
                        onPress={() => {
                          setMode('profile');
                          void work(refreshProfile);
                        }}
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
                          <View className="flex-row gap-3">
                            <IconButton
                              icon="➕"
                              label="Tạo phòng mới"
                              disabled={locked}
                              onPress={() => {
                                setMode('create');
                                setPassword('');
                                createId.current = newId();
                              }}
                            />
                            <IconButton
                              icon="🔑"
                              label="Nhập mã phòng"
                              secondary
                              disabled={locked}
                              onPress={() => {
                                setMode('join');
                                setPassword('');
                              }}
                            />
                            <IconButton
                              icon="🃏"
                              label="Bộ bài của tôi"
                              secondary
                              disabled={locked}
                              onPress={() => setMode('decks')}
                            />
                          </View>
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
                        {(showAllRooms ? rooms : rooms.slice(0, 3)).map((r) => (
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
                        {rooms.length > 3 && (
                          <Button
                            title={showAllRooms ? 'Ẩn bớt' : `Xem thêm ${rooms.length - 3} phòng`}
                            secondary
                            onPress={() => setShowAllRooms((v) => !v)}
                          />
                        )}
                      </>
                    ) : mode === 'profile' ? (
                      <Panel>
                        <Heading>Hồ sơ của bạn</Heading>
                        {profile ? (
                          <>
                            <Copy>Username: {profile.username}</Copy>
                            <Copy>Tên hiển thị: {profile.displayName}</Copy>
                            <Copy>
                              Thời gian trực tuyến: {profile.onlineHours.toFixed(2)} giờ ·{' '}
                              {profile.deckCount} bộ bài
                            </Copy>
                            <Field
                              label="Tên hiển thị mới"
                              maxLength={30}
                              value={displayName}
                              onChangeText={setDisplayName}
                            />
                            <Copy>
                              Bạn chỉ đổi tên hiển thị mỗi 7 ngày. Lần tiếp theo:{' '}
                              {new Date(profile.displayNameChangeAllowedAt).toLocaleString()}
                            </Copy>
                            <Button
                              title="Lưu tên hiển thị"
                              disabled={
                                busy || !displayName.trim() || displayName === profile.displayName
                              }
                              onPress={() =>
                                void work(async () => {
                                  const next = await request<Profile>(
                                    socketRef.current!,
                                    'profile:changeDisplayName',
                                    { displayName },
                                  );
                                  setProfile(next);
                                  await remember({
                                    ...sessionRef.current!,
                                    name: next.displayName,
                                  });
                                })
                              }
                            />
                            <Field
                              label="Mật khẩu hiện tại"
                              secureTextEntry
                              value={currentPassword}
                              maxLength={128}
                              onChangeText={setCurrentPassword}
                            />
                            <Field
                              label="Mật khẩu mới"
                              secureTextEntry
                              value={newPassword}
                              maxLength={128}
                              onChangeText={setNewPassword}
                            />
                            <Button
                              title="Đổi mật khẩu"
                              secondary
                              disabled={busy || !currentPassword || !newPassword}
                              onPress={() =>
                                void work(async () => {
                                  await request(socketRef.current!, 'profile:changePassword', {
                                    currentPassword,
                                    newPassword,
                                  });
                                  setCurrentPassword('');
                                  setNewPassword('');
                                })
                              }
                            />
                          </>
                        ) : (
                          <Copy>Đang tải hồ sơ…</Copy>
                        )}
                        <Button
                          title="Đăng xuất"
                          danger
                          disabled={busy}
                          onPress={() =>
                            void work(async () => {
                              try {
                                if (socketRef.current?.connected)
                                  await request(socketRef.current, 'auth:logout');
                              } catch {
                                // A rejected or expired token cannot be revoked remotely; still
                                // clear the saved session so the player can sign in again.
                              }
                              await remember(null);
                              setProfile(null);
                              setMode('list');
                            })
                          }
                        />
                        <Button
                          title="Quay lại sảnh"
                          secondary
                          disabled={busy}
                          onPress={() => setMode('list')}
                        />
                      </Panel>
                    ) : mode === 'decks' ? (
                      <Panel>
                        <Heading>Bộ bài của tôi</Heading>
                        <Copy>Tạo và quản lý bộ bài riêng theo từng chủ đề.</Copy>
                        <View className="gap-2">
                          {packs.map((pack) => (
                            <Pressable
                              key={pack.id}
                              accessibilityRole="button"
                              accessibilityLabel={`Chủ đề ${pack.name}`}
                              aria-selected={packId === pack.id}
                              onPress={() => {
                                setPackId(pack.id);
                                setSelectedDeckId('');
                              }}
                              className={`rounded-2xl border p-3 ${packId === pack.id ? 'bg-violet-900 border-violet-300' : 'bg-night border-slate-700'}`}
                            >
                              <Text className="text-white font-bold">
                                {pack.icon} {pack.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <Field
                          label="Tên bộ bài mới"
                          value={deckName}
                          maxLength={80}
                          onChangeText={setDeckName}
                          placeholder="Bộ bài cuối tuần"
                        />
                        <Button
                          title="Tạo bộ trống"
                          disabled={busy || !deckName.trim()}
                          onPress={() =>
                            void work(async () => {
                              await request<OwnedDeck>(socketRef.current!, 'decks:create', {
                                packId,
                                name: deckName,
                              });
                              setDeckName('');
                              await refreshDecks();
                            })
                          }
                        />
                        <Button
                          title="Sao chép bộ mặc định"
                          secondary
                          disabled={busy || !deckName.trim()}
                          onPress={() =>
                            void work(async () => {
                              await request<OwnedDeck>(socketRef.current!, 'decks:cloneDefault', {
                                packId,
                                name: deckName,
                              });
                              setDeckName('');
                              await refreshDecks();
                            })
                          }
                        />
                        {decks.length === 0 ? (
                          <Copy>Chưa có bộ bài nào cho chủ đề này.</Copy>
                        ) : (
                          decks.map((deck) => (
                            <View
                              key={deck.id}
                              className="rounded-2xl border border-slate-700 bg-night p-3 gap-2"
                            >
                              <Text className="text-white font-bold">{deck.name}</Text>
                              <Copy>{deck.cards.length} lá bài</Copy>
                              <Button
                                title="Chỉnh sửa lá bài"
                                secondary
                                disabled={busy}
                                onPress={() =>
                                  void work(async () => {
                                    const full = await request<OwnedDeck>(
                                      socketRef.current!,
                                      'decks:get',
                                      { deckId: deck.id },
                                    );
                                    setEditor({
                                      cards: full.cards,
                                      revision: 0,
                                      editable: true,
                                      deckId: full.id,
                                      packId: full.packId,
                                    });
                                    setSelectedDeckId(deck.id);
                                  })
                                }
                              />
                              <Button
                                title="Xóa bộ bài"
                                danger
                                disabled={busy}
                                onPress={() =>
                                  void work(async () => {
                                    await request(socketRef.current!, 'decks:delete', {
                                      deckId: deck.id,
                                    });
                                    await refreshDecks();
                                  })
                                }
                              />
                            </View>
                          ))
                        )}
                        <Button
                          title="Quay lại sảnh"
                          secondary
                          disabled={busy}
                          onPress={() => setMode('list')}
                        />
                      </Panel>
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
                                  onPress={() => {
                                    setPackId(pack.id);
                                    setSelectedDeckId('');
                                  }}
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
                            <Text className="text-slate-300 text-sm font-semibold">
                              Bộ bài để chơi
                            </Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Bộ mặc định của hệ thống"
                              aria-selected={!selectedDeckId}
                              onPress={() => setSelectedDeckId('')}
                              className={`rounded-2xl border p-3 ${!selectedDeckId ? 'bg-violet-900 border-violet-300' : 'bg-night border-slate-700'}`}
                            >
                              <Text className="text-white font-bold">Bộ mặc định của hệ thống</Text>
                              <Text className="text-slate-400 text-xs">
                                Sao chép bộ hiện tại vào phòng mới, độc lập với bộ gốc.
                              </Text>
                            </Pressable>
                            {decks.length > 0 && (
                              <View className="gap-2">
                                {decks.map((deck) => (
                                  <Pressable
                                    key={deck.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Bộ bài ${deck.name}`}
                                    aria-selected={selectedDeckId === deck.id}
                                    onPress={() => setSelectedDeckId(deck.id)}
                                    className={`rounded-2xl border p-3 ${selectedDeckId === deck.id ? 'bg-violet-900 border-violet-300' : 'bg-night border-slate-700'}`}
                                  >
                                    <Text className="text-white font-bold">{deck.name}</Text>
                                    <Text className="text-slate-400 text-xs">
                                      {deck.cards.length} lá bài
                                    </Text>
                                  </Pressable>
                                ))}
                                <Button
                                  title="Quản lý bộ bài"
                                  secondary
                                  disabled={busy}
                                  onPress={() => setMode('decks')}
                                />
                              </View>
                            )}
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
                          onPress={() =>
                            void enter(mode === 'create' ? 'room:create' : 'room:join')
                          }
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
            {Platform.OS === 'web' && showScrollTop && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Lên đầu trang"
                onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
                className="absolute bottom-6 right-6 h-12 w-12 items-center justify-center rounded-full bg-violet-400 border border-violet-300 shadow-lg"
              >
                <Text className="text-xl font-bold text-slate-950">↑</Text>
              </Pressable>
            )}
          </View>
        )}
        {paused && (
          <PausedNotice
            names={disconnected.map((p) => p.name)}
            host={room?.hostId === session?.playerId}
            onContinue={() => setResumedDespiteOffline(disconnectedKey)}
          />
        )}
        {(!!error || !!notice) && (
          <View
            className="absolute top-2 left-0 right-0 items-center gap-2 px-4"
            pointerEvents="box-none"
          >
            {!!error && <Toast tone="error" message={error} onClose={() => setError('')} />}
            {!!notice && <Toast message={notice} onClose={() => setNotice('')} />}
          </View>
        )}
        {editor && (
          <DeckEditor
            cards={editor.cards}
            editable={editor.editable}
            packId={editor.packId ?? defaultPackId}
            onClose={() => setEditor(null)}
            onSave={(cards) =>
              editor.deckId
                ? work(async () => {
                    await request<OwnedDeck>(socketRef.current!, 'decks:update', {
                      deckId: editor.deckId,
                      cards,
                    });
                    await refreshDecks();
                  })
                : send({ type: 'saveDeck', cards }, editor.revision)
            }
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
