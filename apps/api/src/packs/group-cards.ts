import type { Card } from '@chamly/shared';

/** Added once to the managed Chạm Ly system deck; admin may subsequently edit or remove them. */
export const GROUP_CARDS: Card[] = [
  {
    id: 'group-1',
    title: 'Cả Bàn Chỉ Ai?',
    category: 'minigame',
    description:
      'Người bốc nhắm mắt. Cả bàn cùng chỉ vào người hay kể chuyện cười nhất. Mở mắt rồi đoán người được chọn; cả bàn cùng tiết lộ đáp án.',
    penalty: 'Đoán sai hoặc không đoán: người bốc nhận 1 ngụm.',
    drinksCount: 1,
  },
  {
    id: 'group-2',
    title: 'Câu Chuyện Nối Đuôi',
    category: 'challenge',
    description:
      'Người bốc mở đầu một câu chuyện. Mỗi người trong bàn thêm đúng một câu, rồi người bốc phải kết lại bằng một cái kết bất ngờ. Cả bàn bình chọn cái kết có đạt không.',
    penalty: 'Nếu cái kết chưa đạt hoặc người bốc bỏ cuộc: người bốc nhận 1 ngụm.',
    drinksCount: 1,
  },
  {
    id: 'group-3',
    title: 'Diễn Không Nói',
    category: 'challenge',
    description:
      'Người bốc chọn một đồ vật trong phòng và diễn tả bằng cử chỉ, không nói và không chỉ vào đồ vật. Cả bàn có 30 giây để đoán đó là gì.',
    penalty: 'Nếu không ai đoán đúng trong 30 giây: người bốc nhận 1 ngụm.',
    drinksCount: 1,
    hasTimer: true,
    timerSeconds: 30,
  },
  {
    id: 'group-4',
    title: 'Đồng Thanh Khác Ý',
    category: 'minigame',
    description:
      'Người bốc nêu một chủ đề bất kỳ rồi đếm 3, 2, 1. Mọi người cùng hô một từ thuộc chủ đề đó. Người bốc phải nhớ và nhắc lại ít nhất hai đáp án của người khác.',
    penalty: 'Không nhớ được hai đáp án khác nhau: người bốc nhận 1 ngụm.',
    drinksCount: 1,
  },
];
