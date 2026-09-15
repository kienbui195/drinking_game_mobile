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
import type { Reply, RoomView } from '@chamly/shared';
import { GameError, ensure } from './engine';
import { Store, type Identity, type StoredRoom } from './store';
import { commandSchema, createSchema, joinSchema } from './validation';

export const allowedOrigins = () =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:8081,http://localhost:8082')
    .split(',')
    .map((s) => s.trim());
export function originAllowed(origin?: string) {
  return !origin || allowedOrigins().includes(origin);
}
const roomIdSchema = z.object({ roomId: z.string().regex(/^[A-F0-9]{6}$/) });
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
    if (socket.data.roomId) await this.publish(socket.data.roomId);
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
      revision: room.revision,
      expiresAt: room.expiresAt,
      serverTime: Date.now(),
      playerCount: s.players.filter((p) => p.active).length,
      hostId: s.hostId,
      players: s.players.map((p) => ({ ...p, online: p.active && online.has(p.id) })),
      deck: s.deck,
      remainingCount: s.remaining.length,
      slots: s.slots.map((slot) => ({
        pickedBy: slot.pickedBy,
        card: slot.pickedBy ? slot.card : null,
      })),
      round: s.round,
      currentPlayerId: s.phase === 'playing' ? (s.players[s.turn]?.id ?? null) : null,
      revealed: s.revealed === null ? null : s.slots[s.revealed].card,
      timerEndsAt: s.timerEndsAt,
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
      await this.publish(old);
    }
    socket.data.roomId = room.id;
    await socket.join(room.id);
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
      if (e instanceof GameError) return { ok: false, code: e.code, message: e.message };
      this.logger.error(e);
      return { ok: false, code: 'SERVER_ERROR', message: 'Server đang gặp lỗi. Hãy thử lại.' };
    }
  }
  @SubscribeMessage('rooms:list')
  list(@ConnectedSocket() socket: Socket) {
    return this.run(socket, () => this.store.list());
  }
  @SubscribeMessage('deck:default')
  deck(@ConnectedSocket() socket: Socket) {
    return this.run(socket, () => this.store.defaultDeck());
  }
  @SubscribeMessage('room:create')
  create(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.run(socket, async (identity) => {
      const input = createSchema.parse(body);
      return this.attach(
        socket,
        await this.store.create(identity, input.name, input.password, input.requestId),
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
      await this.publish(result.id);
      if (cmd.action.type === 'leave') {
        for (const peer of this.server.sockets.sockets.values()) {
          if (peer.data.identity.id === identity.id && peer.data.roomId === result.id) {
            await peer.leave(result.id);
            peer.data.roomId = undefined;
            peer.emit('room:left');
          }
        }
      }
      return this.view(result);
    });
  }
}
