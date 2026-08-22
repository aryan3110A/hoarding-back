import { HoardingService } from '../../../src/services/hoarding.service';
import { HoardingRepository } from '../../../src/repositories/hoarding.repository';
import { BookingRepository } from '../../../src/repositories/booking.repository';

// Define mocks with shared state inside the factory
jest.mock('../../../src/repositories/hoarding.repository', () => {
    const mockRepo = {
        create: jest.fn(),
        update: jest.fn(),
        findById: jest.fn(),
        findAll: jest.fn(),
    };
    return {
        HoardingRepository: jest.fn(() => mockRepo),
    };
});

jest.mock('../../../src/repositories/booking.repository', () => {
    const mockRepo = {
        create: jest.fn(),
        findByHoardingId: jest.fn(),
    };
    return {
        BookingRepository: jest.fn(() => mockRepo),
    };
});

describe('HoardingService (unit)', () => {
    let hoardingService: HoardingService;
    let mockHoardingRepo: any;
    let mockBookingRepo: any;

    beforeEach(() => {
        jest.clearAllMocks();
        hoardingService = new HoardingService();

        // Get the shared mock instances by instantiating the mocked classes
        mockHoardingRepo = new HoardingRepository() as any;
        mockBookingRepo = new BookingRepository() as any;
    });

    describe('create', () => {
        it('should create a hoarding', async () => {
            const hoardingData = {
                code: 'H-TEST-001',
                title: 'Test Hoarding',
                city: 'Mumbai',
                status: 'available',
            };

            mockHoardingRepo.create.mockResolvedValue({
                id: 'hoarding-123',
                ...hoardingData,
            });

            const result = await hoardingService.create(hoardingData);

            expect(result).toHaveProperty('id');
            expect(mockHoardingRepo.create).toHaveBeenCalledWith(hoardingData);
        });
    });

    describe('update', () => {
        it('should update a hoarding', async () => {
            const updateData = {
                title: 'Updated Title',
                status: 'booked',
            };

            mockHoardingRepo.update.mockResolvedValue({
                id: 'hoarding-123',
                code: 'H-TEST-001',
                ...updateData,
            });

            const result = await hoardingService.update('hoarding-123', updateData);

            expect(result).toHaveProperty('id');
            expect(mockHoardingRepo.update).toHaveBeenCalledWith('hoarding-123', updateData);
        });
    });

    describe('getById', () => {
        it('should get hoarding by id', async () => {
            const mockHoarding = {
                id: 'hoarding-123',
                code: 'H-TEST-001',
            };

            mockHoardingRepo.findById.mockResolvedValue(mockHoarding);

            const result = await hoardingService.getById('hoarding-123');

            expect(result).toEqual(mockHoarding);
            expect(mockHoardingRepo.findById).toHaveBeenCalledWith('hoarding-123');
        });
    });

    describe('getAll', () => {
        it('should return all hoardings for admin users', async () => {
            const adminUser = {
                role: { name: 'admin' },
            };

            const mockHoardings = [
                { id: '1', code: 'H1', city: 'Mumbai' },
                { id: '2', code: 'H2', city: 'Delhi' },
            ];

            mockHoardingRepo.findAll.mockResolvedValue({
                hoardings: mockHoardings,
                total: 2,
            });

            const result = await hoardingService.getAll({ page: '1', limit: '10' }, adminUser);

            expect(result.hoardings).toHaveLength(2);
            expect(mockHoardingRepo.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    skip: 0,
                    take: 10,
                })
            );
        });

        it('should filter hoardings by territory for sales users', async () => {
            const salesUser = {
                role: { name: 'sales' },
                territories: [
                    { territory: { city: 'Mumbai' } },
                    { territory: { city: 'Pune' } },
                ],
            };

            const mockHoardings = [
                { id: '1', code: 'H1', city: 'Mumbai' },
                { id: '2', code: 'H2', city: 'Pune' },
            ];

            mockHoardingRepo.findAll.mockResolvedValue({
                hoardings: mockHoardings,
                total: 2,
            });

            const result = await hoardingService.getAll({ page: '1', limit: '10' }, salesUser);

            expect(result).toHaveProperty('hoardings');
            expect(result.hoardings).toHaveLength(2);
            expect(mockHoardingRepo.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        city: { in: ['Mumbai', 'Pune'], mode: 'insensitive' },
                    }),
                })
            );
        });

        it('should filter by city when provided', async () => {
            const mockHoardings = [{ id: '1', code: 'H1', city: 'Mumbai' }];

            mockHoardingRepo.findAll.mockResolvedValue({
                hoardings: mockHoardings,
                total: 1,
            });

            const result = await hoardingService.getAll({ city: 'Mumbai' });

            expect(mockHoardingRepo.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        city: { contains: 'Mumbai', mode: 'insensitive' },
                    }),
                })
            );
        });

        it('should filter by status when provided', async () => {
            const mockHoardings = [{ id: '1', code: 'H1', status: 'available' }];

            mockHoardingRepo.findAll.mockResolvedValue({
                hoardings: mockHoardings,
                total: 1,
            });

            const result = await hoardingService.getAll({ status: 'available' });

            expect(mockHoardingRepo.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: 'available',
                    }),
                })
            );
        });
    });

    describe('getAvailability', () => {
        it('should return hoarding availability', async () => {
            const mockBookings = [
                {
                    id: 'booking-1',
                    startDate: new Date('2024-06-01'),
                    endDate: new Date('2024-06-30'),
                    status: 'confirmed',
                },
            ];

            mockBookingRepo.findByHoardingId.mockResolvedValue(mockBookings);

            const result = await hoardingService.getAvailability('hoarding-123');

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveProperty('startDate');
            expect(result[0]).toHaveProperty('endDate');
            expect(mockBookingRepo.findByHoardingId).toHaveBeenCalledWith('hoarding-123');
        });
    });
});
