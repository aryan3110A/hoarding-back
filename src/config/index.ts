import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    PORT: z.string().default('3000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    REDIS_ENABLED: z.string().default('true'),
    JWT_SECRET: z.string(),
    JWT_ACCESS_EXPIRATION: z.string().default('15m'),
    JWT_REFRESH_EXPIRATION_DAYS: z.string().default('7').transform(Number),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
    OPENAI_API_KEY: z.string().optional(),
    CHATBOT_NLU_MODEL: z.string().default('gpt-4o-mini'),
    CHATBOT_SESSION_TTL_MINUTES: z.string().default('120').transform(Number),
});

const env = envSchema.parse(process.env);

export const config = {
    port: parseInt(env.PORT, 10),
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    redisEnabled: env.REDIS_ENABLED === 'true',
    allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    jwt: {
        secret: env.JWT_SECRET,
        accessExpiration: env.JWT_ACCESS_EXPIRATION,
        refreshExpirationDays: env.JWT_REFRESH_EXPIRATION_DAYS,
    },
    session: {
        inactivityTimeoutMinutes: {
            default: 45,
            admin: 60,
            sales: 45,
            accounts: 60,
            ops: 60,
        },
    },
    chatbot: {
        openaiApiKey: env.OPENAI_API_KEY || '',
        nluModel: env.CHATBOT_NLU_MODEL,
        sessionTtlMinutes: env.CHATBOT_SESSION_TTL_MINUTES,
    },
};
