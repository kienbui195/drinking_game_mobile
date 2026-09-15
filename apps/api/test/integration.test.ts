import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { Action, Reply, RoomView, Session } from '@chamly/shared';
import { Store } from '../src/store';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

const url = process.env.TEST_API_URL ?? 'http://localhost:3000';
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
    assert.equal(state.deck.length, 50);
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
  'a fresh backend process restores a committed in-progress game from MySQL',
  { timeout: 45_000 },
  async (t) => {
    const localUrl = 'http://127.0.0.1:3011';
    let child: ChildProcess | undefined;
    let logs = '';
    async function start() {
      child = spawn(process.execPath, ['dist/apps/api/src/main.js'], {
        env: { ...process.env, API_PORT: '3011' },
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
