export const categories = [
  'challenge',
  'truth',
  'drink',
  'power',
  'minigame',
  'rule',
  'lucky',
  'quiz',
  'guess',
  'deep',
  'light',
  'memory',
  'future',
  'quote',
  'reflect',
  'action',
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
  quiz: 'Kiến thức',
  guess: 'Đoán xem',
  deep: 'Chiều sâu',
  light: 'Nhẹ nhàng',
  memory: 'Kỷ niệm',
  future: 'Tương lai',
  quote: 'Trích dẫn',
  reflect: 'Ngẫm lại',
  action: 'Hành động',
};

/**
 * Một chủ đề chơi. Engine không biết gì về chủ đề: pack chỉ quyết định bộ bài mặc định,
 * nhóm thẻ được dùng và cách gọi tên bộ đếm phạt trên giao diện.
 */
export interface DeckPack {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  /** Đơn vị của bộ đếm phạt: ngụm, điểm, lượt… */
  unitLabel: string;
  /** Nhãn nút xác nhận đã làm được yêu cầu của lá bài. */
  completeLabel: string;
  /** Nhãn nút bỏ qua; số và đơn vị được nối vào sau. */
  skipLabel: string;
  categories: Category[];
}
export const packs: DeckPack[] = [
  {
    id: 'chamly-50',
    name: 'Chạm Ly',
    icon: '🥂',
    tagline: 'Thử thách, sự thật và luật ngầm cho bàn nhậu vui.',
    unitLabel: 'ngụm',
    completeLabel: 'Đã hoàn thành thử thách',
    skipLabel: 'Bỏ qua thử thách',
    categories: ['challenge', 'truth', 'drink', 'power', 'minigame', 'rule', 'lucky'],
  },
  {
    id: 'kien-thuc',
    name: 'Hỏi Đáp Kiến Thức',
    icon: '🧠',
    tagline: 'Câu hỏi có đáp án, cả bàn cùng phân xử đúng sai.',
    unitLabel: 'điểm phạt',
    completeLabel: 'Trả lời đúng',
    skipLabel: 'Chịu thua câu này',
    categories: ['quiz', 'guess', 'memory'],
  },
  {
    id: 'hieu-nhau',
    name: 'Hiểu Nhau Hơn',
    icon: '💞',
    tagline: 'Câu hỏi mở lòng cho các cặp đôi và bạn thân.',
    unitLabel: 'lượt kể',
    completeLabel: 'Đã chia sẻ',
    skipLabel: 'Xin bỏ qua câu này',
    categories: ['deep', 'light', 'memory', 'future'],
  },
  {
    id: 'quote-moi-ngay',
    name: 'Mỗi Ngày Một Quote',
    icon: '☀️',
    tagline: 'Một câu nói, một điều để ngẫm và một việc để làm.',
    unitLabel: 'lượt ngẫm',
    completeLabel: 'Đã ngẫm và chia sẻ',
    skipLabel: 'Để dành câu này',
    categories: ['quote', 'reflect', 'action'],
  },
];
export const defaultPackId = packs[0].id;
export const packById = (id: string | undefined): DeckPack =>
  packs.find((p) => p.id === id) ?? packs[0];
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
  /** Đáp án tham chiếu, dùng cho các bộ bài hỏi đáp. */
  answer?: string;
  /**
   * Lá có thể cất vào túi thần kỳ để dùng ở vòng sau. Cất lá không bị tính phạt và cũng
   * không tính là hoàn thành.
   */
  keepable?: boolean;
}
export interface Player {
  id: string;
  name: string;
  active: boolean;
  drinksTaken: number;
  cardsDrawnCount: number;
  challengesCompleted: number;
  /** Túi thần kỳ: các lá đã cất lại để dùng ở vòng sau. */
  pouch: Card[];
}
export const pouchLimit = 5;
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
  /** Lượt này kết thúc bằng việc cất lá vào túi thần kỳ. */
  stashed?: boolean;
  /** Lá được lấy ra từ túi thần kỳ thay cho việc rút bài mới. */
  fromPouch?: boolean;
  /** Kết quả bình chọn từ những người không ở lượt, nếu lượt dùng bình chọn. */
  votes?: { accepted: number; rejected: number };
}
export interface ChallengeVote {
  penalty: number;
  choices: Record<string, boolean>;
}
export interface GameState {
  phase: 'lobby' | 'playing' | 'depleted' | 'ended';
  packId: string;
  players: Player[];
  deck: Card[];
  remaining: Card[];
  slots: Slot[];
  round: number;
  turn: number;
  revealed: number | null;
  /** Lá đang dùng lấy từ túi thần kỳ; thay chỗ cho lá rút trong vòng hiện tại. */
  pouchCard: Card | null;
  timerEndsAt: number | null;
  /** Optional để những phòng tạo trước khi có tính năng bình chọn vẫn khôi phục được. */
  vote?: ChallengeVote | null;
  history: HistoryEntry[];
  hostId: string;
}
export interface RoomSummary {
  id: string;
  name: string;
  playerCount: number;
  phase: GameState['phase'];
  packId: string;
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
  vote: { votedPlayerIds: string[]; total: number } | null;
  history: HistoryEntry[];
}
export type Action =
  | { type: 'saveDeck'; cards: Card[] }
  | { type: 'requestVote'; drinks: number }
  | { type: 'vote'; accepted: boolean }
  | { type: 'cancelVote' }
  | { type: 'stash' }
  | { type: 'usePouch'; cardId: string }
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
  /** Username only exists for registered accounts; legacy sessions omit it. */
  username?: string;
  /** Phiên quản trị đăng nhập qua form đăng nhập bằng tài khoản admin. */
  isAdmin?: boolean;
  roomId?: string;
}
export interface Profile {
  username: string;
  displayName: string;
  onlineHours: number;
  deckCount: number;
  displayNameChangeAllowedAt: number;
}
export interface OwnedDeck {
  id: string;
  name: string;
  packId: string;
  cards: Card[];
  createdAt: number;
  updatedAt: number;
}
export interface SystemDeck {
  packId: string;
  cards: Card[];
  revision: number;
}
export type Reply<T> =
  { ok: true; data: T } | { ok: false; code: string; message: string; nextAllowedAt?: number };

/** Thông tin một phòng dưới góc nhìn quản trị. */
export interface AdminRoom {
  id: string;
  name: string;
  packId: string;
  phase: GameState['phase'];
  round: number;
  remainingCount: number;
  deckSize: number;
  expiresAt: number;
  hostId: string;
  players: { id: string; name: string; active: boolean; online: boolean; pouch: number }[];
}
export interface AdminOverview {
  serverTime: number;
  /** Số kết nối socket đang mở. */
  connections: number;
  /** Số người chơi khác nhau đang kết nối. */
  onlinePlayers: number;
  /** Số phiên còn hiệu lực trong cơ sở dữ liệu. */
  sessions: number;
  rooms: AdminRoom[];
  /** Số phòng theo từng chủ đề. */
  packUsage: { packId: string; rooms: number; players: number }[];
}
