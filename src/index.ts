import dotenv from 'dotenv';
dotenv.config();

import { prisma } from './lib/prisma';
import { startServer } from './server';

// Log once for verification (remove in production if needed)
try {
  const raw = String(process.env.DATABASE_URL || '');
  const masked = raw
    // mask user:pass@ in postgres URLs
    .replace(/:\/\/([^:@\s]+):([^@\s]+)@/g, '://$1:***@')
    // mask query string (often contains sslmode/connection_limit)
    .replace(/\?.*$/, '');
  console.log('Loaded DATABASE_URL =', masked || '(empty)');
} catch {
  console.log('Loaded DATABASE_URL');
}

// Start server
startServer();

// Graceful shutdown (VERY IMPORTANT for Neon + Prisma)
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  try {
    await prisma.$disconnect();
    console.log('Prisma disconnected');
  } catch (err) {
    console.error('Error during Prisma disconnect:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Catch unexpected crashes
process.on('uncaughtException', async (err) => {
  console.error('Uncaught Exception:', err);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled Rejection:', reason);
  await prisma.$disconnect();
  process.exit(1);
});
