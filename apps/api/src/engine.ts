import { randomInt } from 'node:crypto';
import {
  defaultPackId,
  pouchLimit,
  type Action,
  type Card,
  type GameState,
  type Player,
} from '@chamly/shared';

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
    public nextAllowedAt?: number,
  ) {
    super(message);
  }
}
export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new GameError(code, message);
}
export function newPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    active: true,
    drinksTaken: 0,
    cardsDrawnCount: 0,
    challengesCompleted: 0,
    pouch: [],
  };
}
export function initialState(player: Player, deck: Card[], packId = defaultPackId): GameState {
  return {
    phase: 'lobby',
    packId,
    hostId: player.id,
    players: [player],
    deck: structuredClone(deck),
    remaining: [],
    slots: [],
    round: 0,
    turn: 0,
    revealed: null,
    pouchCard: null,
    timerEndsAt: null,
    vote: null,
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
  s.pouchCard = null;
  s.timerEndsAt = null;
  s.vote = null;
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
  s.pouchCard = null;
  s.timerEndsAt = null;
  s.vote = null;
  const next = s.players.findIndex((p, i) => p.active && i > s.turn);
  if (s.players.filter((p) => p.active).length < 2) s.phase = 'ended';
  else if (next < 0) deal(s);
  else s.turn = next;
}
function completeTurn(
  s: GameState,
  actor: Player,
  card: Card,
  completed: boolean,
  penalty: number,
  now: number,
  votes?: { accepted: number; rejected: number },
) {
  const drinks = completed ? 0 : penalty;
  actor.drinksTaken += drinks;
  actor.cardsDrawnCount++;
  actor.challengesCompleted += Number(completed);
  s.history.push({
    playerId: actor.id,
    playerName: actor.name,
    card,
    round: s.round,
    at: now,
    drinks,
    completed,
    ...(s.pouchCard !== null ? { fromPouch: true } : {}),
    ...(votes ? { votes } : {}),
  });
  advance(s);
}
function finishVote(s: GameState, now: number) {
  const vote = s.vote;
  if (!vote || s.phase !== 'playing') return;
  const actor = s.players[s.turn];
  const voters = s.players.filter((p) => p.active && p.id !== actor.id);
  if (!voters.every((p) => p.id in vote.choices)) return;
  const accepted = voters.filter((p) => vote.choices[p.id]).length;
  const rejected = voters.length - accepted;
  const card = s.pouchCard ?? (s.revealed === null ? null : s.slots[s.revealed].card);
  if (card)
    completeTurn(s, actor, card, accepted > rejected, vote.penalty, now, { accepted, rejected });
}
export function applyAction(s: GameState, actorId: string, action: Action, now = Date.now()) {
  const actor = s.players.find((p) => p.id === actorId && p.active);
  ensure(actor, 'NOT_MEMBER', 'Thành viên không còn trong phòng.');
  const host = () => ensure(s.hostId === actorId, 'HOST_ONLY', 'Chỉ chủ phòng được thao tác.');
  const playing = () => ensure(s.phase === 'playing', 'BAD_PHASE', 'Ván chơi chưa ở lượt rút bài.');
  const ownTurn = () =>
    ensure(s.players[s.turn]?.id === actorId, 'NOT_YOUR_TURN', 'Chưa đến lượt của bạn.');
  // Lá đang xử lý có thể là lá vừa lật trong vòng, hoặc lá lấy ra từ túi thần kỳ.
  const openCard = () => s.pouchCard ?? (s.revealed === null ? null : s.slots[s.revealed].card);
  // Trạng thái cũ lưu trong DB chưa có trường này; coi như túi rỗng.
  const pouchOf = (p: Player) => (p.pouch ??= []);
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
      ensure(
        s.revealed === null && s.pouchCard === null,
        'ALREADY_REVEALED',
        'Hãy hoàn thành lá đang mở.',
      );
      const slot = s.slots[action.slot];
      ensure(slot && !slot.pickedBy, 'BAD_SLOT', 'Lá bài không còn khả dụng.');
      slot.pickedBy = actorId;
      s.revealed = action.slot;
      break;
    }
    case 'timer': {
      playing();
      ownTurn();
      const card = openCard();
      ensure(card, 'NO_CARD', 'Chưa có lá được mở.');
      ensure(card.hasTimer && card.timerSeconds, 'NO_TIMER', 'Lá này không có đồng hồ.');
      ensure(s.timerEndsAt === null, 'TIMER_STARTED', 'Đồng hồ đã bắt đầu.');
      s.timerEndsAt = now + card.timerSeconds * 1000;
      break;
    }
    case 'complete': {
      playing();
      ownTurn();
      ensure(!s.vote, 'VOTE_IN_PROGRESS', 'Hãy chờ bình chọn hoặc hủy bình chọn.');
      const card = openCard();
      ensure(card, 'NO_CARD', 'Chưa có lá được mở.');
      ensure(
        Number.isInteger(action.drinks) && action.drinks >= 0 && action.drinks <= 20,
        'BAD_DRINKS',
        'Số ngụm cần từ 0 đến 20.',
      );
      completeTurn(s, actor, card, action.completed, action.drinks, now);
      break;
    }
    case 'requestVote': {
      playing();
      ownTurn();
      const card = openCard();
      ensure(card, 'NO_CARD', 'Chưa có lá được mở.');
      ensure(
        card.category === 'challenge' || card.category === 'minigame',
        'BAD_CARD',
        'Chỉ bình chọn lá thử thách hoặc mini game.',
      );
      ensure(!s.vote, 'VOTE_IN_PROGRESS', 'Đang chờ cả bàn bình chọn.');
      s.vote = { penalty: action.drinks, choices: {} };
      break;
    }
    case 'vote': {
      playing();
      ensure(s.vote && openCard(), 'NO_VOTE', 'Chưa có lượt bình chọn.');
      ensure(s.players[s.turn].id !== actorId, 'SELF_VOTE', 'Người thực hiện không tự bình chọn.');
      ensure(!(actorId in s.vote.choices), 'ALREADY_VOTED', 'Bạn đã bình chọn lượt này.');
      s.vote.choices[actorId] = action.accepted;
      finishVote(s, now);
      break;
    }
    case 'cancelVote':
      playing();
      ownTurn();
      ensure(s.vote, 'NO_VOTE', 'Chưa có lượt bình chọn.');
      s.vote = null;
      break;
    case 'stash': {
      playing();
      ownTurn();
      ensure(!s.vote, 'VOTE_IN_PROGRESS', 'Hãy chờ bình chọn hoặc hủy bình chọn.');
      ensure(s.pouchCard === null, 'BAD_CARD', 'Lá lấy từ túi không cất lại được.');
      const card = openCard();
      ensure(card, 'NO_CARD', 'Chưa có lá được mở.');
      ensure(card.keepable, 'NOT_KEEPABLE', 'Lá này phải xử lý ngay trong lượt.');
      const pouch = pouchOf(actor);
      ensure(pouch.length < pouchLimit, 'POUCH_FULL', `Túi thần kỳ chỉ giữ ${pouchLimit} lá.`);
      pouch.push(card);
      actor.cardsDrawnCount++;
      s.history.push({
        playerId: actor.id,
        playerName: actor.name,
        card,
        round: s.round,
        at: now,
        drinks: 0,
        completed: false,
        stashed: true,
      });
      advance(s);
      break;
    }
    case 'usePouch': {
      playing();
      ownTurn();
      ensure(
        s.revealed === null && s.pouchCard === null,
        'ALREADY_REVEALED',
        'Hãy hoàn thành lá đang mở.',
      );
      const pouch = pouchOf(actor);
      const index = pouch.findIndex((c) => c.id === action.cardId);
      ensure(index >= 0, 'NOT_IN_POUCH', 'Lá này không có trong túi thần kỳ.');
      s.pouchCard = pouch.splice(index, 1)[0];
      break;
    }
    case 'skip': {
      host();
      playing();
      const player = s.players[s.turn];
      s.history.push({
        playerId: player.id,
        playerName: player.name,
        card: openCard(),
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
      s.pouchCard = null;
      s.timerEndsAt = null;
      s.vote = null;
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
      s.pouchCard = null;
      s.timerEndsAt = null;
      s.vote = null;
      break;
    case 'leave': {
      actor.active = false;
      const remaining = s.players.filter((p) => p.active);
      if (s.hostId === actorId) s.hostId = remaining[0]?.id ?? '';
      if (!remaining.length) s.phase = 'ended';
      else if (s.phase === 'playing' && (s.players[s.turn].id === actorId || remaining.length < 2))
        advance(s);
      if (s.phase === 'lobby') s.players = remaining;
      if (s.vote) finishVote(s, now);
      break;
    }
  }
  // Keep ephemeral sessions bounded even when a room plays many reshuffles.
  s.history = s.history.slice(-500);
}
