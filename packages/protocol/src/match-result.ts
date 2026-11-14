import { z } from 'zod';

// Only explicitly public final results belong here, never a game's State or raw outcome.
export const matchResultSchema = z
  .object({
    players: z
      .array(
        z
          .object({
            seatId: z.string().min(1).max(128),
            winner: z.boolean(),
            score: z.number().finite().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export const personalMatchResultSchema = z
  .object({
    winner: z.boolean(),
    sharedWin: z.boolean(),
    score: z.number().finite().optional(),
  })
  .strict();

export type MatchResult = z.infer<typeof matchResultSchema>;
