import { z } from 'zod';
import { matchResultSchema, type MatchResult } from '../../../../packages/protocol/src/match-result.js';
import { AppError } from '../errors.js';

export const packagePublicResultContractSchema = z.literal('winners-scores-v1');
export type PackagePublicResultContract = z.infer<typeof packagePublicResultContractSchema>;

const seatIdSchema = z.string().min(1).max(128);
const resultSchema = z
  .object({
    winners: z.array(seatIdSchema).min(1).max(20),
    scores: z.record(seatIdSchema, z.number().finite()).optional(),
  })
  .strict()
  .nullable();

export function invalidPackagePublicResult() {
  return new AppError('VALIDATION_ERROR', '游戏包公开结果无效', 422);
}

export function packagePublicResult(value: unknown, seats: string[]): MatchResult | null {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw invalidPackagePublicResult();
  if (parsed.data === null) return null;
  const { winners, scores } = parsed.data;
  if (
    seats.length < 1 ||
    seats.length > 20 ||
    new Set(seats).size !== seats.length ||
    new Set(winners).size !== winners.length ||
    winners.some((id) => !seats.includes(id)) ||
    (scores &&
      (Object.keys(scores).length !== seats.length ||
        seats.some((id) => !Object.hasOwn(scores, id))))
  )
    throw invalidPackagePublicResult();
  const result = matchResultSchema.safeParse({
    players: seats.map((seatId) => ({
      seatId,
      winner: winners.includes(seatId),
      ...(scores ? { score: scores[seatId] } : {}),
    })),
  });
  if (!result.success) throw invalidPackagePublicResult();
  return result.data;
}
