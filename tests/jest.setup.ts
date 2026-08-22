import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment variables
config({ path: resolve(__dirname, '../test.env') });

// Set test timeout to 30 seconds for integration tests
jest.setTimeout(30000);

// Ensure NODE_ENV is test
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise in tests (optional)
global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    // Keep error for debugging
};
