import { UserRepository } from '../../../src/repositories/user.repository';

jest.mock('../../../src/lib/prisma', () => ({
    prisma: {
        user: {
            create: jest.fn(),
            findUnique: jest.fn(),
        },
    },
}));

import { prisma } from '../../../src/lib/prisma';

describe('UserRepository (unit)', () => {
    let userRepository: UserRepository;

    beforeEach(() => {
        jest.clearAllMocks();
        userRepository = new UserRepository();
    });

    describe('create', () => {
        it('should create a new user', async () => {
            const userData = {
                name: 'Test User',
                email: 'test@example.com',
                password: 'hashedPassword',
                role: { connect: { id: 1 } },
            };

            const mockUser = {
                id: 'user-123',
                ...userData,
            };

            (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

            const result = await userRepository.create(userData);

            expect(result).toEqual(mockUser);
            expect(prisma.user.create).toHaveBeenCalledWith({ data: userData });
        });
    });

    describe('findByEmail', () => {
        it('should find user by email with role', async () => {
            const mockUser = {
                id: 'user-123',
                email: 'test@example.com',
                role: { id: 1, name: 'admin' },
            };

            (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

            const result = await userRepository.findByEmail('test@example.com');

            expect(result).toEqual(mockUser);
            expect(prisma.user.findUnique).toHaveBeenCalledWith({
                where: { email: 'test@example.com' },
                include: { role: true },
            });
        });
    });

    describe('findByPhone', () => {
        it('should find user by phone with role', async () => {
            const mockUser = {
                id: 'user-123',
                phone: '9876543210',
                role: { id: 2, name: 'sales' },
            };

            (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

            const result = await userRepository.findByPhone('9876543210');

            expect(result).toEqual(mockUser);
            expect(prisma.user.findUnique).toHaveBeenCalledWith({
                where: { phone: '9876543210' },
                include: { role: true },
            });
        });
    });

    describe('findById', () => {
        it('should find user by id with role', async () => {
            const mockUser = {
                id: 'user-123',
                email: 'test@example.com',
                role: { id: 1, name: 'admin' },
            };

            (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

            const result = await userRepository.findById('user-123');

            expect(result).toEqual(mockUser);
            expect(prisma.user.findUnique).toHaveBeenCalledWith({
                where: { id: 'user-123' },
                include: { role: true },
            });
        });
    });
});

