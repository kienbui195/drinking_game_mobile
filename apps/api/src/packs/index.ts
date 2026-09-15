import type { Card } from '@chamly/shared';
import { DEFAULT_CARDS } from '../default-cards';
import { KIEN_THUC_CARDS } from './kien-thuc';
import { HIEU_NHAU_CARDS } from './hieu-nhau';
import { QUOTE_CARDS } from './quote-moi-ngay';

/** Bộ bài mặc định của từng chủ đề, khóa theo id pack khai báo trong @chamly/shared. */
export const PACK_DECKS: Record<string, Card[]> = {
  'chamly-50': DEFAULT_CARDS,
  'kien-thuc': KIEN_THUC_CARDS,
  'hieu-nhau': HIEU_NHAU_CARDS,
  'quote-moi-ngay': QUOTE_CARDS,
};
