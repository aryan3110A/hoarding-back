module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
    testMatch: ['**/*.test.ts', '**/*.spec.ts'],
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/index.ts',
        '!src/types/**',
        '!src/**/*.d.ts',
    ],
    projects: [
        {
            displayName: 'unit',
            preset: 'ts-jest',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/unit/**/*.spec.ts'],
            setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
            transform: {
                '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
            },
        },
        {
            displayName: 'integration',
            preset: 'ts-jest',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
            setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
            transform: {
                '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
            },
        },
    ],
};
