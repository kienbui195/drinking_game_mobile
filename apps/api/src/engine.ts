import { randomInt } from 'node:crypto';
import type { Action, Card, GameState, Player } from '@chamly/shared';

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new GameError(code, message);
}
export function newPlayer(id: string, name: string): Player {
  return { id, name, active: true, drinksTaken: 0, cardsDrawnCount: 0, challengesCompleted: 0 };
}
export function initialState(player: Player, deck: Card[]): GameState {
  return {
    phase: 'lobby',
    hostId: player.id,
    players: [player],
    deck: structuredClone(deck),
    remaining: [],
    slots: [],
    round: 0,
    turn: 0,
    revealed: null,
    timerEndsAt: null,
    history: [],
  };
}
function shuffle(cards: Card[]): Card[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function deal(s: GameState) {
  const count = s.players.filter((p) => p.active).length;
  s.revealed = null;
  s.timerEndsAt = null;
  if (count < 2) {
    s.phase = 'ended';
    return;
  }
  if (s.remaining.length < count) {
    s.phase = 'depleted';
    return;
  }
  s.slots = s.remaining.splice(0, count).map((card) => ({ card, pickedBy: null }));
  s.round++;
  s.turn = s.players.findIndex((p) => p.active);
  s.phase = 'playing';
}
function advance(s: GameState) {
  s.revealed = null;
  s.timerEndsAt = null;
  const next = s.players.findIndex((p, i) => p.active && i > s.turn);
  if (s.players.filter((p) => p.active).length < 2) s.phase = 'ended';
  else if (next < 0) deal(s);
  else s.turn = next;
}
export function applyAction(s: GameState, actorId: string, action: Action, now = Date.now()) {
  const actor = s.players.find((p) => p.id === actorId && p.active);
  ensure(actor, 'NOT_MEMBER', 'Thành viên không còn trong phòng.');
  const host = () => ensure(s.hostId === actorId, 'HOST_ONLY', 'Chỉ chủ phòng được thao tác.');
  const playing = () => ensure(s.phase === 'playing', 'BAD_PHASE', 'Ván chơi chưa ở lượt rút bài.');
  const ownTurn = () =>
    ensure(s.players[s.turn]?.id === actorId, 'NOT_YOUR_TURN', 'Chưa đến lượt của bạn.');
  switch (action.type) {
    case 'saveDeck':
      host();
      ensure(s.phase === 'lobby', 'DECK_LOCKED', 'Chỉ sửa bộ bài khi đang ở phòng chờ.');
      ensure(
        action.cards.length >= 2 && action.cards.length <= 200,
        'BAD_DECK',
        'Bộ bài cần từ 2 đến 200 lá.',
      );
      ensure(
        new Set(action.cards.map((c) => c.id)).size === action.cards.length,
        'BAD_DECK',
        'ID lá bài bị trùng.',
      );
      s.deck = structuredClone(action.cards);
      break;
    case 'start':
      host();
      ensure(s.phase === 'lobby', 'BAD_PHASE', 'Ván chơi đã bắt đầu.');
      ensure(
        s.players.filter((p) => p.active).length >= 2,
        'NEED_PLAYERS',
        'Cần ít nhất 2 người chơi.',
      );
      ensure(
        s.deck.length >= s.players.filter((p) => p.active).length,
        'BAD_DECK',
        'Cần ít nhất một lá cho mỗi người.',
      );
      s.remaining = shuffle(s.deck);
      deal(s);
      break;
    case 'pick': {
      playing();
      ownTurn();
      ensure(s.revealed === null, 'ALREADY_REVEALED', 'Hãy hoàn thành lá đang mở.');
      const slot = s.slots[action.slot];
      ensure(slot && !slot.pickedBy, 'BAD_SLOT', 'Lá bài không còn khả dụng.');
      slot.pickedBy = actorId;
      s.revealed = action.slot;
      break;
    }
    case 'timer': {
      playing();
      ownTurn();
      ensure(s.revealed !== null, 'NO_CARD', 'Chưa có lá được mở.');
      const card = s.slots[s.revealed].card;
      ensure(card.hasTimer && card.timerSeconds, 'NO_TIMER', 'Lá này không có đồng hồ.');
      ensure(s.timerEndsAt === null, 'TIMER_STARTED', 'Đồng hồ đã bắt đầu.');
      s.timerEndsAt = now + card.timerSeconds * 1000;
      break;
    }
    case 'complete': {
      playing();
      ownTurn();
      ensure(s.revealed !== null, 'NO_CARD', 'Chưa có lá được mở.');
      ensure(
        Number.isInteger(action.drinks) && action.drinks >= 0 && action.drinks <= 20,
        'BAD_DRINKS',
        'Số ngụm cần từ 0 đến 20.',
      );
      const card = s.slots[s.revealed].card;
      actor.drinksTaken += action.drinks;
      actor.cardsDrawnCount++;
      actor.challengesCompleted += Number(action.completed);
      s.history.push({
        playerId: actor.id,
        playerName: actor.name,
        card,
        round: s.round,
        at: now,
        drinks: action.drinks,
        completed: action.completed,
      });
      advance(s);
      break;
    }
    case 'skip': {
      host();
      playing();
      const player = s.players[s.turn];
      s.history.push({
        playerId: player.id,
        playerName: player.name,
        card: s.revealed === null ? null : s.slots[s.revealed].card,
        round: s.round,
        at: now,
        drinks: 0,
        completed: false,
        skipped: true,
      });
      advance(s);
      break;
    }
    case 'reshuffle':
      host();
      ensure(s.phase === 'depleted', 'BAD_PHASE', 'Chỉ xáo lại khi không đủ bài cho vòng mới.');
      ensure(
        s.deck.length >= s.players.filter((p) => p.active).length,
        'BAD_DECK',
        'Không đủ bài.',
      );
      s.remaining = shuffle(s.deck);
      deal(s);
      break;
    case 'end':
      host();
      s.phase = 'ended';
      s.revealed = null;
      s.timerEndsAt = null;
      break;
    case 'restart':
      host();
      ensure(s.phase === 'ended', 'BAD_PHASE', 'Hãy kết thúc ván hiện tại trước.');
      s.players = s.players.filter((p) => p.active).map((p) => newPlayer(p.id, p.name));
      s.phase = 'lobby';
      s.remaining = [];
      s.slots = [];
      s.history = [];
      s.round = 0;
      s.turn = 0;
      s.revealed = null;
      s.timerEndsAt = null;
      break;
    case 'leave': {
      actor.active = false;
      const remaining = s.players.filter((p) => p.active);
      if (s.hostId === actorId) s.hostId = remaining[0]?.id ?? '';
      if (!remaining.length) s.phase = 'ended';
      else if (s.phase === 'playing' && (s.players[s.turn].id === actorId || remaining.length < 2))
        advance(s);
      if (s.phase === 'lobby') s.players = remaining;
      break;
    }
  }
  // Keep ephemeral sessions bounded even when a room plays many reshuffles.
  s.history = s.history.slice(-500);
}
