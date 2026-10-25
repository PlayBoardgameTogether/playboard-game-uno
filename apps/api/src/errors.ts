import type { ErrorCode } from './error-codes.js';

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly status: number, readonly retryable = false) { super(message); }
}
