import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { ApiResponse } from '../lib/apiResponse';
import { logger } from '../lib/logger';
import { config } from '../config';

const stripAnsi = (value: unknown): string => {
  const str = String(value ?? '');
  // Matches ANSI escape sequences, e.g. "\u001b[31m" red, reset codes, etc.
  return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error(err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(ApiResponse.error(stripAnsi(err.message), err.details));
  }

  return res
    .status(500)
    .json(
      ApiResponse.error(
        'Internal Server Error',
        config.nodeEnv === 'development' ? stripAnsi((err as any)?.message ?? err) : undefined,
      ),
    );
};
