export const categories = [
  'challenge',
  'truth',
  'drink',
  'power',
  'minigame',
  'rule',
  'lucky',
] as const;
export type Category = (typeof categories)[number];
export const categoryLabels: Record<Category, string> = {
  challenge: 'Thử thách',
  truth: 'Sự thật',
  drink: 'Uống thôi',
  power: 'Quyền lực',
  minigame: 'Mini game',
  rule: 'Luật ngầm',
  lucky: 'May mắn',
};
export interface Card {
  id: string;
  title: string;
  category: Category;
  description: string;
  penalty: string;
  drinksCount: number;
  hasTimer?: boolean;
  timerSeconds?: number;
  highlight?: string;
}
export interface Player {
  id: string;
  name: string;
  active: boolean;
  drinksTaken: number;
  cardsDrawnCount: number;
  challengesCompleted: number;
}
export interface Slot {
  card: Card;
  pickedBy: string | null;
}
export interface HistoryEntry {
  playerId: string;
  playerName: string;
  card: Card | null;
  round: number;
  at: number;
  drinks: number;
  completed: boolean;
  skipped?: boolean;
}
export interface GameState {
  phase: 'lobby' | 'playing' | 'depleted' | 'ended';
  players: Player[];
  deck: Card[];
  remaining: Card[];
  slots: Slot[];
  round: number;
  turn: number;
  revealed: number | null;
  timerEndsAt: number | null;
  history: HistoryEntry[];
  hostId: string;
}
export interface RoomSummary {
  id: string;
  name: string;
  playerCount: number;
  phase: GameState['phase'];
}
export interface RoomView extends RoomSummary {
  revision: number;
  expiresAt: number;
  serverTime: number;
  hostId: string;
  players: (Player & { online: boolean })[];
  deck: Card[];
  remainingCount: number;
  slots: { pickedBy: string | null; card: Card | null }[];
  round: number;
  currentPlayerId: string | null;
  revealed: Card | null;
  timerEndsAt: number | null;
  history: HistoryEntry[];
}
export type Action =
  | { type: 'saveDeck'; cards: Card[] }
  | { type: 'start' }
  | { type: 'pick'; slot: number }
  | { type: 'complete'; drinks: number; completed: boolean }
  | { type: 'timer' }
  | { type: 'skip' }
  | { type: 'reshuffle' }
  | { type: 'end' }
  | { type: 'restart' }
  | { type: 'leave' };
export interface Command {
  roomId: string;
  requestId: string;
  revision: number;
  action: Action;
}
export interface Session {
  token: string;
  playerId: string;
  name: string;
  roomId?: string;
}
export type Reply<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
