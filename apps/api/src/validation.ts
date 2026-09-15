import { z } from 'zod';
import { categories, packs } from '@chamly/shared';
const text = (max: number) => z.string().trim().min(1).max(max);
export const cardSchema = z
  .object({
    id: text(80),
    title: text(100),
    description: text(1500),
    penalty: text(500),
    category: z.enum(categories),
    drinksCount: z.number().int().min(0).max(20),
    hasTimer: z.boolean().optional(),
    timerSeconds: z.number().int().min(1).max(600).optional(),
    highlight: z.string().max(300).optional(),
    answer: z.string().max(500).optional(),
    keepable: z.boolean().optional(),
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
    z.object({ type: z.literal('usePouch'), cardId: z.string().max(80) }),
    ...(['timer', 'stash', 'skip', 'reshuffle', 'end', 'restart', 'leave'] as const).map((type) =>
      z.object({ type: z.literal(type) }),
    ),
  ]),
});
export const createSchema = z.object({
  name: text(60),
  password: z.string().min(4).max(128),
  requestId: z.string().uuid(),
  packId: z.enum(packs.map((p) => p.id) as [string, ...string[]]).optional(),
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
