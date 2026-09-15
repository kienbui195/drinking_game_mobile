import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialState, newPlayer } from '../src/engine';
import { DEFAULT_CARDS } from '../src/default-cards';
import { commandSchema } from '../src/validation';

function game(count = 2, cards = 6) {
  const state = initialState(newPlayer('host', 'Host'), DEFAULT_CARDS.slice(0, cards));
  for (let i = 1; i < count; i++) state.players.push(newPlayer(`p${i}`, `Player ${i}`));
  return state;
}
test('default seed contains 50 unique, valid cards', () => {
  assert.equal(DEFAULT_CARDS.length, 50);
  assert.equal(new Set(DEFAULT_CARDS.map((c) => c.id)).size, 50);
  assert.equal(
    commandSchema.safeParse({
      roomId: 'ABC123',
      requestId: '10000000-0000-4000-8000-000000000000',
      revision: 0,
      action: { type: 'saveDeck', cards: DEFAULT_CARDS },
    }).success,
    true,
  );
});
test('only host can start; requires two players and enough cards', () => {
  assert.throws(() => applyAction(game(1), 'host', { type: 'start' }), /ít nhất 2/);
  assert.throws(() => applyAction(game(), 'p1', { type: 'start' }), /chủ phòng/);
  assert.throws(() => applyAction(game(3, 2), 'host', { type: 'start' }), /một lá/);
});
test('turn ownership, reveal and completion advance exactly one player', () => {
  const s = game();
  applyAction(s, 'host', { type: 'start' });
  assert.throws(() => applyAction(s, 'p1', { type: 'pick', slot: 0 }), /Chưa đến lượt/);
  assert.throws(
    () => applyAction(s, 'host', { type: 'complete', drinks: 1, completed: true }),
    /Chưa có lá/,
  );
  applyAction(s, 'host', { type: 'pick', slot: 0 });
  assert.throws(() => applyAction(s, 'host', { type: 'pick', slot: 1 }), /hoàn thành/);
  applyAction(s, 'host', { type: 'complete', drinks: 2, completed: true });
  assert.equal(s.turn, 1);
  assert.equal(s.players[0].drinksTaken, 2);
  assert.equal(s.history.length, 1);
  assert.equal(s.revealed, null);
  assert.throws(() => applyAction(s, 'p1', { type: 'pick', slot: 0 }), /khả dụng/);
});
test('depletion, reshuffle and restart preserve/reset the appropriate statistics', () => {
  const s = game(2, 2);
  applyAction(s, 'host', { type: 'start' });
  for (const [i, id] of ['host', 'p1'].entries()) {
    applyAction(s, id, { type: 'pick', slot: i });
    applyAction(s, id, { type: 'complete', drinks: 1, completed: false });
  }
  assert.equal(s.phase, 'depleted');
  applyAction(s, 'host', { type: 'reshuffle' });
  assert.equal(s.round, 2);
  assert.equal(s.history.length, 2);
  applyAction(s, 'host', { type: 'end' });
  applyAction(s, 'host', { type: 'restart' });
  assert.equal(s.phase, 'lobby');
  assert.equal(s.history.length, 0);
  assert.equal(s.players[0].drinksTaken, 0);
});
test('room deck editing does not mutate the default seed or another room', () => {
  const a = game();
  const b = game();
  applyAction(a, 'host', {
    type: 'saveDeck',
    cards: a.deck.map((c) => ({ ...c, title: 'Edited' })),
  });
  assert.notEqual(b.deck[0].title, 'Edited');
  assert.notEqual(DEFAULT_CARDS[0].title, 'Edited');
  applyAction(a, 'host', { type: 'start' });
  assert.throws(() => applyAction(a, 'host', { type: 'saveDeck', cards: b.deck }), /phòng chờ/);
});
test('host leaving transfers ownership; departed players are skipped', () => {
  const s = game(3);
  applyAction(s, 'host', { type: 'start' });
  applyAction(s, 'host', { type: 'leave' });
  assert.equal(s.hostId, 'p1');
  assert.equal(s.turn, 1);
  assert.throws(() => applyAction(s, 'host', { type: 'end' }), /không còn/);
  applyAction(s, 'p1', { type: 'skip' });
  assert.equal(s.turn, 2);
  applyAction(s, 'p1', { type: 'skip' });
  assert.equal(s.turn, 1);
  assert.equal(s.round, 2);
  applyAction(s, 'p2', { type: 'leave' });
  assert.equal(s.phase, 'ended');
});
test('timer uses one server deadline and cannot be restarted by repeat actions', () => {
  const s = game(2, 2);
  applyAction(s, 'host', { type: 'start' });
  applyAction(s, 'host', { type: 'pick', slot: 0 });
  applyAction(s, 'host', { type: 'timer' }, 1000);
  assert.equal(s.timerEndsAt, 1000 + s.slots[0].card.timerSeconds! * 1000);
  assert.throws(() => applyAction(s, 'host', { type: 'timer' }), /đã bắt đầu/);
});
