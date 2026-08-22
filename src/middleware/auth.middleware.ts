import { Response, NextFunction } from 'express';
import { config } from '../config';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { UnauthorizedError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { Security } from '../lib/security';
import { getRedis } from '../lib/redis';

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      // Support SSE/EventSource where custom headers aren't available
      const q = req.query?.token;
      if (typeof q === 'string' && q.trim().length > 0) {
        token = q.trim();
      } else if (Array.isArray(q) && typeof q[0] === 'string' && q[0].trim().length > 0) {
        token = q[0].trim();
      }
    }

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    let decoded: { userId: string; role: string; sessionId: string };
    try {
      decoded = Security.verifyAccessToken(token) as {
        userId: string;
        role: string;
        sessionId: string;
      };
    } catch {
      throw new UnauthorizedError('Invalid token');
    }

    // ✅ Optional Redis check (skip if disabled)
    const redis = getRedis();
    if (redis) {
      const redisKey = `session:${decoded.sessionId}`;
      const sessionActive = await redis.exists(redisKey);
      if (!sessionActive) {
        throw new UnauthorizedError('Session expired or revoked');
      }
    }

    const session = await prisma.refreshSession.findUnique({
      where: { id: decoded.sessionId },
    });

    if (
      !session ||
      session.userId !== decoded.userId ||
      session.revoked ||
      new Date() > session.expiresAt
    ) {
      throw new UnauthorizedError('Session expired or revoked');
    }

    const revokedDevice = await prisma.userDevice.findFirst({
      where: {
        userId: decoded.userId,
        deviceId: session.deviceId,
        isRevoked: true,
      },
      select: { id: true },
    });

    if (revokedDevice) {
      throw new UnauthorizedError('Device access revoked');
    }

    // ✅ DB is the source of truth
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        role: true,
        territories: { include: { territory: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('User not found or inactive');
    }

    req.user = user;
    req.session = session;
    req.sessionId = decoded.sessionId;

    // ✅ Update Redis TTL only if enabled
    if (redis) {
      const inactivityTimeout =
        config.session.inactivityTimeoutMinutes[
          user.role.name as keyof typeof config.session.inactivityTimeoutMinutes
        ] ?? config.session.inactivityTimeoutMinutes.default;

      await redis.expire(`session:${decoded.sessionId}`, inactivityTimeout * 60);
    }

    next();
  } catch (error) {
    next(error);
  }
};
