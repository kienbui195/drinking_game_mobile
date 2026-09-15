import { z } from 'zod';
const text = (max: number) => z.string().trim().min(1).max(max);
export const cardSchema = z
  .object({
    id: text(80),
    title: text(100),
    description: text(1500),
    penalty: text(500),
    category: z.enum(['challenge', 'truth', 'drink', 'power', 'minigame', 'rule', 'lucky']),
    drinksCount: z.number().int().min(0).max(20),
    hasTimer: z.boolean().optional(),
    timerSeconds: z.number().int().min(1).max(600).optional(),
    highlight: z.string().max(300).optional(),
  })
  .refine((c) => !c.hasTimer || !!c.timerSeconds, 'Thiếu thời gian đếm ngược.');
export const commandSchema = z.object({
  roomId: z.string().regex(/^[A-F0-9]{6}$/),
  requestId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('saveDeck'), cards: z.array(cardSchema).min(2).max(200) }),
    z.object({ type: z.literal('start') }),
    z.object({ type: z.literal('pick'), slot: z.number().int().min(0).max(11) }),
    z.object({
      type: z.literal('complete'),
      drinks: z.number().int().min(0).max(20),
      completed: z.boolean(),
    }),
    ...(['timer', 'skip', 'reshuffle', 'end', 'restart', 'leave'] as const).map((type) =>
      z.object({ type: z.literal(type) }),
    ),
  ]),
});
export const createSchema = z.object({
  name: text(60),
  password: z.string().min(4).max(128),
  requestId: z.string().uuid(),
});
export const joinSchema = z.object({
  roomId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-F0-9]{6}$/),
  password: z.string().min(4).max(128),
});
export const nameSchema = z.object({ name: text(30) });
