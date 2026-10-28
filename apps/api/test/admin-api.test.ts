// Kiểm hợp đồng /admin-api (dashboard chung admin.baodom.xyz) trên app Nest thật, store và
// gateway giả nên không cần MySQL.
import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Card } from '@chamly/shared';
import { AdminApiController } from '../src/admin-api';
import { GameError } from '../src/engine';
import { GameGateway } from '../src/gateway';
import { PACK_DECKS } from '../src/packs';
import { Store } from '../src/store';
import { setupHttp } from '../src/main';

const TOKEN = 'x'.repeat(40);
process.env.ADMIN_API_TOKEN = TOKEN;
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, 'content-type': 'application/json' };

let decks: Record<string, Card[]> = {};
const calls: string[] = [];
const store = {
  pool: {
    query: async () => [
      [{ id: 'u1', username: 'an', display_name: 'An', created_at: 0, deck_count: 2 }],
    ],
  },
  systemDeck: async (packId: string) => ({
    packId,
    cards: structuredClone(decks[packId]),
    revision: 1,
  }),
  editSystemDeck: async (packId: string, edit: (cards: Card[]) => Card[]) => {
    const cards = edit(structuredClone(decks[packId]));
    if (cards.length < 2) throw new GameError('VALIDATION', 'Bộ bài cần từ 2 đến 200 lá.');
    decks[packId] = cards;
  },
  replaceSystemDecks: async (next: Record<string, Card[]>) => {
    decks = structuredClone(next);
  },
  adminRenameUser: async (id: string) => id === 'u1',
  adminDeleteUser: async (id: string) => id === 'u1',
};
const room = {
  id: 'ABC123',
  name: 'Phòng vui',
  packId: 'chamly-50',
  phase: 'playing',
  round: 2,
  remainingCount: 10,
  deckSize: 50,
  expiresAt: 0,
  hostId: 'p1',
  players: [
    { id: 'p1', name: 'Chủ', active: true, online: true, drinksTaken: 1, cardsDrawnCount: 2 },
    { id: 'p2', name: 'Khách', active: true, online: false, drinksTaken: 0, cardsDrawnCount: 1 },
  ],
};
const gateway = {
  adminRooms: async () => [room],
  adminOverview: async () => ({
    connections: 3,
    onlinePlayers: 2,
    sessions: 5,
    rooms: 1,
    users: 1,
  }),
  adminDeleteRoom: async (id: string) => void calls.push(`delete:${id}`),
  adminRenameRoom: async (id: string, name: string) => void calls.push(`rename:${id}:${name}`),
  adminKick: async (roomId: string, playerId: string) =>
    void calls.push(`kick:${roomId}:${playerId}`),
  adminEndGame: async (id: string) => void calls.push(`end:${id}`),
  adminNotice: (message: string) => void calls.push(`notice:${message}`),
};

@Module({
  controllers: [AdminApiController],
  providers: [
    { provide: Store, useValue: store },
    { provide: GameGateway, useValue: gateway },
  ],
})
class TestModule {}

let app: INestApplication;
let url = '';
const get = (path: string, headers: Record<string, string> = auth) =>
  fetch(url + path, { headers });
const send = (method: string, path: string, body: unknown) =>
  fetch(url + path, { method, headers: json, body: JSON.stringify(body) });

before(async () => {
  const nest = await NestFactory.create<NestExpressApplication>(TestModule, {
    bodyParser: false,
    logger: false,
  });
  setupHttp(nest);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
after(() => app.close());

const resetDecks = () => {
  decks = structuredClone(PACK_DECKS);
  calls.length = 0;
};

test('từ chối thiếu/sai token và yêu cầu đi qua proxy', async () => {
  assert.equal((await get('/admin-api/meta', {})).status, 401);
  assert.equal((await get('/admin-api/meta', { authorization: 'Bearer nope' })).status, 401);
  assert.equal(
    (await get('/admin-api/meta', { ...auth, 'x-forwarded-for': '1.2.3.4' })).status,
    401,
  );
  assert.equal(
    (await get('/admin-api/meta', { ...auth, 'cf-connecting-ip': '1.2.3.4' })).status,
    401,
  );
  const body = await (await get('/admin-api/meta', {})).json();
  assert.equal(body.error.code, 'unauthorized');
});

test('không trả header CORS cho /admin-api, kể cả origin hợp lệ', async () => {
  process.env.CORS_ORIGINS = 'https://chamly.baodom.xyz';
  const headers = { ...auth, origin: 'https://chamly.baodom.xyz' };
  assert.equal(
    (await get('/admin-api/meta', headers)).headers.get('access-control-allow-origin'),
    null,
  );
  // Đối chứng: đường công khai vẫn trả CORS cho đúng origin đó.
  const pub = await get('/khong-co', headers);
  assert.equal(pub.headers.get('access-control-allow-origin'), 'https://chamly.baodom.xyz');
});

test('meta và health đúng khuôn', async () => {
  const meta = await (await get('/admin-api/meta')).json();
  assert.equal(meta.contractVersion, 1);
  assert.equal(meta.game.key, 'chamly');
  assert.deepEqual(
    meta.resources.map((r: { key: string }) => r.key),
    ['overview', 'notice', 'rooms', 'room-players', 'cards', 'users'],
  );
  const health = await (await get('/admin-api/health')).json();
  assert.equal(health.status, 'ok');
  assert.equal(health.db, 'up');
});

test('phòng: danh sách, đổi tên, kết thúc ván, kick, xóa', async () => {
  resetDecks();
  const list = await (await get('/admin-api/rooms?q=vui&sort=players:desc')).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].online, 1);
  assert.equal((await send('PUT', '/admin-api/rooms/ABC123', { name: '' })).status, 422);
  assert.equal((await send('PUT', '/admin-api/rooms/ABC123', { name: 'Mới' })).status, 200);
  assert.equal((await send('POST', '/admin-api/rooms/ABC123/actions/end', {})).status, 200);
  const players = await (await get('/admin-api/room-players?filter[roomId]=ABC123')).json();
  assert.equal(players.total, 2);
  assert.equal(players.items.find((p: { host: boolean }) => p.host).name, 'Chủ');
  assert.equal(
    (await fetch(`${url}/admin-api/room-players/ABC123-p2`, { method: 'DELETE', headers: auth }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(`${url}/admin-api/rooms/ABC123`, { method: 'DELETE', headers: auth })).status,
    200,
  );
  assert.equal(
    (await fetch(`${url}/admin-api/rooms/ZZZ999`, { method: 'DELETE', headers: auth })).status,
    404,
  );
  assert.deepEqual(calls, ['rename:ABC123:Mới', 'end:ABC123', 'kick:ABC123:p2', 'delete:ABC123']);
});

test('thông báo và tổng quan là singleton', async () => {
  resetDecks();
  assert.equal((await send('PUT', '/admin-api/notice', { message: '' })).status, 422);
  const saved = await (
    await send('PUT', '/admin-api/notice', { message: 'Bảo trì 5 phút' })
  ).json();
  assert.equal(saved.message, 'Bảo trì 5 phút');
  assert.deepEqual(calls, ['notice:Bảo trì 5 phút']);
  assert.equal((await (await get('/admin-api/overview')).json()).connections, 3);
});

test('lá bài: thêm, sửa, xóa và lỗi 422 kèm fields', async () => {
  resetDecks();
  const bad = await send('POST', '/admin-api/cards', {
    packId: 'kien-thuc',
    title: 'X',
    category: 'truth',
  });
  assert.equal(bad.status, 422);
  const names = (await bad.json()).error.fields.map((f: { name: string }) => f.name);
  assert.ok(names.includes('description') && names.includes('category'), names.join());
  const created = await send('POST', '/admin-api/cards', {
    packId: 'kien-thuc',
    id: 'hub-1',
    title: 'Câu hỏi mới',
    category: 'quiz',
    description: 'Thủ đô Việt Nam?',
    penalty: 'Uống 1 ngụm',
    drinksCount: 1,
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).key, 'kien-thuc.hub-1');
  const edited = await (
    await send('PUT', '/admin-api/cards/kien-thuc.hub-1', { title: 'Đã sửa' })
  ).json();
  assert.equal(edited.title, 'Đã sửa');
  assert.equal(edited.description, 'Thủ đô Việt Nam?');
  assert.equal((await send('PUT', '/admin-api/cards/kien-thuc.hub-1', { id: 'khac' })).status, 422);
  const found = await (await get('/admin-api/cards?filter[packId]=kien-thuc&q=Đã sửa')).json();
  assert.equal(found.total, 1);
  assert.equal(
    (await fetch(`${url}/admin-api/cards/kien-thuc.hub-1`, { method: 'DELETE', headers: auth }))
      .status,
    200,
  );
  assert.ok(!decks['kien-thuc'].some((c) => c.id === 'hub-1'));
});

test('xuất CSV rồi nhập lại: chạy thử, bắt buộc previewToken, ghi thật', async () => {
  resetDecks();
  const exported = await (await get('/admin-api/cards/export?format=csv')).json();
  assert.ok(exported.content.startsWith('﻿packId,id,title,category'));
  const first = decks['chamly-50'][0];
  const csv = exported.content
    .replace(first.title, 'Tiêu đề, có "ngoặc"')
    .replace(
      /\r\n$/,
      '\r\nkien-thuc,,Lá mới,quiz,Nội dung,Phạt,2,,,,,\r\nkien-thuc,,Sai nhóm,truth,Nội dung,Phạt,2,,,,,\r\n',
    );
  // CSV gốc không có ngoặc kép trong tiêu đề nên thay trực tiếp phải bọc lại ô cho đúng chuẩn.
  const content = csv.replace('Tiêu đề, có "ngoặc"', '"Tiêu đề, có ""ngoặc"""');
  const dry = await (
    await send('POST', '/admin-api/cards/import?dryRun=true', { format: 'csv', content })
  ).json();
  assert.equal(dry.willCreate, 1);
  assert.equal(dry.willUpdate, 1);
  assert.equal(dry.rejected.length, 1);
  assert.equal(dry.rejected[0].field, 'category');
  assert.ok(dry.previewToken);
  assert.equal(decks['chamly-50'][0].title, first.title, 'chạy thử không được ghi');
  const noToken = await send('POST', '/admin-api/cards/import?dryRun=false', {
    format: 'csv',
    content,
  });
  assert.equal(noToken.status, 422);
  const real = await send('POST', '/admin-api/cards/import?dryRun=false', {
    format: 'csv',
    content,
    previewToken: dry.previewToken,
  });
  assert.equal(real.status, 200);
  assert.equal(decks['chamly-50'][0].title, 'Tiêu đề, có "ngoặc"');
  assert.ok(decks['kien-thuc'].some((c) => c.title === 'Lá mới'));
});

test('tài khoản: đổi tên, xóa, 404 khi không có', async () => {
  const list = await (await get('/admin-api/users')).json();
  assert.equal(list.items[0].deckCount, 2);
  assert.equal('password_hash' in list.items[0], false);
  assert.equal((await send('PUT', '/admin-api/users/u1', { displayName: 'Bình' })).status, 200);
  assert.equal((await send('PUT', '/admin-api/users/u1', { displayName: '' })).status, 422);
  assert.equal(
    (await fetch(`${url}/admin-api/users/nope`, { method: 'DELETE', headers: auth })).status,
    404,
  );
  assert.equal((await get('/admin-api/khong-co')).status, 404);
  assert.equal((await get('/admin-api/users?sort=password_hash:asc')).status, 422);
});

test('thân request quá lớn bị từ chối 413 ngoài đường nhập', async () => {
  const res = await send('PUT', '/admin-api/notice', { message: 'x'.repeat(200_000) });
  assert.equal(res.status, 413);
});
