import { HoardingRepository } from '../../../src/repositories/hoarding.repository';

jest.mock('../../../src/lib/prisma', () => ({
    prisma: {
        hoarding: {
            create: jest.fn(),
            update: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
        },
        $transaction: jest.fn(),
    },
}));

import { prisma } from '../../../src/lib/prisma';

describe('HoardingRepository (unit)', () => {
    let hoardingRepository: HoardingRepository;

    beforeEach(() => {
        jest.clearAllMocks();
        hoardingRepository = new HoardingRepository();
    });

    describe('create', () => {
        it('should create a new hoarding', async () => {
            const hoardingData = {
                code: 'H-TEST-001',
                title: 'Test Hoarding',
                city: 'Mumbai',
                status: 'available',
            };

            const mockHoarding = {
                id: 'hoarding-123',
                ...hoardingData,
            };

            (prisma.hoarding.create as jest.Mock).mockResolvedValue(mockHoarding);

            const result = await hoardingRepository.create(hoardingData);

            expect(result).toEqual(mockHoarding);
            expect(prisma.hoarding.create).toHaveBeenCalledWith({ data: hoardingData });
        });
    });

    describe('update', () => {
        it('should update hoarding', async () => {
            const updateData = {
                title: 'Updated Title',
                status: 'booked',
            };

            const mockUpdatedHoarding = {
                id: 'hoarding-123',
                code: 'H-TEST-001',
                ...updateData,
            };

            (prisma.hoarding.update as jest.Mock).mockResolvedValue(mockUpdatedHoarding);

            const result = await hoardingRepository.update('hoarding-123', updateData);

            expect(result).toEqual(mockUpdatedHoarding);
            expect(prisma.hoarding.update).toHaveBeenCalledWith({
                where: { id: 'hoarding-123' },
                data: updateData,
            });
        });
    });

    describe('findById', () => {
        it('should find hoarding by id', async () => {
            const mockHoarding = {
                id: 'hoarding-123',
                code: 'H-TEST-001',
                title: 'Test Hoarding',
            };

            (prisma.hoarding.findUnique as jest.Mock).mockResolvedValue(mockHoarding);

            const result = await hoardingRepository.findById('hoarding-123');

            expect(result).toEqual(mockHoarding);
            expect(prisma.hoarding.findUnique).toHaveBeenCalledWith({
                where: { id: 'hoarding-123' },
                include: {
                    category: true,
                    landlord: true,
                },
            });
        });
    });

    describe('findAll', () => {
        it('should find all hoardings with pagination', async () => {
            const mockHoardings = [
                { id: 'hoarding-1', code: 'H-001' },
                { id: 'hoarding-2', code: 'H-002' },
            ];

            (prisma.$transaction as jest.Mock).mockResolvedValue([mockHoardings, 2]);

            const result = await hoardingRepository.findAll({
                skip: 0,
                take: 10,
                where: { city: 'Mumbai' },
            });

            expect(result.hoardings).toEqual(mockHoardings);
            expect(result.total).toBe(2);
            expect(prisma.$transaction).toHaveBeenCalled();
        });
    });
});

