import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpIcon, KeyRoundIcon, LayersIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Socket } from 'socket.io-client';
import {
  defaultPackId,
  packById,
  packs,
  type Action,
  type Card as GameCard,
  type OwnedDeck,
  type Profile,
  type RoomSummary,
  type RoomView,
  type Session,
} from '@chamly/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Toaster } from '@/components/ui/sonner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FullscreenButton, InstallBanner } from '@/components/game/app-chrome';
import { DeckEditor } from '@/components/game/deck-editor';
import { PausedNotice } from '@/components/game/paused-notice';
import { RoomScreen } from '@/components/game/room-screen';
import { useBackGuard, useOnVisible } from '@/hooks/use-mobile-shell';
import { apiUrl, connect, loadSession, request, RequestError, saveSession } from '@/lib/connection';
import { newId } from '@/lib/id';

// Lỗi dùng chung một toast id: tin mới thay tin cũ thay vì xếp chồng, tự ẩn sau 5s.
const fail = (message: string) => toast.error(message, { id: 'error', duration: 5000 });
const clearError = () => toast.dismiss('error');

/** Lựa chọn dạng thẻ (chủ đề, bộ bài) trong một ToggleGroup dọc. */
const optionClass =
  'h-auto w-full flex-col items-start justify-start gap-0.5 rounded-2xl px-4 py-3 text-left whitespace-normal data-[state=on]:border-ring data-[state=on]:bg-accent data-[state=on]:text-accent-foreground';

function PackPicker({
  value,
  onChange,
  withTagline,
}: {
  value: string;
  onChange: (packId: string) => void;
  withTagline?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      orientation="vertical"
      variant="outline"
      spacing={2}
      className="w-full"
      value={value}
      onValueChange={(next) => next && onChange(next)}
    >
      {packs.map((pack) => (
        <ToggleGroupItem
          key={pack.id}
          value={pack.id}
          aria-label={`Chủ đề ${pack.name}`}
          className={optionClass}
        >
          <span className="font-bold">
            {pack.icon} {pack.name}
          </span>
          {withTagline && (
            <span className="text-muted-foreground text-xs leading-5 font-normal">
              {pack.tagline}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Screen({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold">{title}</CardTitle>
        {description && <CardDescription className="leading-6">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const sessionRef = useRef<Session | null>(session);
  const socketRef = useRef<Socket | null>(null);
  const [online, setOnline] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [showAllRooms, setShowAllRooms] = useState(false);
  const [displayName, setDisplayName] = useState(session?.name ?? '');
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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editor, setEditor] = useState<{
    cards: GameCard[];
    revision: number;
    editable: boolean;
    deckId?: string;
    packId?: string;
  } | null>(null);
  const [pouchOpen, setPouchOpen] = useState(false);
  const [resumedDespiteOffline, setResumedDespiteOffline] = useState('');
  const createId = useRef(newId());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const accept = useCallback((next: RoomView) => {
    if (roomRef.current?.id === next.id && roomRef.current.revision > next.revision) return;
    roomRef.current = next;
    setRoom(next);
  }, []);
  const remember = useCallback((value: Session | null) => {
    saveSession(value);
    sessionRef.current = value;
    setSession(value);
  }, []);
  const forgetRoom = useCallback(() => {
    setMode('list');
    roomRef.current = null;
    setRoom(null);
    setEditor(null);
    setPouchOpen(false);
    if (sessionRef.current) remember({ ...sessionRef.current, roomId: undefined });
  }, [remember]);
  const sync = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    if (sessionRef.current?.roomId) {
      try {
        accept(await request<RoomView>(socket, 'room:sync', { roomId: sessionRef.current.roomId }));
      } catch (e) {
        if (e instanceof RequestError && ['ROOM_NOT_FOUND', 'NOT_MEMBER'].includes(e.code))
          forgetRoom();
        fail(e instanceof Error ? e.message : 'Không đồng bộ được phòng.');
      }
    } else {
      try {
        setRooms(await request<RoomSummary[]>(socket, 'rooms:list'));
      } catch {
        /* Connection status already shown. */
      }
    }
  }, [accept, forgetRoom]);
  useEffect(() => {
    if (!session?.token) return;
    const socket = connect(session.token);
    socketRef.current = socket;
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
      fail(
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
    socket.on('server:notice', (message: string) => toast(`📢 ${message}`, { duration: 5000 }));
    socket.on('room:left', forgetRoom);
    socket.on('room:expired', () => {
      forgetRoom();
      fail('Phòng đã hết hạn.');
    });
    socket.connect();
    // Periodic snapshots recover missed broadcasts, including commit-before-crash windows.
    const timer = setInterval(() => void sync(), 15_000);
    return () => {
      clearInterval(timer);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.token, accept, forgetRoom, sync]);
  // Mở khóa màn hình / quay lại tab: điện thoại có thể đã ngắt socket ngầm, nên nối lại ngay.
  useOnVisible(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (socket.connected) void sync();
    else socket.connect();
  });
  async function work(action: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    clearError();
    try {
      await action();
      return true;
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Không thực hiện được thao tác.');
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
      remember({ ...sessionRef.current, roomId: next.id });
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
      .catch((e) => fail(e instanceof Error ? e.message : 'Không tải được bộ bài.'));
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
    remember(await response.json());
    setPassword('');
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

  // Nút back / vuốt mép của Android đóng lớp trên cùng thay vì rời khỏi app.
  useBackGuard(
    () => {
      if (editor) {
        setEditor(null);
        return true;
      }
      if (pouchOpen) {
        setPouchOpen(false);
        return true;
      }
      if (room) return !!room.revealed;
      if (session && mode !== 'list') {
        setMode('list');
        return true;
      }
      if (!session && authMode !== 'choose') {
        setPassword('');
        setAuthMode('choose');
        return true;
      }
      return false;
    },
    () => toast('Bấm back lần nữa để thoát Chạm Ly', { id: 'exit', duration: 2000 }),
  );

  const backToLobby = (
    <Button variant="ghost" disabled={busy} onClick={() => setMode('list')}>
      Quay lại sảnh
    </Button>
  );

  return (
    <>
      {session && room ? (
        <RoomScreen
          room={room}
          session={session}
          locked={locked}
          disconnected={disconnected}
          everyoneReady={everyoneReady}
          pouchOpen={pouchOpen}
          setPouchOpen={setPouchOpen}
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
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="scroll-area flex min-h-0 flex-1 flex-col gap-4 px-4 pt-3 pb-8"
            onScroll={(e) => setShowScrollTop(e.currentTarget.scrollTop > 400)}
          >
            <header className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-primary text-xs font-bold tracking-widest">
                  GOOD FRIENDS. GREAT STORIES.
                </p>
                <h1 className="mt-1 text-3xl font-black">
                  Chạm Ly <span className="text-2xl">🥂</span>
                </h1>
              </div>
              {session && (
                <Badge
                  variant="outline"
                  className={
                    online ? 'text-success border-success/40' : 'text-warning border-warning/40'
                  }
                >
                  {online ? '● Trực tuyến' : '○ Đang kết nối'}
                </Badge>
              )}
              <FullscreenButton />
            </header>
            <InstallBanner />
            {!session ? (
              <>
                <div className="flex flex-col gap-3 py-5">
                  <h2 className="text-3xl leading-tight font-bold">
                    Một phòng chơi.
                    <br />
                    Cả hội cùng vui.
                  </h2>
                  <p className="text-muted-foreground leading-6">
                    Mỗi người một chiếc điện thoại. Cùng vào phòng, chọn bài và tạo những câu chuyện
                    đáng nhớ.
                  </p>
                </div>
                {authMode === 'choose' ? (
                  <Screen
                    title="Bắt đầu"
                    description="Thông tin đăng nhập đã lưu sẽ được khôi phục tự động trên thiết bị này."
                  >
                    <Button size="lg" onClick={() => setAuthMode('register')}>
                      Tạo tài khoản mới
                    </Button>
                    <Button variant="secondary" onClick={() => setAuthMode('login')}>
                      Đăng nhập
                    </Button>
                  </Screen>
                ) : (
                  <Screen title={authMode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập'}>
                    <form
                      className="flex flex-col gap-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void work(() => authenticate(authMode));
                      }}
                    >
                      <FieldGroup>
                        {authMode === 'register' ? (
                          <Field>
                            <FieldLabel htmlFor="display-name">Tên hiển thị</FieldLabel>
                            <Input
                              id="display-name"
                              placeholder="Mọi người gọi bạn là gì?"
                              value={displayName}
                              maxLength={30}
                              autoComplete="nickname"
                              enterKeyHint="next"
                              onChange={(e) => setDisplayName(e.target.value)}
                            />
                          </Field>
                        ) : (
                          <Field>
                            <FieldLabel htmlFor="username">Username</FieldLabel>
                            <Input
                              id="username"
                              autoCapitalize="none"
                              autoCorrect="off"
                              autoComplete="username"
                              enterKeyHint="next"
                              value={username}
                              maxLength={40}
                              onChange={(e) => setUsername(e.target.value)}
                            />
                          </Field>
                        )}
                        <Field>
                          <FieldLabel htmlFor="auth-password">
                            {authMode === 'register' ? 'Mật khẩu đăng ký' : 'Mật khẩu đăng nhập'}
                          </FieldLabel>
                          <Input
                            id="auth-password"
                            type="password"
                            autoComplete={
                              authMode === 'register' ? 'new-password' : 'current-password'
                            }
                            enterKeyHint="go"
                            value={password}
                            maxLength={128}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                          {authMode === 'login' && (
                            <FieldDescription>
                              Nhập đúng username + mật khẩu quản trị để vào thẳng trang quản trị.
                            </FieldDescription>
                          )}
                        </Field>
                      </FieldGroup>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={
                          busy ||
                          password.length < 8 ||
                          !(authMode === 'register' ? displayName : username).trim()
                        }
                      >
                        {busy && <Spinner data-icon="inline-start" />}
                        {authMode === 'register'
                          ? 'Tạo tài khoản và vào sảnh'
                          : 'Đăng nhập vào sảnh'}
                      </Button>
                    </form>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setPassword('');
                        setAuthMode('choose');
                      }}
                    >
                      Quay lại
                    </Button>
                  </Screen>
                )}
              </>
            ) : !room ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="min-w-0 flex-1 truncate text-xl font-bold">
                    Xin chào, {session.name} 👋
                  </h2>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setMode('profile');
                      void work(refreshProfile);
                    }}
                  >
                    Hồ sơ
                  </Button>
                </div>
                {session.roomId && (
                  <Card size="sm">
                    <CardContent className="flex flex-col gap-3">
                      <p className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Spinner /> Đang khôi phục phòng {session.roomId}…
                      </p>
                      <Button variant="secondary" onClick={forgetRoom}>
                        Về sảnh (giữ chỗ trong phòng cũ)
                      </Button>
                    </CardContent>
                  </Card>
                )}
                {mode === 'list' ? (
                  <>
                    <Screen
                      title="Hôm nay chơi cùng ai?"
                      description="Tạo phòng có mật khẩu hoặc nhập mã để tham gia cùng bạn bè."
                    >
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          {
                            label: 'Tạo phòng mới',
                            caption: 'Tạo phòng',
                            icon: <PlusIcon />,
                            primary: true,
                            onClick: () => {
                              setMode('create');
                              setPassword('');
                              createId.current = newId();
                            },
                          },
                          {
                            label: 'Nhập mã phòng',
                            caption: 'Nhập mã',
                            icon: <KeyRoundIcon />,
                            onClick: () => {
                              setMode('join');
                              setPassword('');
                            },
                          },
                          {
                            label: 'Bộ bài của tôi',
                            caption: 'Bộ bài',
                            icon: <LayersIcon />,
                            onClick: () => setMode('decks'),
                          },
                        ].map((tile) => (
                          <Button
                            key={tile.label}
                            aria-label={tile.label}
                            variant={tile.primary ? 'default' : 'secondary'}
                            disabled={locked}
                            onClick={tile.onClick}
                            className="h-20 flex-col gap-1.5 text-xs [&_svg:not([class*='size-'])]:size-6"
                          >
                            {tile.icon}
                            {tile.caption}
                          </Button>
                        ))}
                      </div>
                    </Screen>
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-xl font-bold">Các phòng hiện tại</h2>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={locked}
                        onClick={() =>
                          void work(async () =>
                            setRooms(
                              await request<RoomSummary[]>(socketRef.current!, 'rooms:list'),
                            ),
                          )
                        }
                      >
                        <RefreshCwIcon data-icon="inline-start" />
                        Làm mới
                      </Button>
                    </div>
                    {rooms.length === 0 && (
                      <Empty className="border">
                        <EmptyHeader>
                          <EmptyTitle>Chưa có phòng nào</EmptyTitle>
                          <EmptyDescription>Hãy mở bàn đầu tiên!</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                    {(showAllRooms ? rooms : rooms.slice(0, 3)).map((r) => (
                      <Card key={r.id} size="sm">
                        <CardHeader>
                          <CardTitle className="text-lg font-bold">{r.name}</CardTitle>
                          <CardDescription>
                            {packById(r.packId).icon} {packById(r.packId).name} · #{r.id} ·{' '}
                            {r.playerCount}/12 người
                          </CardDescription>
                          <CardAction>
                            <Badge variant={r.phase === 'lobby' ? 'default' : 'secondary'}>
                              {r.phase === 'lobby' ? 'Đang chờ' : 'Đã bắt đầu'}
                            </Badge>
                          </CardAction>
                        </CardHeader>
                        <CardFooter className="border-0 bg-transparent">
                          <Button
                            variant="secondary"
                            className="w-full"
                            disabled={locked || r.phase !== 'lobby' || r.playerCount >= 12}
                            onClick={() => {
                              setCode(r.id);
                              setPassword('');
                              setMode('join');
                            }}
                          >
                            {`Vào phòng ${r.id}`}
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                    {rooms.length > 3 && (
                      <Button variant="ghost" onClick={() => setShowAllRooms((v) => !v)}>
                        {showAllRooms ? 'Ẩn bớt' : `Xem thêm ${rooms.length - 3} phòng`}
                      </Button>
                    )}
                  </>
                ) : mode === 'profile' ? (
                  <Screen title="Hồ sơ của bạn">
                    {profile ? (
                      <>
                        <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                          <dt>Username</dt>
                          <dd className="text-foreground truncate">{profile.username}</dd>
                          <dt>Tên hiển thị</dt>
                          <dd className="text-foreground truncate">{profile.displayName}</dd>
                          <dt>Trực tuyến</dt>
                          <dd className="text-foreground">
                            {profile.onlineHours.toFixed(2)} giờ · {profile.deckCount} bộ bài
                          </dd>
                        </dl>
                        <Separator />
                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor="new-display-name">Tên hiển thị mới</FieldLabel>
                            <Input
                              id="new-display-name"
                              maxLength={30}
                              value={displayName}
                              onChange={(e) => setDisplayName(e.target.value)}
                            />
                            <FieldDescription>
                              Bạn chỉ đổi tên hiển thị mỗi 7 ngày. Lần tiếp theo:{' '}
                              {new Date(profile.displayNameChangeAllowedAt).toLocaleString()}
                            </FieldDescription>
                          </Field>
                        </FieldGroup>
                        <Button
                          disabled={
                            busy || !displayName.trim() || displayName === profile.displayName
                          }
                          onClick={() =>
                            void work(async () => {
                              const next = await request<Profile>(
                                socketRef.current!,
                                'profile:changeDisplayName',
                                { displayName },
                              );
                              setProfile(next);
                              remember({ ...sessionRef.current!, name: next.displayName });
                            })
                          }
                        >
                          Lưu tên hiển thị
                        </Button>
                        <Separator />
                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor="current-password">Mật khẩu hiện tại</FieldLabel>
                            <Input
                              id="current-password"
                              type="password"
                              autoComplete="current-password"
                              value={currentPassword}
                              maxLength={128}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="next-password">Mật khẩu mới</FieldLabel>
                            <Input
                              id="next-password"
                              type="password"
                              autoComplete="new-password"
                              value={newPassword}
                              maxLength={128}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                          </Field>
                        </FieldGroup>
                        <Button
                          variant="secondary"
                          disabled={busy || !currentPassword || !newPassword}
                          onClick={() =>
                            void work(async () => {
                              await request(socketRef.current!, 'profile:changePassword', {
                                currentPassword,
                                newPassword,
                              });
                              setCurrentPassword('');
                              setNewPassword('');
                              toast.success('Đã đổi mật khẩu.', { duration: 3000 });
                            })
                          }
                        >
                          Đổi mật khẩu
                        </Button>
                      </>
                    ) : (
                      <p className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Spinner /> Đang tải hồ sơ…
                      </p>
                    )}
                    <Separator />
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          try {
                            if (socketRef.current?.connected)
                              await request(socketRef.current, 'auth:logout');
                          } catch {
                            // A rejected or expired token cannot be revoked remotely; still
                            // clear the saved session so the player can sign in again.
                          }
                          remember(null);
                          setProfile(null);
                          setMode('list');
                        })
                      }
                    >
                      Đăng xuất
                    </Button>
                    {backToLobby}
                  </Screen>
                ) : mode === 'decks' ? (
                  <Screen
                    title="Bộ bài của tôi"
                    description="Tạo và quản lý bộ bài riêng theo từng chủ đề."
                  >
                    <PackPicker
                      value={packId}
                      onChange={(next) => {
                        setPackId(next);
                        setSelectedDeckId('');
                      }}
                    />
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="deck-name">Tên bộ bài mới</FieldLabel>
                        <Input
                          id="deck-name"
                          value={deckName}
                          maxLength={80}
                          placeholder="Bộ bài cuối tuần"
                          onChange={(e) => setDeckName(e.target.value)}
                        />
                      </Field>
                    </FieldGroup>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        disabled={busy || !deckName.trim()}
                        onClick={() =>
                          void work(async () => {
                            await request<OwnedDeck>(socketRef.current!, 'decks:create', {
                              packId,
                              name: deckName,
                            });
                            setDeckName('');
                            await refreshDecks();
                          })
                        }
                      >
                        Tạo bộ trống
                      </Button>
                      <Button
                        variant="secondary"
                        className="whitespace-normal"
                        disabled={busy || !deckName.trim()}
                        onClick={() =>
                          void work(async () => {
                            await request<OwnedDeck>(socketRef.current!, 'decks:cloneDefault', {
                              packId,
                              name: deckName,
                            });
                            setDeckName('');
                            await refreshDecks();
                          })
                        }
                      >
                        Sao chép bộ mặc định
                      </Button>
                    </div>
                    {decks.length === 0 ? (
                      <Empty className="border">
                        <EmptyHeader>
                          <EmptyDescription>Chưa có bộ bài nào cho chủ đề này.</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      decks.map((deck) => (
                        <Card key={deck.id} size="sm" className="bg-background">
                          <CardHeader>
                            <CardTitle className="font-bold">{deck.name}</CardTitle>
                            <CardDescription>{deck.cards.length} lá bài</CardDescription>
                          </CardHeader>
                          <CardFooter className="gap-2 border-0 bg-transparent *:flex-1">
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
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
                            >
                              Chỉnh sửa lá bài
                            </Button>
                            <Button
                              variant="destructive"
                              disabled={busy}
                              onClick={() =>
                                void work(async () => {
                                  await request(socketRef.current!, 'decks:delete', {
                                    deckId: deck.id,
                                  });
                                  await refreshDecks();
                                })
                              }
                            >
                              Xóa bộ bài
                            </Button>
                          </CardFooter>
                        </Card>
                      ))
                    )}
                    {backToLobby}
                  </Screen>
                ) : (
                  <Screen title={mode === 'create' ? 'Mở một bàn mới' : 'Tham gia cùng cả hội'}>
                    <form
                      className="flex flex-col gap-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void enter(mode === 'create' ? 'room:create' : 'room:join');
                      }}
                    >
                      <FieldGroup>
                        {mode === 'create' ? (
                          <>
                            <Field>
                              <FieldLabel htmlFor="room-name">Tên phòng</FieldLabel>
                              <Input
                                id="room-name"
                                maxLength={60}
                                value={roomName}
                                placeholder="Hội bạn cuối tuần"
                                enterKeyHint="next"
                                onChange={(e) => setRoomName(e.target.value)}
                              />
                            </Field>
                            <Field>
                              <FieldLabel>Chủ đề bộ bài</FieldLabel>
                              <PackPicker
                                withTagline
                                value={packId}
                                onChange={(next) => {
                                  setPackId(next);
                                  setSelectedDeckId('');
                                }}
                              />
                            </Field>
                            <Field>
                              <FieldLabel>Bộ bài để chơi</FieldLabel>
                              <ToggleGroup
                                type="single"
                                orientation="vertical"
                                variant="outline"
                                spacing={2}
                                className="w-full"
                                value={selectedDeckId || 'default'}
                                onValueChange={(next) =>
                                  next && setSelectedDeckId(next === 'default' ? '' : next)
                                }
                              >
                                <ToggleGroupItem
                                  value="default"
                                  aria-label="Bộ mặc định của hệ thống"
                                  className={optionClass}
                                >
                                  <span className="font-bold">Bộ mặc định của hệ thống</span>
                                  <span className="text-muted-foreground text-xs font-normal">
                                    Sao chép bộ hiện tại vào phòng mới, độc lập với bộ gốc.
                                  </span>
                                </ToggleGroupItem>
                                {decks.map((deck) => (
                                  <ToggleGroupItem
                                    key={deck.id}
                                    value={deck.id}
                                    aria-label={`Bộ bài ${deck.name}`}
                                    className={optionClass}
                                  >
                                    <span className="font-bold">{deck.name}</span>
                                    <span className="text-muted-foreground text-xs font-normal">
                                      {deck.cards.length} lá bài
                                    </span>
                                  </ToggleGroupItem>
                                ))}
                              </ToggleGroup>
                              {decks.length > 0 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => setMode('decks')}
                                >
                                  Quản lý bộ bài
                                </Button>
                              )}
                            </Field>
                          </>
                        ) : (
                          <Field>
                            <FieldLabel htmlFor="room-code">Mã phòng (6 ký tự)</FieldLabel>
                            <Input
                              id="room-code"
                              maxLength={6}
                              autoCapitalize="characters"
                              autoComplete="off"
                              autoCorrect="off"
                              enterKeyHint="next"
                              className="font-mono tracking-[0.3em] uppercase"
                              value={code}
                              placeholder="A1B2C3"
                              onChange={(e) => setCode(e.target.value.toUpperCase())}
                            />
                          </Field>
                        )}
                        <Field>
                          <FieldLabel htmlFor="room-password">
                            Mật khẩu phòng (ít nhất 4 ký tự)
                          </FieldLabel>
                          <Input
                            id="room-password"
                            type="password"
                            autoComplete="off"
                            enterKeyHint="go"
                            maxLength={128}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </Field>
                      </FieldGroup>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={
                          locked ||
                          password.length < 4 ||
                          (mode === 'create' ? !roomName.trim() : code.length !== 6)
                        }
                      >
                        {busy && <Spinner data-icon="inline-start" />}
                        {mode === 'create' ? 'Tạo phòng' : 'Tham gia phòng'}
                      </Button>
                    </form>
                    {backToLobby}
                  </Screen>
                )}
                <p className="text-muted-foreground text-xs">Server: {apiUrl}</p>
              </>
            ) : null}
            <p className="text-muted-foreground/60 mt-5 text-center text-xs">
              CHẠM LY · MỘT KẾT NỐI, NHIỀU CÂU CHUYỆN
            </p>
          </div>
          {showScrollTop && (
            <Button
              size="icon"
              aria-label="Lên đầu trang"
              className="absolute right-5 bottom-5 rounded-full shadow-lg"
              onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
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
      <Toaster position="top-center" offset="calc(env(safe-area-inset-top) + 0.5rem)" />
    </>
  );
}
