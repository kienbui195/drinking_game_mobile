import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  type CanActivate,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { categories, packById, packs, type Card } from '@chamly/shared';
import { cardSchema } from './validation';
import { GameError } from './engine';
import { GameGateway } from './gateway';
import { Store } from './store';

// "Hợp đồng quản trị" v1 của dashboard chung admin.baodom.xyz (xem admin-hub/AGENT.md trong repo
// game_hoc_tieng_anh). Hub gọi thẳng trong mạng Docker; Caddy không bao giờ chuyển /admin-api ra ngoài.
const CONTRACT_VERSION = 1;
const GAME = { key: 'chamly', name: 'Chạm Ly', version: process.env.APP_VERSION ?? '0.1.0' };
const adminToken = () => process.env.ADMIN_API_TOKEN ?? '';

type Rec = Record<string, unknown>;
type FieldError = { name: string; message: string };
const bad = (status: number, code: string, message: string, fields?: FieldError[]) =>
  new HttpException({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
const notFound = (message = 'Không tìm thấy bản ghi.') => bad(404, 'not_found', message);
const invalid = (message: string, fields?: FieldError[]) => bad(422, 'validation', message, fields);

@Injectable()
class AdminTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const expected = Buffer.from(adminToken());
    if (expected.length < 32) throw bad(401, 'unauthorized', 'Chưa cấu hình token quản trị.');
    // Đi qua Cloudflare/Caddy sẽ để lại các header này; hub gọi thẳng nên không bao giờ có.
    if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'])
      throw bad(401, 'unauthorized', 'Không nhận yêu cầu đi qua proxy.');
    const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw bad(401, 'unauthorized', 'Sai hoặc thiếu token.');
    return true;
  }
}

type FieldType = 'string' | 'text' | 'int' | 'bool' | 'enum' | 'datetime';
const f = (name: string, label: string, type: FieldType, opts: Rec = {}) => ({
  name,
  label,
  type,
  required: false,
  unique: false,
  readonly: false,
  list: false,
  filter: false,
  search: false,
  sortable: false,
  ...opts,
});
const packIds = packs.map((p) => p.id);
const phases = ['lobby', 'playing', 'depleted', 'ended'];

const META = {
  game: GAME,
  contractVersion: CONTRACT_VERSION,
  resources: [
    {
      key: 'overview',
      label: 'Tổng quan',
      kind: 'singleton',
      primaryKey: 'id',
      allowCreate: false,
      allowDelete: false,
      allowEdit: false,
      allowExport: false,
      actions: [],
      description: 'Số liệu đang chạy của máy chủ game.',
      fields: [
        f('connections', 'Kết nối socket', 'int', { readonly: true }),
        f('onlinePlayers', 'Người đang online', 'int', { readonly: true }),
        f('sessions', 'Phiên đăng nhập còn hạn', 'int', { readonly: true }),
        f('rooms', 'Phòng đang mở', 'int', { readonly: true }),
        f('users', 'Tài khoản', 'int', { readonly: true }),
      ],
    },
    {
      key: 'notice',
      label: 'Thông báo',
      kind: 'singleton',
      primaryKey: 'id',
      allowCreate: false,
      allowDelete: false,
      allowExport: false,
      actions: [],
      description: 'Lưu là gửi ngay một thông báo nổi tới mọi người đang mở game.',
      fields: [
        f('message', 'Nội dung', 'text', { required: true, maxLength: 300 }),
        f('sentAt', 'Gửi lúc', 'datetime', { readonly: true }),
      ],
    },
    {
      key: 'rooms',
      label: 'Phòng đang mở',
      kind: 'collection',
      primaryKey: 'id',
      allowCreate: false,
      allowDelete: true,
      actions: [
        { name: 'end', label: 'Kết thúc ván', when: { field: 'phase', equals: 'playing' } },
        { name: 'end', label: 'Kết thúc ván', when: { field: 'phase', equals: 'depleted' } },
      ],
      fields: [
        f('id', 'Mã phòng', 'string', { readonly: true, list: true, search: true, sortable: true }),
        f('name', 'Tên phòng', 'string', {
          required: true,
          list: true,
          search: true,
          sortable: true,
          maxLength: 60,
        }),
        f('packId', 'Game', 'enum', { readonly: true, list: true, filter: true, enum: packIds }),
        f('phase', 'Giai đoạn', 'enum', { readonly: true, list: true, filter: true, enum: phases }),
        f('players', 'Người chơi', 'int', { readonly: true, list: true, sortable: true }),
        f('online', 'Đang online', 'int', { readonly: true, list: true, sortable: true }),
        f('round', 'Vòng', 'int', { readonly: true, list: true }),
        f('remaining', 'Lá còn lại', 'int', { readonly: true }),
        f('deckSize', 'Số lá', 'int', { readonly: true }),
        f('expiresAt', 'Hết hạn', 'datetime', { readonly: true, list: true, sortable: true }),
      ],
    },
    {
      key: 'room-players',
      label: 'Người trong phòng',
      kind: 'collection',
      primaryKey: 'id',
      allowCreate: false,
      allowDelete: true,
      allowEdit: false,
      description: 'Xóa một dòng là mời người đó ra khỏi phòng (kick).',
      actions: [],
      fields: [
        f('id', 'Mã', 'string', { readonly: true }),
        f('roomId', 'Mã phòng', 'string', {
          readonly: true,
          list: true,
          filter: true,
          sortable: true,
        }),
        f('roomName', 'Tên phòng', 'string', { readonly: true, list: true, search: true }),
        f('name', 'Tên người chơi', 'string', {
          readonly: true,
          list: true,
          search: true,
          sortable: true,
        }),
        f('host', 'Chủ phòng', 'bool', { readonly: true, list: true }),
        f('online', 'Online', 'bool', { readonly: true, list: true, filter: true }),
        f('drinksTaken', 'Số ngụm', 'int', { readonly: true, list: true, sortable: true }),
        f('cardsDrawn', 'Lá đã bốc', 'int', { readonly: true, list: true, sortable: true }),
      ],
    },
    {
      key: 'cards',
      label: 'Lá bài hệ thống',
      kind: 'collection',
      primaryKey: 'key',
      allowCreate: true,
      allowDelete: true,
      description:
        'Bộ bài mặc định của từng game. Phòng mới và bộ bài người chơi sao chép sau khi sửa sẽ nhận bản mới; phòng đang chơi giữ nguyên.',
      actions: [],
      import: { formats: ['csv', 'json'], matchKey: 'id' },
      fields: [
        f('key', 'Khóa', 'string', { readonly: true }),
        f('packId', 'Game', 'enum', {
          required: true,
          list: true,
          filter: true,
          sortable: true,
          enum: packIds,
          hint: 'Không đổi được sau khi tạo.',
        }),
        f('id', 'Mã lá', 'string', {
          list: true,
          search: true,
          maxLength: 80,
          hint: 'Để trống thì tự sinh. Không đổi được sau khi tạo.',
        }),
        f('title', 'Tiêu đề', 'string', {
          required: true,
          list: true,
          search: true,
          sortable: true,
          maxLength: 100,
        }),
        f('category', 'Nhóm', 'enum', {
          required: true,
          list: true,
          filter: true,
          sortable: true,
          enum: [...categories],
          hint: 'Phải thuộc các nhóm của game đã chọn.',
        }),
        f('description', 'Nội dung', 'text', { required: true, search: true, maxLength: 1500 }),
        f('penalty', 'Hình phạt', 'text', { required: true, maxLength: 500 }),
        f('drinksCount', 'Số ngụm', 'int', { required: true, list: true, sortable: true }),
        f('hasTimer', 'Có đếm ngược', 'bool'),
        f('timerSeconds', 'Số giây đếm ngược', 'int'),
        f('highlight', 'Điểm nhấn', 'string', { maxLength: 300 }),
        f('answer', 'Đáp án', 'string', { maxLength: 500 }),
        f('keepable', 'Cất vào túi được', 'bool', { list: true }),
      ],
    },
    {
      key: 'users',
      label: 'Tài khoản',
      kind: 'collection',
      primaryKey: 'id',
      allowCreate: false,
      allowDelete: true,
      description: 'Xóa tài khoản xóa luôn bộ bài cá nhân và đăng xuất mọi phiên của người đó.',
      actions: [],
      fields: [
        f('id', 'Mã', 'string', { readonly: true }),
        f('username', 'Username', 'string', {
          readonly: true,
          list: true,
          search: true,
          sortable: true,
        }),
        f('displayName', 'Tên hiển thị', 'string', {
          required: true,
          list: true,
          search: true,
          sortable: true,
          maxLength: 30,
        }),
        f('deckCount', 'Bộ bài', 'int', { readonly: true, list: true, sortable: true }),
        f('createdAt', 'Ngày tạo', 'datetime', { readonly: true, list: true, sortable: true }),
      ],
    },
  ],
};
const resourceMeta = (key: string) => {
  const meta = META.resources.find((r) => r.key === key);
  if (!meta) throw notFound(`Không có tài nguyên "${key}".`);
  return meta;
};

// ---------------------------------------------------------------- CSV (RFC 4180)
const BOM = '﻿';
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (quoted) throw invalid('CSV có dấu ngoặc kép chưa đóng.');
  if (cell !== '' || row.length) endRow();
  return rows;
}
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Chặn công thức khi mở bằng Excel; app Chạm Ly cũng bỏ đúng dấu nháy này lúc nhập.
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const stringifyCsv = (header: string[], rows: Rec[]) =>
  BOM +
  [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\r\n') +
  '\r\n';

// ---------------------------------------------------------------- lá bài
const cardKey = (packId: string, id: string) => `${packId}.${id}`;
const splitCardKey = (key: string) => {
  const at = key.indexOf('.');
  if (at < 0) throw notFound('Không có lá bài này.');
  return { packId: key.slice(0, at), id: key.slice(at + 1) };
};
const cardRecord = (packId: string, card: Card): Rec => ({
  key: cardKey(packId, card.id),
  packId,
  id: card.id,
  title: card.title,
  category: card.category,
  description: card.description,
  penalty: card.penalty,
  drinksCount: card.drinksCount,
  hasTimer: card.hasTimer ?? false,
  timerSeconds: card.timerSeconds ?? null,
  highlight: card.highlight ?? null,
  answer: card.answer ?? null,
  keepable: card.keepable ?? false,
});
const cardFields = [
  'packId',
  'id',
  'title',
  'category',
  'description',
  'penalty',
  'drinksCount',
  'hasTimer',
  'timerSeconds',
  'highlight',
  'answer',
  'keepable',
];
const blank = (v: unknown) => v === null || v === undefined || v === '';
// Ô CSV đều là chuỗi; form của hub gửi số/bool đúng kiểu. Nhận cả hai.
const asText = (v: unknown) => {
  if (blank(v)) return undefined;
  const s = String(v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
};
const asInt = (v: unknown) => (blank(v) ? undefined : Number(v));
const asBool = (v: unknown) =>
  blank(v) ? undefined : v === true || /^(true|1|x|yes|có|co)$/i.test(String(v).trim());

/** Ghép giá trị mới lên lá cũ (nếu có) rồi kiểm theo đúng luật của bộ bài hệ thống. */
function buildCard(
  values: Rec,
  base?: Card,
): { packId?: string; card?: Card; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const packId = asText(values.packId);
  if (!packId || !packIds.includes(packId))
    return { errors: [{ name: 'packId', message: 'Game không hợp lệ.' }] };
  const pick = <T>(name: string, read: (v: unknown) => T | undefined, fallback: T | undefined) =>
    name in values ? read(values[name]) : fallback;
  const draft: Rec = {
    id: pick('id', asText, base?.id) ?? randomUUID(),
    title: pick('title', asText, base?.title),
    category: pick('category', asText, base?.category),
    description: pick('description', asText, base?.description),
    penalty: pick('penalty', asText, base?.penalty),
    drinksCount: pick('drinksCount', asInt, base?.drinksCount),
    hasTimer: pick('hasTimer', asBool, base?.hasTimer),
    timerSeconds: pick('timerSeconds', asInt, base?.timerSeconds),
    highlight: pick('highlight', asText, base?.highlight),
    answer: pick('answer', asText, base?.answer),
    keepable: pick('keepable', asBool, base?.keepable),
  };
  for (const key of Object.keys(draft)) if (draft[key] === undefined) delete draft[key];
  if (!draft.hasTimer) delete draft.timerSeconds;
  const parsed = cardSchema.safeParse(draft);
  if (!parsed.success)
    for (const issue of parsed.error.issues)
      errors.push({
        name: String(
          issue.path[0] ?? (issue.message.includes('đếm ngược') ? 'timerSeconds' : 'id'),
        ),
        message: issue.message.includes('đếm ngược')
          ? issue.message
          : issue.code === 'too_small' || issue.code === 'invalid_type'
            ? 'Bắt buộc nhập.'
            : 'Giá trị không hợp lệ.',
      });
  const category = String(draft.category ?? '');
  if (
    (categories as readonly string[]).includes(category) &&
    !(packById(packId).categories as string[]).includes(category)
  )
    errors.push({ name: 'category', message: 'Nhóm không thuộc game đã chọn.' });
  return errors.length ? { packId, errors } : { packId, card: parsed.data as Card, errors };
}
// `false` và trường bỏ trống cùng nghĩa, để nhập lại đúng file vừa xuất không bị tính là sửa.
const normalized = (card: Card) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(card)
        .filter(([, v]) => v !== undefined && v !== false && v !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
const sameCard = (a: Card, b: Card) => normalized(a) === normalized(b);

// ---------------------------------------------------------------- danh sách trong bộ nhớ
// Phòng, lá bài và tài khoản của game này đều nhỏ (vài trăm dòng), nên lọc/sắp xếp/phân trang
// trên bộ nhớ là đủ và giữ một đường đi chung cho mọi tài nguyên.
interface ListQuery {
  page?: string;
  pageSize?: string;
  sort?: string;
  q?: string;
  filter?: Record<string, string>;
}
function paginate(resource: string, rows: Rec[], query: ListQuery) {
  const meta = resourceMeta(resource);
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize)) || 20));
  for (const [name, value] of Object.entries(query.filter ?? {})) {
    if (!meta.fields.some((field) => field.name === name && field.filter))
      throw invalid(`Không lọc được theo "${name}".`, [
        { name, message: 'Không lọc theo trường này.' },
      ]);
    rows = rows.filter((row) => String(row[name]) === value);
  }
  if (query.q) {
    const q = query.q.toLocaleLowerCase();
    const names = meta.fields.filter((field) => field.search).map((field) => field.name);
    rows = rows.filter((row) =>
      names.some((n) =>
        String(row[n] ?? '')
          .toLocaleLowerCase()
          .includes(q),
      ),
    );
  }
  if (query.sort) {
    const [name, dir] = query.sort.split(':');
    if (!meta.fields.some((field) => field.name === name && field.sortable))
      throw invalid(`Không sắp xếp được theo "${name}".`);
    const sign = dir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a[name] as string | number;
      const y = b[name] as string | number;
      return x === y ? 0 : (x ?? '') > (y ?? '') ? sign : -sign;
    });
  }
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const PREVIEW_TTL = 10 * 60_000;

@Controller('admin-api')
@UseGuards(AdminTokenGuard)
export class AdminApiController {
  private notice = { message: '', sentAt: null as string | null };
  constructor(
    @Inject(Store) private readonly store: Store,
    @Inject(GameGateway) private readonly gateway: GameGateway,
  ) {}

  @Get('meta')
  meta() {
    return META;
  }

  @Get('health')
  async health() {
    let db: 'up' | 'down' = 'up';
    try {
      await this.store.pool.query('SELECT 1');
    } catch {
      db = 'down';
    }
    return {
      status: db === 'up' ? 'ok' : 'error',
      version: GAME.version,
      contractVersion: CONTRACT_VERSION,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      db,
    };
  }

  // Các đường cố định phải khai trước `:id` để không bị đọc thành mã bản ghi.
  @Get(':resource/export')
  async export(@Param('resource') resource: string, @Query('format') format = 'csv') {
    const meta = resourceMeta(resource);
    if (meta.kind === 'singleton') throw notFound('Tài nguyên này không xuất được.');
    if (format !== 'csv' && format !== 'json') throw invalid('format phải là csv hoặc json.');
    const rows = await this.rows(resource);
    const header = resource === 'cards' ? cardFields : meta.fields.map((field) => field.name);
    const content =
      format === 'json'
        ? JSON.stringify(
            rows.map((row) => Object.fromEntries(header.map((h) => [h, row[h]]))),
            null,
            2,
          )
        : stringifyCsv(header, rows);
    return { format, filename: `chamly-${resource}.${format}`, count: rows.length, content };
  }

  @Post(':resource/import')
  @HttpCode(200)
  async import(
    @Param('resource') resource: string,
    @Query('dryRun') dryRunQ: string | undefined,
    @Body() body: { format?: string; content?: unknown; previewToken?: string },
  ) {
    if (resource !== 'cards') throw notFound('Tài nguyên này không hỗ trợ nhập.');
    const dryRun = dryRunQ !== 'false';
    const content = typeof body?.content === 'string' ? body.content : '';
    if (body?.format !== 'csv' && body?.format !== 'json')
      throw invalid('format phải là csv hoặc json.');
    if (!content) throw invalid('Chưa có nội dung để nhập.');
    if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw bad(413, 'too_large', 'File quá 5MB.');
    const { rows, ignoredColumns } = this.readImport(body.format, content);
    if (rows.length > MAX_IMPORT_ROWS) throw bad(413, 'too_large', 'Quá 5000 dòng.');
    if (!dryRun) this.verifyPreview(content, body.previewToken);

    const decks = await this.allDecks();
    const report = {
      dryRun,
      willCreate: 0,
      willUpdate: 0,
      unchanged: 0,
      rejected: [] as { row: number; field: string; message: string }[],
      ignoredColumns,
    };
    const seen = new Set<string>();
    rows.forEach((values, index) => {
      const row = index + 2; // dòng 1 là tiêu đề
      const packId = asText(values.packId);
      const existing =
        packId && decks[packId] ? decks[packId].find((c) => c.id === asText(values.id)) : undefined;
      const { card, errors } = buildCard(values, existing);
      if (!card) {
        for (const e of errors) report.rejected.push({ row, field: e.name, message: e.message });
        return;
      }
      const key = cardKey(packId!, card.id);
      if (seen.has(key)) {
        report.rejected.push({ row, field: 'id', message: 'Mã lá bị lặp trong file.' });
        return;
      }
      seen.add(key);
      const cards = decks[packId!];
      const at = cards.findIndex((c) => c.id === card.id);
      if (at < 0) {
        cards.push(card);
        report.willCreate++;
      } else if (sameCard(cards[at], card)) report.unchanged++;
      else {
        cards[at] = card;
        report.willUpdate++;
      }
    });
    for (const [packId, cards] of Object.entries(decks))
      if (cards.length > 200)
        throw invalid(`Game ${packId} sẽ có ${cards.length} lá, vượt giới hạn 200 lá.`);
    if (dryRun) return { ...report, previewToken: this.signPreview(content) };
    await this.store.replaceSystemDecks(decks);
    return report;
  }

  @Post(':resource/:id/actions/:name')
  @HttpCode(200)
  async action(
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Param('name') name: string,
  ) {
    if (resource !== 'rooms' || name !== 'end') throw notFound('Không có thao tác này.');
    await this.guard(() => this.gateway.adminEndGame(id));
    return this.one(resource, id);
  }

  @Get(':resource')
  async list(@Param('resource') resource: string, @Query() query: ListQuery) {
    const meta = resourceMeta(resource);
    if (resource === 'overview') return { id: 'overview', ...(await this.gateway.adminOverview()) };
    if (resource === 'notice') return { id: 'notice', ...this.notice };
    if (meta.kind === 'singleton') throw notFound();
    return paginate(resource, await this.rows(resource), query);
  }

  @Put(':resource')
  async updateSingleton(@Param('resource') resource: string, @Body() body: Rec) {
    if (resource !== 'notice')
      throw bad(405, 'method_not_allowed', 'Không sửa được tài nguyên này.');
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 300)
      throw invalid('Thông báo cần từ 1 đến 300 ký tự.', [
        { name: 'message', message: 'Cần từ 1 đến 300 ký tự.' },
      ]);
    this.gateway.adminNotice(message);
    this.notice = { message, sentAt: iso(Date.now()) };
    return { id: 'notice', ...this.notice };
  }

  @Get(':resource/:id')
  async one(@Param('resource') resource: string, @Param('id') id: string) {
    resourceMeta(resource);
    const row = (await this.rows(resource)).find((r) => String(r[this.pk(resource)]) === id);
    if (!row) throw notFound();
    return row;
  }

  @Post(':resource')
  async create(@Param('resource') resource: string, @Body() body: Rec) {
    if (resource !== 'cards')
      throw bad(405, 'method_not_allowed', 'Không thêm được ở tài nguyên này.');
    const { packId, card, errors } = buildCard(body ?? {});
    if (!card) throw invalid('Lá bài chưa hợp lệ.', errors);
    await this.guard(() =>
      this.store.editSystemDeck(packId!, (cards) => {
        if (cards.some((c) => c.id === card.id))
          throw bad(409, 'conflict', 'Mã lá đã có trong game này.');
        return [...cards, card];
      }),
    );
    return cardRecord(packId!, card);
  }

  @Put(':resource/:id')
  async update(@Param('resource') resource: string, @Param('id') id: string, @Body() body: Rec) {
    body = body ?? {};
    if (resource === 'cards') {
      const { packId, id: cardId } = splitCardKey(id);
      for (const [name, value] of [
        ['packId', packId],
        ['id', cardId],
      ])
        if (name in body && body[name] !== value)
          throw invalid('Không đổi được game hoặc mã lá. Hãy tạo lá mới.', [
            { name, message: 'Không đổi được sau khi tạo.' },
          ]);
      let saved: Card | undefined;
      await this.guard(() =>
        this.store.editSystemDeck(packId, (cards) => {
          const at = cards.findIndex((c) => c.id === cardId);
          if (at < 0) throw notFound('Không có lá bài này.');
          const { card, errors } = buildCard({ ...body, packId, id: cardId }, cards[at]);
          if (!card) throw invalid('Lá bài chưa hợp lệ.', errors);
          saved = card;
          return cards.map((c, i) => (i === at ? card : c));
        }),
      );
      return cardRecord(packId, saved!);
    }
    if (resource === 'rooms') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 60)
        throw invalid('Tên phòng cần từ 1 đến 60 ký tự.', [
          { name: 'name', message: 'Cần từ 1 đến 60 ký tự.' },
        ]);
      await this.guard(() => this.gateway.adminRenameRoom(id, name));
      return this.one(resource, id);
    }
    if (resource === 'users') {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (!displayName || displayName.length > 30)
        throw invalid('Tên hiển thị cần từ 1 đến 30 ký tự.', [
          { name: 'displayName', message: 'Cần từ 1 đến 30 ký tự.' },
        ]);
      if (!(await this.store.adminRenameUser(id, displayName))) throw notFound();
      return this.one(resource, id);
    }
    resourceMeta(resource);
    throw bad(405, 'method_not_allowed', 'Không sửa được tài nguyên này.');
  }

  @Delete(':resource/:id')
  async remove(@Param('resource') resource: string, @Param('id') id: string) {
    if (resource === 'cards') {
      const { packId, id: cardId } = splitCardKey(id);
      await this.guard(() =>
        this.store.editSystemDeck(packId, (cards) => {
          if (!cards.some((c) => c.id === cardId)) throw notFound('Không có lá bài này.');
          return cards.filter((c) => c.id !== cardId);
        }),
      );
    } else if (resource === 'rooms') {
      await this.one(resource, id);
      await this.gateway.adminDeleteRoom(id);
    } else if (resource === 'room-players') {
      const [roomId, ...rest] = id.split('-');
      await this.one(resource, id);
      await this.guard(() => this.gateway.adminKick(roomId, rest.join('-')));
    } else if (resource === 'users') {
      if (!(await this.store.adminDeleteUser(id))) throw notFound();
    } else {
      resourceMeta(resource);
      throw bad(405, 'method_not_allowed', 'Không xóa được tài nguyên này.');
    }
    return { ok: true };
  }

  private pk(resource: string) {
    return resourceMeta(resource).primaryKey;
  }

  private async rows(resource: string): Promise<Rec[]> {
    if (resource === 'cards') {
      const decks = await this.allDecks();
      return packIds.flatMap((packId) => decks[packId].map((card) => cardRecord(packId, card)));
    }
    if (resource === 'rooms')
      return (await this.gateway.adminRooms()).map((room) => ({
        id: room.id,
        name: room.name,
        packId: room.packId,
        phase: room.phase,
        players: room.players.filter((p) => p.active).length,
        online: room.players.filter((p) => p.online).length,
        round: room.round,
        remaining: room.remainingCount,
        deckSize: room.deckSize,
        expiresAt: iso(room.expiresAt),
      }));
    if (resource === 'room-players')
      return (await this.gateway.adminRooms()).flatMap((room) =>
        room.players
          .filter((p) => p.active)
          .map((p) => ({
            id: `${room.id}-${p.id}`,
            roomId: room.id,
            roomName: room.name,
            name: p.name,
            host: p.id === room.hostId,
            online: p.online,
            drinksTaken: p.drinksTaken,
            cardsDrawn: p.cardsDrawnCount,
          })),
      );
    if (resource === 'users') {
      const [rows] = await this.store.pool.query<RowDataPacket[]>(
        `SELECT users.id, users.username, users.display_name, users.created_at,
           (SELECT COUNT(*) FROM user_decks WHERE user_decks.user_id = users.id) AS deck_count
         FROM users ORDER BY users.created_at DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        deckCount: Number(r.deck_count),
        createdAt: iso(Number(r.created_at)),
      }));
    }
    throw notFound();
  }

  private async allDecks(): Promise<Record<string, Card[]>> {
    const decks: Record<string, Card[]> = {};
    for (const packId of packIds) decks[packId] = (await this.store.systemDeck(packId)).cards;
    return decks;
  }

  private readImport(format: 'csv' | 'json', content: string) {
    let rows: Rec[];
    if (format === 'json') {
      try {
        rows = JSON.parse(content);
      } catch {
        throw invalid('JSON không hợp lệ.');
      }
      if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object'))
        throw invalid('JSON phải là một mảng các đối tượng.');
    } else {
      const [header = [], ...data] = parseCsv(content);
      rows = data.map((cells) =>
        Object.fromEntries(header.map((h, i) => [h.trim(), cells[i] ?? ''])),
      );
    }
    const columns = new Set(rows.flatMap((r) => Object.keys(r)));
    if (!columns.has('packId')) throw invalid('Thiếu cột packId.');
    const ignoredColumns = [...columns].filter((c) => !cardFields.includes(c));
    return {
      rows: rows.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => cardFields.includes(k))),
      ),
      ignoredColumns,
    };
  }

  // Ghi thật phải kèm token của lần chạy thử trên đúng nội dung đó, trong 10 phút.
  private signPreview(content: string, expires = Date.now() + PREVIEW_TTL) {
    const digest = createHash('sha256').update(content).digest('hex');
    const mac = createHmac('sha256', adminToken())
      .update(`cards:${digest}:${expires}`)
      .digest('hex');
    return `${expires}.${mac}`;
  }
  private verifyPreview(content: string, token: unknown) {
    const [expires] = typeof token === 'string' ? token.split('.') : [];
    const ok =
      typeof token === 'string' &&
      Number(expires) > Date.now() &&
      token.length === this.signPreview(content, Number(expires)).length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.signPreview(content, Number(expires))));
    if (!ok) throw invalid('Hãy chạy thử lại trước khi nhập (thiếu hoặc hết hạn previewToken).');
  }

  /** Đổi lỗi nghiệp vụ của game sang khuôn lỗi của hợp đồng. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof GameError)) throw error;
      if (error.code === 'ROOM_NOT_FOUND' || error.code === 'NOT_MEMBER')
        throw notFound(error.message);
      if (error.code === 'STALE_REVISION') throw bad(409, 'conflict', error.message);
      throw invalid(error.message);
    }
  }
}

type BodyRequest = IncomingMessage & { url?: string; body?: unknown; _body?: boolean };
/**
 * Đọc JSON cho /admin-api trước body parser chung (body-parser bỏ qua request đã có `_body`):
 * lệnh thường tối đa 100KB, riêng đường nhập CSV/JSON được tới 6MB.
 */
export function adminBody(req: BodyRequest, res: ServerResponse, next: () => void) {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) return next();
  const limit = /\/import(\?|$)/.test(req.url ?? '') ? MAX_IMPORT_BYTES + 1024 * 1024 : 100_000;
  const fail = (status: number, code: string, message: string) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code, message } }));
  };
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) {
      fail(413, 'too_large', 'Dữ liệu gửi lên quá lớn.');
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on('end', () => {
    if (size > limit) return;
    try {
      req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      req._body = true;
      next();
    } catch {
      fail(400, 'bad_request', 'JSON không hợp lệ.');
    }
  });
}
