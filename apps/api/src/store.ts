import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import {
  defaultPackId,
  type Card,
  type Command,
  type GameState,
  type RoomSummary,
} from '@chamly/shared';
import { applyAction, ensure, initialState, newPlayer } from './engine';
import { PACK_DECKS } from './packs';

const scrypt = promisify(scryptCallback);
const ttl = 24 * 60 * 60 * 1000;
// Phòng một người vẫn có thể đang được chủ phòng ngồi soạn bộ bài, nên giữ đủ lâu để làm việc
// đó rồi mới thu hồi tài nguyên.
export const soloTtl = 10 * 60 * 1000;
export const lifespan = (state: GameState) =>
  state.players.filter((p) => p.active).length <= 1 ? soloTtl : ttl;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const decode = <T>(value: T | string): T => (typeof value === 'string' ? JSON.parse(value) : value);
export interface Identity {
  id: string;
  name: string;
}
export interface StoredRoom {
  id: string;
  name: string;
  password: string;
  state: GameState;
  revision: number;
  receipts: string[];
  expiresAt: number;
}
const roomFromRow = (r: RowDataPacket): StoredRoom => ({
  id: r.id,
  name: r.name,
  password: r.password_hash,
  state: decode(r.state),
  revision: r.revision,
  receipts: decode(r.receipts),
  expiresAt: Number(r.expires_at),
});
@Injectable()
export class Store implements OnModuleInit, OnModuleDestroy {
  pool!: Pool;
  /** Gateway gắn callback này để báo cho client biết phòng vừa bị thu hồi. */
  onExpired?: (ids: string[]) => void;
  private cleanup?: ReturnType<typeof setInterval>;
  async onModuleInit() {
    this.pool = mysql.createPool({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 45101),
      user: process.env.MYSQL_USER ?? 'chamly',
      password: process.env.MYSQL_PASSWORD ?? 'local-app-change-me',
      database: process.env.MYSQL_DATABASE ?? 'chamly',
      connectionLimit: 10,
      charset: 'utf8mb4',
      supportBigNumbers: true,
    });
    // Idempotent bootstrap for this first schema. Future schema changes require versioned migrations.
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sessions (
      id CHAR(36) PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE,
      name VARCHAR(30) NOT NULL, expires_at BIGINT NOT NULL, INDEX(expires_at))`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS default_decks (
      id VARCHAR(40) PRIMARY KEY, cards JSON NOT NULL)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS rooms (
      id CHAR(6) PRIMARY KEY, name VARCHAR(60) NOT NULL, password_hash VARCHAR(200) NOT NULL,
      state JSON NOT NULL, revision INT NOT NULL DEFAULT 0, receipts JSON NOT NULL,
      expires_at BIGINT NOT NULL, create_key CHAR(64) NOT NULL UNIQUE, INDEX(expires_at))`);
    for (const [id, cards] of Object.entries(PACK_DECKS))
      await this.pool.execute('INSERT IGNORE INTO default_decks (id, cards) VALUES (?, ?)', [
        id,
        JSON.stringify(cards),
      ]);
    this.cleanup = setInterval(() => {
      void this.prune().catch(console.error);
    }, 10_000);
    this.cleanup.unref();
    await this.prune();
  }
  async onModuleDestroy() {
    clearInterval(this.cleanup);
    await this.pool.end();
  }
  async prune(): Promise<string[]> {
    const now = Date.now();
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM rooms WHERE expires_at < ?',
      [now],
    );
    const ids = rows.map((r) => r.id as string);
    if (ids.length) await this.pool.execute('DELETE FROM rooms WHERE expires_at < ?', [now]);
    await this.pool.execute('DELETE FROM sessions WHERE expires_at < ?', [now]);
    if (ids.length) this.onExpired?.(ids);
    return ids;
  }
  async createIdentity(name: string) {
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    await this.pool.execute('INSERT INTO sessions VALUES (?, ?, ?, ?)', [
      id,
      hash(token),
      name,
      Date.now() + 30 * ttl,
    ]);
    return { token, playerId: id, name };
  }
  async authenticate(token: unknown): Promise<Identity> {
    ensure(
      typeof token === 'string' && /^[a-f0-9]{64}$/.test(token),
      'UNAUTHORIZED',
      'Phiên đăng nhập không hợp lệ.',
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, name FROM sessions WHERE token_hash = ? AND expires_at > ?',
      [hash(token), Date.now()],
    );
    ensure(rows[0], 'UNAUTHORIZED', 'Phiên đã hết hạn. Hãy nhập lại tên.');
    return { id: rows[0].id, name: rows[0].name };
  }
  async defaultDeck(packId = defaultPackId): Promise<Card[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT cards FROM default_decks WHERE id = ?',
      [PACK_DECKS[packId] ? packId : defaultPackId],
    );
    return decode(rows[0].cards);
  }
  async create(
    identity: Identity,
    name: string,
    password: string,
    requestId: string,
    packId = defaultPackId,
  ) {
    const key = hash(`${identity.id}:${requestId}`);
    const [existing] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM rooms WHERE create_key = ? AND expires_at > ?',
      [key, Date.now()],
    );
    if (existing[0]) {
      const room = roomFromRow(existing[0]);
      ensure(
        room.state.players.some((p) => p.id === identity.id && p.active),
        'NOT_MEMBER',
        'Không còn là thành viên phòng đã tạo.',
      );
      return room;
    }
    const salt = randomBytes(16).toString('hex');
    const derived = (await scrypt(password, salt, 32)) as Buffer;
    const initial = initialState(
      newPlayer(identity.id, identity.name),
      await this.defaultDeck(packId),
      packId,
    );
    const room: StoredRoom = {
      id: randomBytes(3).toString('hex').toUpperCase(),
      name,
      password: `${salt}:${derived.toString('hex')}`,
      state: initial,
      revision: 0,
      receipts: [],
      expiresAt: Date.now() + lifespan(initial),
    };
    await this.pool.execute('INSERT INTO rooms VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      room.id,
      name,
      room.password,
      JSON.stringify(room.state),
      0,
      '[]',
      room.expiresAt,
      key,
    ]);
    return room;
  }
  /** Số phiên đăng nhập còn hiệu lực; dùng cho bảng quản trị. */
  async countSessions(): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM sessions WHERE expires_at > ?',
      [Date.now()],
    );
    return Number(rows[0]?.total ?? 0);
  }
  /** Toàn bộ phòng còn hiệu lực, kèm state đầy đủ. */
  async allRooms(): Promise<StoredRoom[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM rooms WHERE expires_at > ? ORDER BY expires_at DESC LIMIT 200',
      [Date.now()],
    );
    return rows.map(roomFromRow);
  }
  async deleteRoom(id: string): Promise<void> {
    await this.pool.execute('DELETE FROM rooms WHERE id = ?', [id]);
  }
  async renameRoom(id: string, name: string): Promise<StoredRoom> {
    await this.pool.execute('UPDATE rooms SET name = ? WHERE id = ?', [name, id]);
    return this.read(id);
  }
  /** Cho phép gateway chỉnh state phòng bằng quyền quản trị, vẫn đi qua khoá giao dịch. */
  async adminMutate(id: string, update: (room: StoredRoom) => void): Promise<StoredRoom> {
    return this.mutate(id, update);
  }
  async read(id: string): Promise<StoredRoom> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM rooms WHERE id = ? AND expires_at > ?',
      [id, Date.now()],
    );
    ensure(rows[0], 'ROOM_NOT_FOUND', 'Phòng không tồn tại hoặc đã hết hạn.');
    return roomFromRow(rows[0]);
  }
  async list(): Promise<RoomSummary[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, name,
      JSON_UNQUOTE(JSON_EXTRACT(state, '$.phase')) AS phase,
      JSON_UNQUOTE(JSON_EXTRACT(state, '$.packId')) AS pack_id,
      JSON_EXTRACT(state, '$.players') AS players
      FROM rooms WHERE expires_at > ? ORDER BY expires_at DESC LIMIT 100`,
      [Date.now()],
    );
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        phase: r.phase,
        // Phòng tạo trước khi có chủ đề không mang packId; coi như chủ đề mặc định.
        packId: r.pack_id ?? defaultPackId,
        playerCount: decode<GameState['players']>(r.players).filter((p) => p.active).length,
      }))
      .filter((r) => r.playerCount > 0);
  }
  async join(id: string, identity: Identity, password: string) {
    const initial = await this.read(id);
    const [salt, expected] = initial.password.split(':');
    const actual = (await scrypt(password, salt, 32)) as Buffer;
    ensure(
      timingSafeEqual(actual, Buffer.from(expected, 'hex')),
      'WRONG_PASSWORD',
      'Mật khẩu phòng chưa đúng.',
    );
    return this.mutate(id, (room) => {
      if (room.state.players.some((p) => p.id === identity.id && p.active)) return;
      ensure(
        room.state.phase === 'lobby',
        'ROOM_STARTED',
        'Phòng đã bắt đầu. Chỉ thành viên cũ được kết nối lại.',
      );
      ensure(room.state.players.length < 12, 'ROOM_FULL', 'Phòng đã đủ 12 người.');
      ensure(
        !room.state.players.some(
          (p) => p.name.toLocaleLowerCase() === identity.name.toLocaleLowerCase(),
        ),
        'DUPLICATE_NAME',
        'Tên đã có trong phòng. Hãy đổi tên trước khi vào.',
      );
      room.state.players.push(newPlayer(identity.id, identity.name));
    });
  }
  async command(identity: Identity, cmd: Command) {
    return this.mutate(cmd.roomId, (room) => {
      // Replays must not restore access after a member has left the room.
      ensure(
        room.state.players.some((p) => p.id === identity.id && p.active),
        'NOT_MEMBER',
        'Thành viên không còn trong phòng.',
      );
      const key = `${identity.id}:${cmd.requestId}`;
      if (room.receipts.includes(key)) return;
      ensure(
        room.revision === cmd.revision,
        'STALE_REVISION',
        'Phòng vừa thay đổi. Đã đồng bộ lại, hãy thử lại.',
      );
      applyAction(room.state, identity.id, cmd.action);
      room.receipts.push(key);
      room.receipts = room.receipts.slice(-200);
    });
  }
  private async mutate(id: string, update: (room: StoredRoom) => void): Promise<StoredRoom> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM rooms WHERE id = ? FOR UPDATE',
        [id],
      );
      ensure(
        rows[0] && Number(rows[0].expires_at) > Date.now(),
        'ROOM_NOT_FOUND',
        'Phòng không tồn tại hoặc đã hết hạn.',
      );
      const room = roomFromRow(rows[0]);
      const before = JSON.stringify(room.state);
      update(room);
      if (before !== JSON.stringify(room.state)) room.revision++;
      room.expiresAt = Date.now() + lifespan(room.state);
      await conn.execute(
        'UPDATE rooms SET state = ?, revision = ?, receipts = ?, expires_at = ? WHERE id = ?',
        [
          JSON.stringify(room.state),
          room.revision,
          JSON.stringify(room.receipts),
          room.expiresAt,
          id,
        ],
      );
      await conn.commit();
      return room;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
