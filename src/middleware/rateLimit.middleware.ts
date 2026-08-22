import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../lib/redis';
import { ApiResponse } from '../lib/apiResponse';
import { config } from '../config';

/**
 * Redis-backed rate limiter
 * - Uses Redis if available
 * - Fail-open if Redis is down
 * - Skips in development
 */
export const rateLimit = (limit: number, windowSeconds: number) => {
    return async (req: Request, res: Response, next: NextFunction) => {

        // ✅ Skip rate limiting in development
        if (config.nodeEnv === 'development') {
            return next();
        }

        const redis = getRedis();
        if (!redis) {
            // ✅ Redis disabled → allow request
            return next();
        }

        try {
            const ip =
                req.ip ||
                req.headers['x-forwarded-for']?.toString() ||
                req.socket.remoteAddress ||
                'unknown';

            const key = `ratelimit:${ip}`;

            const current = await redis.incr(key);

            if (current === 1) {
                await redis.expire(key, windowSeconds);
            }

            if (current > limit) {
                return res
                    .status(429)
                    .json(ApiResponse.error('Too many requests'));
            }

            next();
        } catch (error) {
            // ✅ Fail open — NEVER block traffic if Redis fails
            console.error('Rate limit error:', error);
            next();
        }
    };
};
