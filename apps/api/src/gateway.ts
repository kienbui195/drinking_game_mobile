import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { z, ZodError } from 'zod';
import {
  defaultPackId,
  type SystemDeck,
  type AdminOverview,
  type AdminRoom,
  type Reply,
  type RoomView,
} from '@chamly/shared';
import { applyAction, GameError, ensure } from './engine';
import { Store, type Identity, type StoredRoom } from './store';
import {
  commandSchema,
  createSchema,
  deckCloneSchema,
  deckCreateSchema,
  deckIdSchema,
  deckListSchema,
  deckUpdateSchema,
  displayNameSchema,
  joinSchema,
  passwordChangeSchema,
  systemDeckSchema,
  systemDeckUpdateSchema,
} from './validation';

export const allowedOrigins = () =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:45102,http://localhost:45103')
    .split(',')
    .map((s) => s.trim());
export function originAllowed(origin?: string) {
  if (!origin || allowedOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}
const roomIdSchema = z.object({ roomId: z.string().regex(/^[A-F0-9]{6}$/) });
const adminRoomSchema = z.object({ roomId: z.string().regex(/^[A-F0-9]{6}$/) });
const adminKickSchema = adminRoomSchema.extend({ playerId: z.string().max(80) });
const adminRenameSchema = adminRoomSchema.extend({ name: z.string().trim().min(1).max(60) });
const adminNoticeSchema = z.object({ message: z.string().trim().min(1).max(300) });
@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) =>
      cb(null, originAllowed(origin)),
  },
  allowRequest: (
    req: { headers: { origin?: string } },
    cb: (err: string | null, allow: boolean) => void,
  ) => cb(null, originAllowed(req.headers.origin)),
  maxHttpBufferSize: 512_000,
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private logger = new Logger(GameGateway.name);
  constructor(@Inject(Store) private readonly store: Store) {}
  afterInit(server: Server) {
    // Phòng hết hạn bị xóa bởi tiến trình dọn dẹp của Store; client cần biết ngay để rời phòng
    // thay vì chờ lần đồng bộ định kỳ kế tiếp thất bại.
    this.store.onExpired = (ids) => {
      for (const id of ids) {
        server.to(id).emit('room:expired');
        for (const peer of server.sockets.sockets.values()) {
          if (peer.data.roomId === id) {
            void peer.leave(id);
            peer.data.roomId = undefined;
          }
        }
      }
    };
    server.use(async (socket, next) => {
      try {
        socket.data.identity = await this.store.authenticate(socket.handshake.auth.token);
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
  }
  handleConnection(socket: Socket) {
    socket.data.window = Date.now();
    socket.data.count = 0;
  }
  async handleDisconnect(socket: Socket) {
    if (socket.data.roomId) {
      await this.updatePresence(socket.data.roomId);
      await this.publish(socket.data.roomId);
    }
  }
  private async updatePresence(roomId: string) {
    const online = (this.server.sockets.adapter.rooms.get(roomId)?.size ?? 0) > 0;
    await this.store.setPresence(roomId, online);
  }
  private view(room: StoredRoom): RoomView {
    const s = room.state;
    const members = this.server.sockets.adapter.rooms.get(room.id) ?? new Set<string>();
    const online = new Set(
      [...members].map((id) => this.server.sockets.sockets.get(id)?.data.identity?.id),
    );
    return {
      id: room.id,
      name: room.name,
      phase: s.phase,
      packId: s.packId ?? defaultPackId,
      revision: room.revision,
      expiresAt: room.expiresAt,
      serverTime: Date.now(),
      playerCount: s.players.filter((p) => p.active).length,
      hostId: s.hostId,
      players: s.players.map((p) => ({
        ...p,
        pouch: p.pouch ?? [],
        online: p.active && online.has(p.id),
      })),
      deck: s.deck,
      remainingCount: s.remaining.length,
      slots: s.slots.map((slot) => ({
        pickedBy: slot.pickedBy,
        card: slot.pickedBy ? slot.card : null,
      })),
      round: s.round,
      currentPlayerId: s.phase === 'playing' ? (s.players[s.turn]?.id ?? null) : null,
      revealed: s.pouchCard ?? (s.revealed === null ? null : s.slots[s.revealed].card),
      timerEndsAt: s.timerEndsAt,
      vote: s.vote
        ? {
            votedPlayerIds: s.players
              .filter((p) => p.active && p.id !== s.players[s.turn]?.id && p.id in s.vote!.choices)
              .map((p) => p.id),
            total: s.players.filter((p) => p.active && p.id !== s.players[s.turn]?.id).length,
          }
        : null,
      history: s.history,
    };
  }
  private async publish(id: string) {
    try {
      this.server.to(id).emit('room:state', this.view(await this.store.read(id)));
    } catch (e) {
      if (e instanceof GameError) this.server.to(id).emit('room:expired');
      else this.logger.error(e);
    }
  }
  private async attach(socket: Socket, room: StoredRoom) {
    const old = socket.data.roomId;
    if (old && old !== room.id) {
      await socket.leave(old);
      await this.updatePresence(old);
      await this.publish(old);
    }
    socket.data.roomId = room.id;
    await socket.join(room.id);
    await this.updatePresence(room.id);
    await this.publish(room.id);
    return this.view(await this.store.read(room.id));
  }
  private async run<T>(
    socket: Socket,
    action: (identity: Identity) => Promise<T>,
  ): Promise<Reply<T>> {
    try {
      if (Date.now() - socket.data.window > 60_000) {
        socket.data.window = Date.now();
        socket.data.count = 0;
      }
      ensure(++socket.data.count <= 120, 'RATE_LIMIT', 'Thao tác quá nhanh. Hãy đợi một phút.');
      const identity = await this.store.authenticate(socket.handshake.auth.token);
      return { ok: true, data: await action(identity) };
    } catch (e) {
      if (e instanceof ZodError)
        return {
          ok: false,
          code: 'VALIDATION',
          message: 'Dữ liệu chưa hợp lệ. Kiểm tra độ dài và giá trị đã nhập.',
        };
      if (e instanceof GameError)
        return {
          ok: false,
          code: e.code,
          message: e.message,
          ...(e.nextAllowedAt ? { nextAllowedAt: e.nextAllowedAt } : {}),
        };
      this.logger.error(e);
      return { ok: false, code: 'SERVER_ERROR', message: 'Server đang gặp lỗi. Hãy thử lại.' };
    }
  }
  @SubscribeMessage('rooms:list')
  list(@ConnectedSocket() socket: Socket) {
    return this.run(socket, () => this.store.list());
  }
  @SubscribeMessage('deck:default')
  deck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const packId =
      typeof body === 'object' && body ? (body as { packId?: string }).packId : undefined;
    return this.run(socket, () => this.store.defaultDeck(packId));
  }
  @SubscribeMessage('profile:get')
  profile(@ConnectedSocket() socket: Socket) {
    return this.run(socket, (identity) => this.store.profile(identity));
  }
  @SubscribeMessage('profile:changePassword')
  changePassword(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      const input = passwordChangeSchema.parse(body);
      await this.store.changePassword(identity, input.currentPassword, input.newPassword);
      return { ok: true };
    });
  }
  @SubscribeMessage('profile:changeDisplayName')
  changeDisplayName(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity) =>
      this.store.changeDisplayName(identity, displayNameSchema.parse(body).displayName),
    );
  }
  @SubscribeMessage('auth:logout')
  logout(@ConnectedSocket() socket: Socket) {
    return this.run(socket, async (identity) => {
      await this.store.logout(socket.handshake.auth.token, identity);
      // The acknowledgement must reach the client before closing its transport.
      setTimeout(() => socket.disconnect(), 0);
      return { ok: true };
    });
  }
  @SubscribeMessage('decks:list')
  listDecks(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity) =>
      this.store.listDecks(identity, deckListSchema.parse(body).packId),
    );
  }
  @SubscribeMessage('decks:get')
  getDeck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity) =>
      this.store.readDeck(identity, deckIdSchema.parse(body).deckId),
    );
  }
  @SubscribeMessage('decks:create')
  createDeck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity) => {
      const input = deckCreateSchema.parse(body);
      return this.store.createDeck(identity, input.packId, input.name);
    });
  }
  @SubscribeMessage('decks:cloneDefault')
  cloneDeck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity) => {
      const input = deckCloneSchema.parse(body);
      return this.store.cloneDefaultDeck(identity, input.packId, input.name);
    });
  }
  @SubscribeMessage('decks:update')
  updateDeck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity) => {
      const input = deckUpdateSchema.parse(body);
      return this.store.updateDeck(identity, input.deckId, input.name, input.cards);
    });
  }
  @SubscribeMessage('decks:delete')
  deleteDeck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      await this.store.deleteDeck(identity, deckIdSchema.parse(body).deckId);
      return { ok: true };
    });
  }
  @SubscribeMessage('room:create')
  create(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      const input = createSchema.parse(body);
      return this.attach(
        socket,
        await this.store.create(
          identity,
          input.name,
          input.password,
          input.requestId,
          input.packId,
          input.deckId,
        ),
      );
    });
  }
  @SubscribeMessage('room:join')
  join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      const input = joinSchema.parse(body);
      return this.attach(socket, await this.store.join(input.roomId, identity, input.password));
    });
  }
  /** Quyền quản trị gắn với phiên đăng nhập admin, nên còn hiệu lực sau khi reconnect. */
  private requireAdmin(identity: Identity) {
    ensure(identity.isAdmin === true, 'FORBIDDEN', 'Cần quyền quản trị.');
  }
  @SubscribeMessage('admin:systemDeck')
  adminSystemDeck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity): Promise<SystemDeck> => {
      this.requireAdmin(identity);
      return this.store.systemDeck(systemDeckSchema.parse(body).packId);
    });
  }
  @SubscribeMessage('admin:updateSystemDeck')
  adminUpdateSystemDeck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, (identity): Promise<SystemDeck> => {
      this.requireAdmin(identity);
      const input = systemDeckUpdateSchema.parse(body);
      return this.store.updateSystemDeck(input.packId, input.revision, input.cards);
    });
  }
  private adminRoomInfo(room: StoredRoom): AdminRoom {
    const members = this.server.sockets.adapter.rooms.get(room.id) ?? new Set<string>();
    const online = new Set(
      [...members].map((id) => this.server.sockets.sockets.get(id)?.data.identity?.id),
    );
    const s = room.state;
    return {
      id: room.id,
      name: room.name,
      packId: s.packId ?? defaultPackId,
      phase: s.phase,
      round: s.round,
      remainingCount: s.remaining.length,
      deckSize: s.deck.length,
      expiresAt: room.expiresAt,
      hostId: s.hostId,
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active,
        online: p.active && online.has(p.id),
        pouch: p.pouch?.length ?? 0,
      })),
    };
  }
  @SubscribeMessage('admin:overview')
  overview(@ConnectedSocket() socket: Socket) {
    return this.run(socket, async (identity): Promise<AdminOverview> => {
      this.requireAdmin(identity);
      const rooms = (await this.store.allRooms()).map((room) => this.adminRoomInfo(room));
      const identities = new Set<string>();
      for (const peer of this.server.sockets.sockets.values())
        if (peer.data.identity?.id) identities.add(peer.data.identity.id);
      const usage = new Map<string, { rooms: number; players: number }>();
      for (const room of rooms) {
        const entry = usage.get(room.packId) ?? { rooms: 0, players: 0 };
        entry.rooms++;
        entry.players += room.players.filter((p) => p.active).length;
        usage.set(room.packId, entry);
      }
      return {
        serverTime: Date.now(),
        connections: this.server.sockets.sockets.size,
        onlinePlayers: identities.size,
        sessions: await this.store.countSessions(),
        rooms,
        packUsage: [...usage].map(([packId, v]) => ({ packId, ...v })),
      };
    });
  }
  @SubscribeMessage('admin:deleteRoom')
  adminDelete(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      this.requireAdmin(identity);
      const { roomId } = adminRoomSchema.parse(body);
      await this.store.deleteRoom(roomId);
      this.server.to(roomId).emit('room:expired');
      for (const peer of this.server.sockets.sockets.values())
        if (peer.data.roomId === roomId) {
          await peer.leave(roomId);
          peer.data.roomId = undefined;
        }
      return { ok: true };
    });
  }
  @SubscribeMessage('admin:renameRoom')
  adminRename(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      this.requireAdmin(identity);
      const { roomId, name } = adminRenameSchema.parse(body);
      await this.store.renameRoom(roomId, name);
      await this.publish(roomId);
      return { ok: true };
    });
  }
  @SubscribeMessage('admin:kickPlayer')
  adminKick(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      this.requireAdmin(identity);
      const { roomId, playerId } = adminKickSchema.parse(body);
      await this.store.adminMutate(roomId, (room) => {
        const target = room.state.players.find((p) => p.id === playerId && p.active);
        ensure(target, 'NOT_MEMBER', 'Người chơi không còn trong phòng.');
        // Dùng đúng đường đi của hành động rời phòng để chuyển chủ phòng và lượt cho chuẩn.
        applyAction(room.state, playerId, { type: 'leave' });
      });
      await this.publish(roomId);
      for (const peer of this.server.sockets.sockets.values())
        if (peer.data.roomId === roomId && peer.data.identity?.id === playerId) {
          await peer.leave(roomId);
          peer.data.roomId = undefined;
          peer.emit('room:left');
        }
      return { ok: true };
    });
  }
  @SubscribeMessage('admin:endGame')
  adminEnd(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      this.requireAdmin(identity);
      const { roomId } = adminRoomSchema.parse(body);
      await this.store.adminMutate(roomId, (room) => {
        applyAction(room.state, room.state.hostId, { type: 'end' });
      });
      await this.publish(roomId);
      return { ok: true };
    });
  }
  @SubscribeMessage('admin:notice')
  adminNotice(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      this.requireAdmin(identity);
      const { message } = adminNoticeSchema.parse(body);
      this.server.emit('server:notice', message);
      return { ok: true };
    });
  }
  @SubscribeMessage('admin:prune')
  adminPrune(@ConnectedSocket() socket: Socket) {
    return this.run(socket, async (identity) => {
      this.requireAdmin(identity);
      return { removed: (await this.store.prune()).length };
    });
  }
  @SubscribeMessage('room:sync')
  sync(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      const { roomId } = roomIdSchema.parse(body);
      const room = await this.store.read(roomId);
      ensure(
        room.state.players.some((p) => p.id === identity.id && p.active),
        'NOT_MEMBER',
        'Không còn là thành viên phòng.',
      );
      return this.attach(socket, room);
    });
  }
  @SubscribeMessage('room:command')
  command(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      const cmd = commandSchema.parse(body);
      const result = await this.store.command(identity, cmd);
      const empty = !result.state.players.some((player) => player.active);
      if (!empty) await this.publish(result.id);
      if (cmd.action.type === 'leave') {
        for (const peer of this.server.sockets.sockets.values()) {
          if (peer.data.identity.id === identity.id && peer.data.roomId === result.id) {
            await peer.leave(result.id);
            peer.data.roomId = undefined;
            peer.emit('room:left');
          }
        }
        if (!empty) await this.updatePresence(result.id);
      }
      return this.view(result);
    });
  }
}
