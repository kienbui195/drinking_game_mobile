import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { Action, OwnedDeck, Profile, Reply, RoomView, Session } from '@chamly/shared';
import { offlineTtl, Store } from '../src/store';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import type { RowDataPacket } from 'mysql2/promise';

const url = process.env.TEST_API_URL ?? 'http://localhost:45100';
function rpc<T>(socket: Socket, event: string, data: unknown = {}): Promise<Reply<T>> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(5000)
      .emit(event, data, (err: Error | null, reply: Reply<T>) =>
        err ? reject(err) : resolve(reply),
      ),
  );
}
function unwrap<T>(reply: Reply<T>): T {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  if (!reply.ok) throw new Error(reply.message);
  return reply.data;
}
async function session(name: string): Promise<Session> {
  const response = await fetch(`${url}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  assert.equal(response.status, 201);
  return response.json();
}
async function account(displayName: string, password = 'account-secret'): Promise<Session> {
  const response = await fetch(`${url}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, password }),
  });
  assert.equal(response.status, 201);
  return response.json();
}
function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { auth: { token }, reconnection: false, timeout: 5000 });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}
test(
  'empty rooms are removed immediately; all-offline rooms expire after 30 minutes unless someone returns',
  { timeout: 30_000 },
  async (t) => {
    const store = new Store();
    await store.onModuleInit();
    const player = await store.createIdentity(`Expiry-${randomUUID().slice(0, 5)}`);
    const identity = { id: player.playerId, name: player.name };
    const roomIds: string[] = [];
    t.after(async () => {
      for (const id of roomIds) await store.pool.execute('DELETE FROM rooms WHERE id = ?', [id]);
      await store.pool.execute('DELETE FROM sessions WHERE id = ?', [player.playerId]);
      await store.onModuleDestroy();
    });
    const empty = await store.create(identity, 'Empty', 'secret', randomUUID());
    roomIds.push(empty.id);
    await store.command(identity, {
      roomId: empty.id,
      revision: empty.revision,
      requestId: randomUUID(),
      action: { type: 'leave' },
    });
    assert.equal(
      (
        await store.pool.execute<RowDataPacket[]>('SELECT id FROM rooms WHERE id = ?', [empty.id])
      )[0].length,
      0,
    );

    const room = await store.create(identity, 'Offline', 'secret', randomUUID());
    roomIds.push(room.id);
    await store.setPresence(room.id, false);
    let saved = await store.read(room.id);
    assert.ok(saved.offlineSince);
    assert.ok(saved.expiresAt >= saved.offlineSince! + offlineTtl);
    await store.setPresence(room.id, false);
    assert.equal((await store.read(room.id)).offlineSince, saved.offlineSince);
    await store.setPresence(room.id, true);
    saved = await store.read(room.id);
    assert.equal(saved.offlineSince, null);
    await store.setPresence(room.id, false);
    // Simulate 30 minutes elapsing: reconnect after this point must be rejected even before prune.
    await store.pool.execute('UPDATE rooms SET offline_since = ? WHERE id = ?', [
      Date.now() - offlineTtl - 1,
      room.id,
    ]);
    await assert.rejects(store.read(room.id), /hết hạn/);
    assert.ok((await store.prune()).includes(room.id));
    const [left] = await store.pool.execute<RowDataPacket[]>('SELECT id FROM rooms WHERE id = ?', [
      room.id,
    ]);
    assert.equal(left.length, 0);
  },
);

test(
  'socket disconnect and reconnect persist and clear the room offline timer',
  { timeout: 30_000 },
  async (t) => {
    const owner = await session(`Presence-${randomUUID().slice(0, 5)}`);
    const store = new Store();
    await store.onModuleInit();
    const sockets: Socket[] = [];
    let id = '';
    t.after(async () => {
      sockets.forEach((socket) => socket.disconnect());
      if (id) await store.pool.execute('DELETE FROM rooms WHERE id = ?', [id]);
      await store.pool.execute('DELETE FROM sessions WHERE id = ?', [owner.playerId]);
      await store.onModuleDestroy();
    });
    const first = await open(owner.token);
    sockets.push(first);
    id = unwrap(
      await rpc<RoomView>(first, 'room:create', {
        name: 'Presence',
        password: 'secret',
        requestId: randomUUID(),
      }),
    ).id;
    assert.equal((await store.read(id)).offlineSince, null);
    first.disconnect();
    let since: number | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      since = (await store.read(id)).offlineSince;
      if (since) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(since, 'Disconnect must start the offline timer');
    const second = await open(owner.token);
    sockets.push(second);
    unwrap(await rpc<RoomView>(second, 'room:sync', { roomId: id }));
    assert.equal((await store.read(id)).offlineSince, null);
  },
);

test(
  'real MySQL + sockets: rooms, auth, isolation, races, reconnect and persistence',
  { timeout: 60_000 },
  async (t) => {
    const identities = await Promise.all(
      ['Host', 'Guest', 'Outsider'].map((n) => session(`${n}-${randomUUID().slice(0, 5)}`)),
    );
    const [host, guest, outsider] = await Promise.all(identities.map((s) => open(s.token)));
    const sockets = [host, guest, outsider];
    const created: string[] = [];
    const store = new Store();
    await store.onModuleInit();
    t.after(async () => {
      sockets.forEach((s) => s.disconnect());
      for (const id of created) await store.pool.execute('DELETE FROM rooms WHERE id = ?', [id]);
      for (const s of identities)
        await store.pool.execute('DELETE FROM sessions WHERE id = ?', [s.playerId]);
      await store.onModuleDestroy();
    });
    const [sessionRows] = await store.pool.execute<RowDataPacket[]>(
      'SELECT started_at, expires_at FROM sessions WHERE id = ?',
      [identities[0].playerId],
    );
    assert.equal(
      Number(sessionRows[0].expires_at) - Number(sessionRows[0].started_at),
      7 * 24 * 60 * 60 * 1000,
    );
    // Existing legacy sessions had no started_at and a 30-day expiry. Startup caps them once.
    const legacy = await store.createIdentity('Legacy migration test');
    identities.push(legacy);
    const legacyExpiry = Date.now() + 29 * 24 * 60 * 60 * 1000;
    await store.pool.execute('UPDATE sessions SET started_at = NULL, expires_at = ? WHERE id = ?', [
      legacyExpiry,
      legacy.playerId,
    ]);
    for (let restart = 0; restart < 2; restart++) {
      const restarted = new Store();
      await restarted.onModuleInit();
      await restarted.onModuleDestroy();
      const [rows] = await store.pool.execute<RowDataPacket[]>(
        'SELECT started_at, expires_at FROM sessions WHERE id = ?',
        [legacy.playerId],
      );
      assert.equal(Number(rows[0].started_at), legacyExpiry - 30 * 24 * 60 * 60 * 1000);
      assert.equal(Number(rows[0].expires_at), legacyExpiry - 23 * 24 * 60 * 60 * 1000);
    }
    await assert.rejects(open('invalid'), /UNAUTHORIZED/);
    let state = unwrap(
      await rpc<RoomView>(host, 'room:create', {
        name: 'Integration',
        password: 'test-secret',
        requestId: randomUUID(),
      }),
    );
    created.push(state.id);
    const roomId = state.id;
    assert.equal(state.deck.length, 54);
    assert.ok(state.deck.some((card) => card.id === 'group-1'));
    assert.equal('password' in state, false);
    assert.equal((await rpc(guest, 'room:join', { roomId, password: 'wrong' })).ok, false);
    const denied = await rpc(outsider, 'room:sync', { roomId });
    assert.equal(denied.ok, false);
    state = unwrap(await rpc<RoomView>(guest, 'room:join', { roomId, password: 'test-secret' }));
    assert.equal(state.playerCount, 2);
    const act = async (socket: Socket, action: Action) => {
      const result = await rpc<RoomView>(socket, 'room:command', {
        roomId,
        revision: state.revision,
        requestId: randomUUID(),
        action,
      });
      if (result.ok) state = result.data;
      return result;
    };
    assert.equal((await act(guest, { type: 'start' })).ok, false);
    const originalTitle = state.deck[0].title;
    const edited = state.deck.slice(0, 2).map((c) => ({ ...c, title: 'Room-only title' }));
    unwrap(await act(host, { type: 'saveDeck', cards: edited }));
    const other = unwrap(
      await rpc<RoomView>(outsider, 'room:create', {
        name: 'Other room',
        password: 'test-secret',
        requestId: randomUUID(),
      }),
    );
    created.push(other.id);
    assert.equal(other.deck[0].title, originalTitle);
    unwrap(await act(host, { type: 'start' }));
    assert.equal(
      state.slots.every((s) => s.card === null),
      true,
    );
    assert.equal('remaining' in state, false);
    assert.equal((await rpc(outsider, 'room:join', { roomId, password: 'test-secret' })).ok, false);
    assert.equal((await act(guest, { type: 'pick', slot: 0 })).ok, false);
    const cmd = {
      roomId,
      revision: state.revision,
      requestId: randomUUID(),
      action: { type: 'pick', slot: 0 },
    };
    const [one, two] = await Promise.all([
      rpc<RoomView>(host, 'room:command', cmd),
      rpc<RoomView>(host, 'room:command', cmd),
    ]);
    state = unwrap(one);
    assert.equal(unwrap(two).revision, state.revision);
    assert.equal(state.slots.filter((s) => s.pickedBy).length, 1);
    const guestView = unwrap(await rpc<RoomView>(guest, 'room:sync', { roomId }));
    assert.deepEqual(guestView.revealed, state.revealed);
    const deadline = unwrap(await act(host, { type: 'timer' })).timerEndsAt;
    assert.ok(deadline);
    host.disconnect();
    const reconnected = await open(identities[0].token);
    sockets.push(reconnected);
    state = unwrap(await rpc<RoomView>(reconnected, 'room:sync', { roomId }));
    assert.equal(state.timerEndsAt, deadline);
    assert.ok(state.revealed);
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        rpc<RoomView>(reconnected, 'room:command', {
          roomId,
          revision: state.revision,
          requestId: randomUUID(),
          action: { type: 'complete', drinks: 1, completed: true },
        }),
      ),
    );
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    state = unwrap(a.ok ? a : b);
    assert.equal(state.history.length, 1);
    const persisted = await store.read(roomId);
    assert.equal(persisted.state.history.length, 1);
    assert.equal(persisted.revision, state.revision);
    assert.notEqual(persisted.password, 'test-secret');
    unwrap(await act(guest, { type: 'pick', slot: 1 }));
    unwrap(await act(guest, { type: 'complete', drinks: 0, completed: false }));
    assert.equal(state.phase, 'depleted');
    unwrap(await act(reconnected, { type: 'reshuffle' }));
    assert.equal(state.round, 2);
    unwrap(await act(reconnected, { type: 'leave' }));
    assert.equal(state.hostId, identities[1].playerId);
    assert.equal(state.phase, 'ended');
    assert.equal((await rpc(reconnected, 'room:sync', { roomId })).ok, false);
    assert.equal((await rpc(reconnected, 'room:command', cmd)).ok, false);
    await store.pool.execute('UPDATE rooms SET expires_at = ? WHERE id = ?', [
      Date.now() - 1,
      other.id,
    ]);
    assert.equal((await rpc(outsider, 'room:sync', { roomId: other.id })).ok, false);
  },
);

test(
  'registered accounts own validated deck snapshots and expose profile data',
  { timeout: 30_000 },
  async (t) => {
    const suffix = randomUUID().slice(0, 6);
    const displayName = `Đăng Ký ${suffix}`;
    const owner = await account(displayName);
    const other = await account(`Khách ${suffix}`);
    const ownerSocket = await open(owner.token);
    const otherSocket = await open(other.token);
    const store = new Store();
    await store.onModuleInit();
    const [accountRows] = await store.pool.execute<RowDataPacket[]>(
      'SELECT started_at, expires_at FROM sessions WHERE id = ?',
      [owner.playerId],
    );
    assert.equal(
      Number(accountRows[0].expires_at) - Number(accountRows[0].started_at),
      7 * 24 * 60 * 60 * 1000,
    );
    const decks: string[] = [];
    let roomId = '';
    t.after(async () => {
      ownerSocket.disconnect();
      otherSocket.disconnect();
      if (roomId) await store.pool.execute('DELETE FROM rooms WHERE id = ?', [roomId]);
      for (const id of decks)
        await store.pool.execute('DELETE FROM deck_cards WHERE deck_id = ?', [id]);
      for (const username of [owner.username, other.username]) {
        await store.pool.execute(
          'DELETE FROM session_durations WHERE user_id IN (SELECT id FROM users WHERE username = ?)',
          [username],
        );
        await store.pool.execute(
          'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)',
          [username],
        );
        await store.pool.execute(
          'DELETE FROM user_decks WHERE user_id IN (SELECT id FROM users WHERE username = ?)',
          [username],
        );
        await store.pool.execute('DELETE FROM users WHERE username = ?', [username]);
      }
      await store.onModuleDestroy();
    });
    // AC-01.2 (dữ liệu không hợp lệ): mật khẩu quá ngắn bị từ chối, không tạo tài khoản.
    const invalidRegister = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: `Ngắn ${suffix}`, password: 'short' }),
    });
    assert.equal(invalidRegister.status, 400);
    assert.match(owner.username!, /^dang-ky-/);
    const profile = unwrap(await rpc<Profile>(ownerSocket, 'profile:get'));
    assert.equal(profile.displayName, displayName);
    assert.equal(profile.deckCount, 0);
    // AC-03.1/US-05: thư viện trống ban đầu, tạo deck mới từ đầu theo game đã chọn.
    assert.deepEqual(unwrap(await rpc<OwnedDeck[]>(ownerSocket, 'decks:list', {})), []);
    const blank = unwrap(
      await rpc<OwnedDeck>(ownerSocket, 'decks:create', {
        packId: 'kien-thuc',
        name: 'Deck trống của tôi',
      }),
    );
    decks.push(blank.id);
    assert.equal(blank.cards.length, 0);
    const deck = unwrap(
      await rpc<OwnedDeck>(ownerSocket, 'decks:cloneDefault', {
        packId: 'kien-thuc',
        name: 'My knowledge deck',
      }),
    );
    decks.push(deck.id);
    assert.equal(deck.cards.length > 1, true);
    assert.equal(deck.packId, 'kien-thuc');
    assert.equal(unwrap(await rpc<Profile>(ownerSocket, 'profile:get')).deckCount, 2);
    // AC-03.1: thư viện chỉ hiển thị deck của chính tài khoản, đúng game đã chọn.
    const ownerLibrary = unwrap(
      await rpc<OwnedDeck[]>(ownerSocket, 'decks:list', { packId: 'kien-thuc' }),
    );
    assert.deepEqual(ownerLibrary.map((d) => d.id).sort(), [blank.id, deck.id].sort());
    assert.deepEqual(unwrap(await rpc<OwnedDeck[]>(otherSocket, 'decks:list', {})), []);
    assert.equal((await rpc(otherSocket, 'decks:get', { deckId: deck.id })).ok, false);
    const invalid = await rpc(ownerSocket, 'decks:update', {
      deckId: deck.id,
      cards: [{ ...deck.cards[0], category: 'challenge' }],
    });
    assert.equal(invalid.ok, false);
    // Không chọn bộ riêng: phòng lấy snapshot từ bộ mặc định hiện tại.
    const defaultRoom = unwrap(
      await rpc<RoomView>(ownerSocket, 'room:create', {
        name: 'Phòng từ bộ hệ thống',
        password: 'test-secret',
        requestId: randomUUID(),
        packId: 'kien-thuc',
      }),
    );
    assert.deepEqual(defaultRoom.deck, await store.defaultDeck('kien-thuc'));
    await store.pool.execute('DELETE FROM rooms WHERE id = ?', [defaultRoom.id]);
    // AC-06.1: deck không thuộc game đã chọn bị từ chối khi tạo phòng.
    const mismatchedDeck = await rpc(ownerSocket, 'room:create', {
      name: 'Phòng sai game',
      password: 'test-secret',
      requestId: randomUUID(),
      packId: 'chamly-50',
      deckId: deck.id,
    });
    assert.equal(mismatchedDeck.ok, false);
    if (!mismatchedDeck.ok) assert.equal(mismatchedDeck.code, 'DECK_PACK_MISMATCH');
    const created = unwrap(
      await rpc<RoomView>(ownerSocket, 'room:create', {
        name: 'Owned deck room',
        password: 'test-secret',
        requestId: randomUUID(),
        packId: 'kien-thuc',
        deckId: deck.id,
      }),
    );
    roomId = created.id;
    const changed = unwrap(
      await rpc<OwnedDeck>(ownerSocket, 'decks:update', {
        deckId: deck.id,
        cards: deck.cards.map((card, index) =>
          index ? card : { ...card, title: 'Changed later' },
        ),
      }),
    );
    assert.equal(changed.cards[0].title, 'Changed later');
    assert.notEqual(created.deck[0].title, 'Changed later');
    // AC-04.2: sửa bản clone không ảnh hưởng đến deck mặc định của hệ thống.
    const defaultCards = await store.defaultDeck('kien-thuc');
    assert.ok(defaultCards.every((card) => card.title !== 'Changed later'));
    // Đổi mật khẩu sai mật khẩu hiện tại bị từ chối.
    const wrongCurrent = await rpc(ownerSocket, 'profile:changePassword', {
      currentPassword: 'not-the-real-password',
      newPassword: 'new-account-secret',
    });
    assert.equal(wrongCurrent.ok, false);
    if (!wrongCurrent.ok) assert.equal(wrongCurrent.code, 'WRONG_PASSWORD');
    const passwordChanged = unwrap(
      await rpc<{ ok: true }>(ownerSocket, 'profile:changePassword', {
        currentPassword: 'account-secret',
        newPassword: 'new-account-secret',
      }),
    );
    assert.equal(passwordChanged.ok, true);
    const oldLogin = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: owner.username, password: 'account-secret' }),
    });
    assert.equal(oldLogin.status, 401);
    // AC-02.1: đăng nhập lại với mật khẩu mới thành công.
    const relogin = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: owner.username, password: 'new-account-secret' }),
    });
    assert.equal(relogin.status, 201);
    const reloginSession: Session = await relogin.json();
    assert.equal(reloginSession.username, owner.username);
    assert.equal(reloginSession.name, displayName);
    const reloginSocket = await open(reloginSession.token);
    // AC-05.2: deck vẫn còn nguyên sau khi đăng xuất/đăng nhập lại bằng phiên mới.
    const relist = unwrap(
      await rpc<OwnedDeck[]>(reloginSocket, 'decks:list', { packId: 'kien-thuc' }),
    );
    assert.ok(relist.some((d) => d.id === deck.id && d.cards[0]?.title === 'Changed later'));
    reloginSocket.disconnect();
    assert.equal(
      (await rpc(ownerSocket, 'profile:changeDisplayName', { displayName: 'Tên mới' })).ok,
      true,
    );
    const cooldown = await rpc(ownerSocket, 'profile:changeDisplayName', {
      displayName: 'Tên khác',
    });
    assert.equal(cooldown.ok, false);
    if (!cooldown.ok) {
      assert.equal(cooldown.code, 'DISPLAY_NAME_COOLDOWN');
      assert.ok(cooldown.nextAllowedAt && cooldown.nextAllowedAt > Date.now());
    }
    // AC-02.3: đăng xuất xóa token, phiên đó không dùng lại được.
    assert.equal((await rpc(otherSocket, 'auth:logout')).ok, true);
    await assert.rejects(open(other.token), /UNAUTHORIZED/);
  },
);

test(
  'admin edits system decks; new rooms and user clones take snapshots while old ones stay intact',
  { timeout: 30_000, skip: !process.env.ADMIN_PASSWORD },
  async (t) => {
    const packId = 'kien-thuc';
    const store = new Store();
    await store.onModuleInit();
    const original = await store.systemDeck(packId);
    const createdRooms: string[] = [];
    const createdDecks: string[] = [];
    const response = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.ADMIN_USERNAME ?? process.env.ADMIN_ROOM_NAME ?? 'adminserverday',
        password: process.env.ADMIN_PASSWORD,
      }),
    });
    assert.equal(response.status, 201);
    const adminSession: Session = await response.json();
    const userSession = await account(`Bộ Gốc ${randomUUID().slice(0, 6)}`);
    const [admin, user] = await Promise.all([open(adminSession.token), open(userSession.token)]);
    t.after(async () => {
      admin.disconnect();
      user.disconnect();
      await store.pool.execute('UPDATE default_decks SET cards = ?, revision = ? WHERE id = ?', [
        JSON.stringify(original.cards),
        original.revision,
        packId,
      ]);
      for (const id of createdRooms)
        await store.pool.execute('DELETE FROM rooms WHERE id = ?', [id]);
      for (const id of createdDecks)
        await store.pool.execute('DELETE FROM deck_cards WHERE deck_id = ?', [id]);
      await store.pool.execute(
        'DELETE FROM user_decks WHERE user_id IN (SELECT id FROM users WHERE username = ?)',
        [userSession.username],
      );
      await store.pool.execute('DELETE FROM sessions WHERE id IN (?, ?)', [
        adminSession.playerId,
        userSession.playerId,
      ]);
      await store.pool.execute('DELETE FROM users WHERE username = ?', [userSession.username]);
      await store.onModuleDestroy();
    });
    const before = unwrap(
      await rpc<RoomView>(user, 'room:create', {
        name: 'Before admin edit',
        password: 'test-secret',
        requestId: randomUUID(),
        packId,
      }),
    );
    createdRooms.push(before.id);
    assert.equal((await rpc(user, 'admin:systemDeck', { packId })).ok, false);
    const draft = unwrap(
      await rpc<{ cards: typeof original.cards; revision: number }>(admin, 'admin:systemDeck', {
        packId,
      }),
    );
    const cards = draft.cards.map((card, index) =>
      index === 0 ? { ...card, title: 'Admin updated title' } : card,
    );
    assert.equal(
      (await rpc(user, 'admin:updateSystemDeck', { packId, revision: draft.revision, cards })).ok,
      false,
    );
    assert.equal(
      (
        await rpc(admin, 'admin:updateSystemDeck', {
          packId,
          revision: draft.revision,
          cards: cards.map((card) => ({ ...card, category: 'challenge' })),
        })
      ).ok,
      false,
    );
    const updated = unwrap(
      await rpc<{ cards: typeof cards; revision: number }>(admin, 'admin:updateSystemDeck', {
        packId,
        revision: draft.revision,
        cards,
      }),
    );
    assert.equal(updated.revision, draft.revision + 1);
    const stale = await rpc(admin, 'admin:updateSystemDeck', {
      packId,
      revision: draft.revision,
      cards,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, 'STALE_REVISION');
    const after = unwrap(
      await rpc<RoomView>(user, 'room:create', {
        name: 'After admin edit',
        password: 'test-secret',
        requestId: randomUUID(),
        packId,
      }),
    );
    createdRooms.push(after.id);
    assert.equal(after.deck[0].title, 'Admin updated title');
    assert.equal(before.deck[0].title, original.cards[0].title);
    const cloned = unwrap(
      await rpc<OwnedDeck>(user, 'decks:cloneDefault', { packId, name: 'Fresh clone' }),
    );
    createdDecks.push(cloned.id);
    assert.equal(cloned.cards[0].title, 'Admin updated title');
    const next = unwrap(
      await rpc<{ cards: typeof cards; revision: number }>(admin, 'admin:updateSystemDeck', {
        packId,
        revision: updated.revision,
        cards: original.cards,
      }),
    );
    assert.equal(next.revision, updated.revision + 1);
    assert.equal((await store.read(after.id)).state.deck[0].title, 'Admin updated title');
    assert.equal(
      unwrap(await rpc<OwnedDeck>(user, 'decks:get', { deckId: cloned.id })).cards[0].title,
      'Admin updated title',
    );
  },
);

test(
  'group cards are seeded once; admin removal survives backend restart',
  { timeout: 30_000 },
  async (t) => {
    const store = new Store();
    await store.onModuleInit();
    const original = await store.systemDeck('chamly-50');
    t.after(async () => {
      const current = await store.systemDeck('chamly-50');
      if (current.revision !== original.revision)
        await store.updateSystemDeck('chamly-50', current.revision, original.cards);
      await store.onModuleDestroy();
    });
    const withoutOne = original.cards.filter((card) => card.id !== 'group-4');
    assert.equal(withoutOne.length, original.cards.length - 1);
    await store.updateSystemDeck('chamly-50', original.revision, withoutOne);
    const restarted = new Store();
    await restarted.onModuleInit();
    try {
      assert.equal(
        (await restarted.systemDeck('chamly-50')).cards.some((card) => card.id === 'group-4'),
        false,
      );
    } finally {
      await restarted.onModuleDestroy();
    }
  },
);

test(
  'room vote is authorized, broadcast and persisted before the next turn',
  { timeout: 30_000 },
  async (t) => {
    const players = await Promise.all(['Vote host', 'Vote guest'].map((name) => session(name)));
    const [host, guest] = await Promise.all(players.map((player) => open(player.token)));
    const store = new Store();
    await store.onModuleInit();
    let roomId = '';
    const seeded = await store.systemDeck('chamly-50');
    assert.equal(seeded.cards.filter((card) => card.id.startsWith('group-')).length, 4);
    const restarted = new Store();
    await restarted.onModuleInit();
    assert.equal((await restarted.systemDeck('chamly-50')).revision, seeded.revision);
    await restarted.onModuleDestroy();
    t.after(async () => {
      host.disconnect();
      guest.disconnect();
      if (roomId) await store.pool.execute('DELETE FROM rooms WHERE id = ?', [roomId]);
      for (const player of players)
        await store.pool.execute('DELETE FROM sessions WHERE id = ?', [player.playerId]);
      await store.onModuleDestroy();
    });
    let room = unwrap(
      await rpc<RoomView>(host, 'room:create', {
        name: 'Vote test',
        password: 'vote-secret',
        requestId: randomUUID(),
      }),
    );
    roomId = room.id;
    room = unwrap(await rpc<RoomView>(guest, 'room:join', { roomId, password: 'vote-secret' }));
    room = unwrap(
      await rpc<RoomView>(host, 'room:command', {
        roomId,
        revision: room.revision,
        requestId: randomUUID(),
        action: {
          type: 'saveDeck',
          cards: room.deck.filter((card) => card.category === 'challenge').slice(0, 2),
        },
      }),
    );
    room = unwrap(
      await rpc<RoomView>(host, 'room:command', {
        roomId,
        revision: room.revision,
        requestId: randomUUID(),
        action: { type: 'start' },
      }),
    );
    room = unwrap(
      await rpc<RoomView>(host, 'room:command', {
        roomId,
        revision: room.revision,
        requestId: randomUUID(),
        action: { type: 'pick', slot: 0 },
      }),
    );
    room = unwrap(
      await rpc<RoomView>(host, 'room:command', {
        roomId,
        revision: room.revision,
        requestId: randomUUID(),
        action: { type: 'requestVote', drinks: 2 },
      }),
    );
    assert.deepEqual(room.vote, { votedPlayerIds: [], total: 1 });
    assert.equal(
      (
        await rpc(host, 'room:command', {
          roomId,
          revision: room.revision,
          requestId: randomUUID(),
          action: { type: 'vote', accepted: true },
        })
      ).ok,
      false,
    );
    const guestView = unwrap(await rpc<RoomView>(guest, 'room:sync', { roomId }));
    assert.deepEqual(guestView.vote, room.vote);
    room = unwrap(
      await rpc<RoomView>(guest, 'room:command', {
        roomId,
        revision: room.revision,
        requestId: randomUUID(),
        action: { type: 'vote', accepted: true },
      }),
    );
    assert.equal(room.vote, null);
    assert.equal(room.history[0].completed, true);
    assert.deepEqual(room.history[0].votes, { accepted: 1, rejected: 0 });
    assert.equal((await store.read(roomId)).state.history[0].votes?.accepted, 1);
  },
);

test(
  'a fresh backend process restores a committed in-progress game from MySQL',
  { timeout: 45_000 },
  async (t) => {
    const localUrl = 'http://127.0.0.1:45105';
    let child: ChildProcess | undefined;
    let logs = '';
    async function start() {
      child = spawn(process.execPath, ['dist/apps/api/src/main.js'], {
        env: { ...process.env, API_PORT: '45105' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (chunk) => {
        logs += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        logs += chunk;
      });
      for (let i = 0; i < 80; i++) {
        if (child.exitCode !== null) throw new Error(logs);
        try {
          if ((await fetch(`${localUrl}/health`)).ok) return;
        } catch {
          /* Wait for listener. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Backend start timeout: ${logs}`);
    }
    async function stop() {
      if (child && child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
    }
    const store = new Store();
    await store.onModuleInit();
    let id = '';
    const sockets: Socket[] = [];
    const sessions: Session[] = [];
    t.after(async () => {
      sockets.forEach((s) => s.disconnect());
      await stop();
      if (id) await store.pool.execute('DELETE FROM rooms WHERE id = ?', [id]);
      for (const s of sessions)
        await store.pool.execute('DELETE FROM sessions WHERE id = ?', [s.playerId]);
      await store.onModuleDestroy();
    });
    await start();
    const host = await store.createIdentity('Restart host');
    const guest = await store.createIdentity('Restart guest');
    sessions.push(host, guest);
    function localOpen(token: string): Promise<Socket> {
      return new Promise((resolve, reject) => {
        const s = io(localUrl, { auth: { token }, reconnection: false });
        sockets.push(s);
        s.once('connect', () => resolve(s));
        s.once('connect_error', reject);
      });
    }
    const a = await localOpen(host.token);
    const b = await localOpen(guest.token);
    let room = unwrap(
      await rpc<RoomView>(a, 'room:create', {
        name: 'Restart test',
        password: 'restart-secret',
        requestId: randomUUID(),
      }),
    );
    id = room.id;
    room = unwrap(await rpc<RoomView>(b, 'room:join', { roomId: id, password: 'restart-secret' }));
    for (const action of [{ type: 'start' }, { type: 'pick', slot: 0 }] as Action[]) {
      room = unwrap(
        await rpc<RoomView>(a, 'room:command', {
          roomId: id,
          requestId: randomUUID(),
          revision: room.revision,
          action,
        }),
      );
    }
    const revealed = room.revealed;
    const revision = room.revision;
    await stop();
    await start();
    const restored = await localOpen(host.token);
    const snapshot = unwrap(await rpc<RoomView>(restored, 'room:sync', { roomId: id }));
    assert.equal(snapshot.revision, revision);
    assert.deepEqual(snapshot.revealed, revealed);
    assert.equal(snapshot.currentPlayerId, host.playerId);
    assert.equal(snapshot.playerCount, 2);
  },
);
