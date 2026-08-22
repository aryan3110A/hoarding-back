import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private isExpired(key: string) {
    const v = this.store.get(key);
    if (!v) return true;
    if (v.expiresAt == null) return false;
    if (Date.now() > v.expiresAt) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async set(...args: unknown[]) {
    const key = String(args[0] ?? '');
    const value = String(args[1] ?? '');
    const mode = typeof args[2] === 'string' ? args[2] : undefined;
    const seconds = typeof args[3] === 'number' ? args[3] : undefined;
    let expiresAt: number | null = null;
    if (mode && String(mode).toUpperCase() === 'EX' && typeof seconds === 'number') {
      expiresAt = Date.now() + seconds * 1000;
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async setex(...args: unknown[]) {
    const key = String(args[0] ?? '');
    const seconds = Number(args[1] ?? 0);
    const value = String(args[2] ?? '');
    return this.set(key, value, 'EX', seconds);
  }

  async exists(...args: unknown[]) {
    const key = String(args[0] ?? '');
    if (this.isExpired(key)) return 0;
    return this.store.has(key) ? 1 : 0;
  }

  async expire(...args: unknown[]) {
    const key = String(args[0] ?? '');
    const seconds = Number(args[1] ?? 0);
    if (this.isExpired(key)) return 0;
    const v = this.store.get(key);
    if (!v) return 0;
    v.expiresAt = Date.now() + seconds * 1000;
    this.store.set(key, v);
    return 1;
  }

  async del(...args: unknown[]) {
    const key = String(args[0] ?? '');
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  async incr(...args: unknown[]) {
    const key = String(args[0] ?? '');
    if (this.isExpired(key)) {
      this.store.delete(key);
    }
    const current = this.store.get(key);
    const num = current ? parseInt(current.value, 10) || 0 : 0;
    const next = num + 1;
    this.store.set(key, { value: String(next), expiresAt: current?.expiresAt ?? null });
    return next;
  }

  async ttl(...args: unknown[]) {
    const key = String(args[0] ?? '');
    if (this.isExpired(key)) return -2;
    const v = this.store.get(key);
    if (!v) return -2;
    if (v.expiresAt == null) return -1;
    return Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000));
  }

  async ping() {
    return 'PONG';
  }
}

class NullRedis {
  async set(): Promise<unknown> {
    throw new Error('Redis is disabled');
  }
  async setex(): Promise<unknown> {
    throw new Error('Redis is disabled');
  }
  async exists(): Promise<number> {
    return 0;
  }
  async expire(): Promise<number> {
    return 0;
  }
  async del(): Promise<number> {
    return 0;
  }
  async incr(): Promise<number> {
    throw new Error('Redis is disabled');
  }
  async ttl(): Promise<number> {
    return -2;
  }
  async ping(): Promise<string> {
    throw new Error('Redis is disabled');
  }
}

type RedisClient = Redis | InMemoryRedis;
let redisClient: RedisClient | null = null;

if (process.env.NODE_ENV === 'test') {
  redisClient = new InMemoryRedis();
}

if (!redisClient && config.redisEnabled && config.redisUrl) {
  try {
    const real = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });

    redisClient = real;

    real.on('connect', () => {
      logger.info('Redis connected');
    });

    real.on('error', (err: unknown) => {
      logger.error('Redis error:', err);
    });
  } catch (err) {
    logger.error('Failed to initialize Redis:', err);
    redisClient = null;
  }
} else {
  logger.info('Redis disabled via environment config');
}

// Export a non-null redis client for callers (tests expect it)
export const redis: RedisClient | NullRedis = redisClient ?? new NullRedis();

// ✅ Safe getter (returns null instead of throwing)
export function getRedis(): RedisClient | null {
  return redisClient;
}
