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
  type OwnedDeck,
  type Profile,
  type RoomSummary,
} from '@chamly/shared';
import { applyAction, ensure, GameError, initialState, newPlayer } from './engine';
import { PACK_DECKS } from './packs';
import { packById } from '@chamly/shared';

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
  userId?: string;
  username?: string;
  isAdmin?: boolean;
}
/** Tài khoản quản trị giữ nguyên như trước: username mặc định là tên phòng admin cũ. */
export const adminUsername = () =>
  process.env.ADMIN_USERNAME ?? process.env.ADMIN_ROOM_NAME ?? 'adminserverday';
export const adminPassword = () => process.env.ADMIN_PASSWORD ?? '';
/** So sánh không phụ thuộc độ dài chuỗi, tránh rò rỉ thông tin qua thời gian phản hồi. */
function adminPasswordMatches(input: string): boolean {
  const expected = adminPassword();
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
const displayNameChangeInterval = 7 * 24 * 60 * 60 * 1000;
const passwordHash = async (password: string) => {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
};
const passwordMatches = async (password: string, stored: string) => {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = (await scrypt(password, salt, 32)) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
};
export const usernameBase = (displayName: string) => {
  const normalized = displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return normalized || 'player';
};
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
    await this.pool.query(`CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY, username VARCHAR(40) NOT NULL UNIQUE,
      display_name VARCHAR(30) NOT NULL, password_hash VARCHAR(200) NOT NULL,
      display_name_changed_at BIGINT NOT NULL, created_at BIGINT NOT NULL)`);
    // MySQL does not support ADD COLUMN IF NOT EXISTS, so inspect the schema before migrating
    // legacy anonymous sessions to account-backed sessions.
    for (const [column, definition] of [
      ['user_id', 'user_id CHAR(36) NULL'],
      ['started_at', 'started_at BIGINT NULL'],
      ['is_admin', 'is_admin TINYINT(1) NOT NULL DEFAULT 0'],
    ]) {
      const [columns] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'sessions' AND column_name = ?`,
        [column],
      );
      if (!columns[0]) await this.pool.query(`ALTER TABLE sessions ADD COLUMN ${definition}`);
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS session_durations (
      session_id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL,
      started_at BIGINT NOT NULL, ended_at BIGINT NOT NULL, INDEX(user_id))`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS user_decks (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, pack_id VARCHAR(40) NOT NULL,
      name VARCHAR(60) NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
      INDEX(user_id, pack_id))`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS deck_cards (
      deck_id CHAR(36) NOT NULL, card_id VARCHAR(80) NOT NULL, position INT NOT NULL,
      card JSON NOT NULL, PRIMARY KEY(deck_id, card_id), INDEX(deck_id, position))`);
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
    const [expired] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, user_id, started_at FROM sessions WHERE expires_at < ? AND user_id IS NOT NULL',
      [now],
    );
    for (const session of expired)
      await this.recordSessionDuration(
        session.id,
        session.user_id,
        Number(session.started_at),
        now,
      );
    await this.pool.execute('DELETE FROM sessions WHERE expires_at < ?', [now]);
    if (ids.length) this.onExpired?.(ids);
    return ids;
  }
  async createIdentity(name: string) {
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    await this.pool.execute(
      'INSERT INTO sessions (id, token_hash, name, expires_at, started_at) VALUES (?, ?, ?, ?, ?)',
      [id, hash(token), name, Date.now() + 30 * ttl, Date.now()],
    );
    return { token, playerId: id, name };
  }
  async authenticate(token: unknown): Promise<Identity> {
    ensure(
      typeof token === 'string' && /^[a-f0-9]{64}$/.test(token),
      'UNAUTHORIZED',
      'Phiên đăng nhập không hợp lệ.',
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT sessions.id, sessions.name, sessions.user_id, sessions.is_admin, users.username
       FROM sessions LEFT JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      [hash(token), Date.now()],
    );
    ensure(rows[0], 'UNAUTHORIZED', 'Phiên đã hết hạn. Hãy nhập lại tên.');
    return {
      id: rows[0].id,
      name: rows[0].name,
      ...(rows[0].user_id ? { userId: rows[0].user_id, username: rows[0].username } : {}),
      ...(Number(rows[0].is_admin) === 1 ? { isAdmin: true as const } : {}),
    };
  }
  private async createSession(
    user: { id?: string; displayName: string; username: string },
    isAdmin = false,
  ) {
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    const now = Date.now();
    await this.pool.execute(
      `INSERT INTO sessions (id, token_hash, name, expires_at, user_id, started_at, is_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, hash(token), user.displayName, now + 30 * ttl, user.id ?? null, now, Number(isAdmin)],
    );
    return {
      token,
      playerId: id,
      name: user.displayName,
      username: user.username,
      ...(isAdmin ? { isAdmin: true as const } : {}),
    };
  }
  async register(displayName: string, password: string) {
    const id = randomUUID();
    const base = usernameBase(displayName);
    const now = Date.now();
    for (let suffix = 0; suffix < 10_000; suffix++) {
      const username = suffix ? `${base}-${suffix}` : base;
      // Giữ username quản trị cho tài khoản admin đăng nhập qua form đăng nhập.
      if (username.toLowerCase() === adminUsername().toLowerCase()) continue;
      try {
        await this.pool.execute(
          `INSERT INTO users (id, username, display_name, password_hash, display_name_changed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, username, displayName, await passwordHash(password), 0, now],
        );
        return this.createSession({ id, username, displayName });
      } catch (error) {
        if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
      }
    }
    throw new GameError('USERNAME_UNAVAILABLE', 'Không thể tạo username. Hãy thử lại.');
  }
  async login(username: string, password: string) {
    // Một form đăng nhập duy nhất: đúng username + mật khẩu admin thì vào thẳng phiên quản trị.
    if (username.trim().toLowerCase() === adminUsername().toLowerCase())
      return this.adminLogin(username, password);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, username, display_name, password_hash FROM users WHERE username = ?',
      [username.trim().toLowerCase()],
    );
    ensure(
      rows[0] && (await passwordMatches(password, rows[0].password_hash)),
      'UNAUTHORIZED',
      'Username hoặc mật khẩu không đúng.',
    );
    return this.createSession({
      id: rows[0].id,
      username: rows[0].username,
      displayName: rows[0].display_name,
    });
  }
  /** Đăng nhập quản trị qua form đăng nhập, tài khoản giữ nguyên như trước. */
  async adminLogin(username: string, password: string) {
    ensure(
      username.trim().toLowerCase() === adminUsername().toLowerCase() &&
        adminPasswordMatches(password),
      'UNAUTHORIZED',
      'Username hoặc mật khẩu không đúng.',
    );
    return this.createSession(
      { displayName: 'Quản Trị', username: adminUsername().toLowerCase() },
      true,
    );
  }
  private async recordSessionDuration(
    sessionId: string,
    userId: string,
    startedAt: number,
    endedAt: number,
  ) {
    await this.pool.execute(
      'INSERT IGNORE INTO session_durations (session_id, user_id, started_at, ended_at) VALUES (?, ?, ?, ?)',
      [sessionId, userId, startedAt, Math.max(startedAt, endedAt)],
    );
  }
  private requireUser(identity: Identity): string {
    ensure(identity.userId, 'ACCOUNT_REQUIRED', 'Hãy đăng nhập bằng tài khoản.');
    return identity.userId;
  }
  async logout(token: unknown, identity: Identity) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, user_id, started_at FROM sessions WHERE token_hash = ?',
      [hash(String(token))],
    );
    if (rows[0]) {
      // Phiên quản trị không gắn với tài khoản user nên chỉ cần xóa, không ghi thời lượng.
      if (rows[0].user_id)
        await this.recordSessionDuration(
          rows[0].id,
          rows[0].user_id,
          Number(rows[0].started_at),
          Date.now(),
        );
      await this.pool.execute('DELETE FROM sessions WHERE id = ?', [rows[0].id]);
    }
  }
  async profile(identity: Identity): Promise<Profile> {
    const userId = this.requireUser(identity);
    const [users] = await this.pool.execute<RowDataPacket[]>(
      'SELECT username, display_name, display_name_changed_at FROM users WHERE id = ?',
      [userId],
    );
    ensure(users[0], 'UNAUTHORIZED', 'Tài khoản không tồn tại.');
    const [durations] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ended_at - started_at), 0) AS total
       FROM session_durations WHERE user_id = ?`,
      [userId],
    );
    const [active] = await this.pool.execute<RowDataPacket[]>(
      'SELECT COALESCE(SUM(? - started_at), 0) AS total FROM sessions WHERE user_id = ?',
      [Date.now(), userId],
    );
    const [decks] = await this.pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM user_decks WHERE user_id = ?',
      [userId],
    );
    const changedAt = Number(users[0].display_name_changed_at);
    // Làm tròn sẵn 2 chữ số thập phân để mọi client hiển thị gọn, không lộ số lẻ dài.
    const onlineHours =
      Math.round((Number(durations[0].total) + Number(active[0].total)) / 36_000) / 100;
    return {
      username: users[0].username,
      displayName: users[0].display_name,
      onlineHours,
      deckCount: Number(decks[0].total),
      displayNameChangeAllowedAt: changedAt + displayNameChangeInterval,
    };
  }
  async changePassword(identity: Identity, currentPassword: string, newPassword: string) {
    const userId = this.requireUser(identity);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId],
    );
    ensure(
      rows[0] && (await passwordMatches(currentPassword, rows[0].password_hash)),
      'WRONG_PASSWORD',
      'Mật khẩu hiện tại không đúng.',
    );
    await this.pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
      await passwordHash(newPassword),
      userId,
    ]);
  }
  async changeDisplayName(identity: Identity, displayName: string) {
    const userId = this.requireUser(identity);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT display_name_changed_at FROM users WHERE id = ?',
      [userId],
    );
    ensure(rows[0], 'UNAUTHORIZED', 'Tài khoản không tồn tại.');
    const allowedAt = Number(rows[0].display_name_changed_at) + displayNameChangeInterval;
    if (Date.now() < allowedAt)
      throw new GameError(
        'DISPLAY_NAME_COOLDOWN',
        `Có thể đổi tên lại từ ${new Date(allowedAt).toISOString()}.`,
        allowedAt,
      );
    await this.pool.execute(
      'UPDATE users SET display_name = ?, display_name_changed_at = ? WHERE id = ?',
      [displayName, Date.now(), userId],
    );
    await this.pool.execute('UPDATE sessions SET name = ? WHERE user_id = ?', [
      displayName,
      userId,
    ]);
    return this.profile({ ...identity, name: displayName });
  }
  async defaultDeck(packId = defaultPackId): Promise<Card[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT cards FROM default_decks WHERE id = ?',
      [PACK_DECKS[packId] ? packId : defaultPackId],
    );
    return decode(rows[0].cards);
  }
  private validateDeckCards(packId: string, cards: Card[]) {
    const pack = packById(packId);
    ensure(PACK_DECKS[packId], 'VALIDATION', 'Game không hợp lệ.');
    ensure(
      new Set(cards.map((card) => card.id)).size === cards.length,
      'VALIDATION',
      'Mã lá bài bị trùng.',
    );
    ensure(
      cards.every((card) => pack.categories.includes(card.category)),
      'VALIDATION',
      'Category không thuộc game đã chọn.',
    );
  }
  private async deckFromRow(row: RowDataPacket): Promise<OwnedDeck> {
    const [cards] = await this.pool.execute<RowDataPacket[]>(
      'SELECT card FROM deck_cards WHERE deck_id = ? ORDER BY position',
      [row.id],
    );
    return {
      id: row.id,
      name: row.name,
      packId: row.pack_id,
      cards: cards.map((card) => decode<Card>(card.card)),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
  async listDecks(identity: Identity, packId?: string): Promise<OwnedDeck[]> {
    const userId = this.requireUser(identity);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_decks WHERE user_id = ?${packId ? ' AND pack_id = ?' : ''} ORDER BY updated_at DESC`,
      packId ? [userId, packId] : [userId],
    );
    return Promise.all(rows.map((row) => this.deckFromRow(row)));
  }
  async readDeck(identity: Identity, deckId: string): Promise<OwnedDeck> {
    const userId = this.requireUser(identity);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM user_decks WHERE id = ? AND user_id = ?',
      [deckId, userId],
    );
    ensure(rows[0], 'DECK_NOT_FOUND', 'Không tìm thấy bộ bài.');
    return this.deckFromRow(rows[0]);
  }
  private async writeCards(deckId: string, cards: Card[]) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM deck_cards WHERE deck_id = ?', [deckId]);
      for (const [position, card] of cards.entries())
        await conn.execute(
          'INSERT INTO deck_cards (deck_id, card_id, position, card) VALUES (?, ?, ?, ?)',
          [deckId, card.id, position, JSON.stringify(card)],
        );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
  async createDeck(identity: Identity, packId: string, name: string, cards: Card[] = []) {
    const userId = this.requireUser(identity);
    this.validateDeckCards(packId, cards);
    const id = randomUUID();
    const now = Date.now();
    await this.pool.execute('INSERT INTO user_decks VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      userId,
      packId,
      name,
      now,
      now,
    ]);
    await this.writeCards(id, cards);
    return this.readDeck(identity, id);
  }
  async cloneDefaultDeck(identity: Identity, packId: string, name: string) {
    return this.createDeck(identity, packId, name, await this.defaultDeck(packId));
  }
  async updateDeck(identity: Identity, deckId: string, name?: string, cards?: Card[]) {
    const deck = await this.readDeck(identity, deckId);
    if (cards) this.validateDeckCards(deck.packId, cards);
    if (name || cards) {
      await this.pool.execute('UPDATE user_decks SET name = ?, updated_at = ? WHERE id = ?', [
        name ?? deck.name,
        Date.now(),
        deckId,
      ]);
      if (cards) await this.writeCards(deckId, cards);
    }
    return this.readDeck(identity, deckId);
  }
  async deleteDeck(identity: Identity, deckId: string) {
    await this.readDeck(identity, deckId);
    await this.pool.execute('DELETE FROM deck_cards WHERE deck_id = ?', [deckId]);
    await this.pool.execute('DELETE FROM user_decks WHERE id = ?', [deckId]);
  }
  async create(
    identity: Identity,
    name: string,
    password: string,
    requestId: string,
    packId = defaultPackId,
    deckId?: string,
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
    let cards: Card[];
    if (deckId) {
      const deck = await this.readDeck(identity, deckId);
      ensure(deck.packId === packId, 'DECK_PACK_MISMATCH', 'Bộ bài không thuộc game đã chọn.');
      ensure(deck.cards.length >= 2, 'DECK_TOO_SMALL', 'Bộ bài cần ít nhất 2 lá.');
      cards = deck.cards;
    } else {
      ensure(!identity.userId, 'DECK_REQUIRED', 'Hãy chọn bộ bài của bạn trước khi tạo phòng.');
      cards = await this.defaultDeck(packId);
    }
    const initial = initialState(
      newPlayer(identity.id, identity.name),
      structuredClone(cards),
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
