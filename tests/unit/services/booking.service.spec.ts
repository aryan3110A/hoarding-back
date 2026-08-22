import { BookingService } from '../../../src/services/booking.service';
import { BadRequestError } from '../../../src/lib/errors';
import { HoardingRepository } from '../../../src/repositories/hoarding.repository';
import { BookingRepository } from '../../../src/repositories/booking.repository';

// Define mocks with shared state inside the factory
jest.mock('../../../src/repositories/hoarding.repository', () => {
    const mockRepo = {
        findById: jest.fn(),
    };
    return {
        HoardingRepository: jest.fn(() => mockRepo),
    };
});

jest.mock('../../../src/repositories/booking.repository', () => {
    const mockRepo = {
        findByHoardingId: jest.fn(),
        create: jest.fn(),
    };
    return {
        BookingRepository: jest.fn(() => mockRepo),
    };
});

describe('BookingService (unit)', () => {
    let bookingService: BookingService;
    let mockHoardingRepo: any;
    let mockBookingRepo: any;

    beforeEach(() => {
        jest.clearAllMocks();
        bookingService = new BookingService();

        mockHoardingRepo = new HoardingRepository() as any;
        mockBookingRepo = new BookingRepository() as any;
    });

    describe('createBooking', () => {
        const mockHoarding = {
            id: 'hoarding-123',
            code: 'H-TEST-001',
            status: 'available',
        };

        const validBookingData = {
            hoarding: { connect: { id: 'hoarding-123' } },
            clientName: 'Test Client',
            clientContact: '9876543210',
            startDate: new Date('2024-06-01'),
            endDate: new Date('2024-06-30'),
            price: 50000,
            createdBy: 'user-123',
        };

        it('should create booking when hoarding exists and no overlap', async () => {
            mockHoardingRepo.findById.mockResolvedValue(mockHoarding);
            mockBookingRepo.findByHoardingId.mockResolvedValue([]);
            mockBookingRepo.create.mockResolvedValue({
                id: 'booking-123',
                ...validBookingData,
            });

            const result = await bookingService.createBooking(validBookingData);

            expect(result).toHaveProperty('id');
            expect(mockBookingRepo.create).toHaveBeenCalled();
        });

        it('should throw error when hoarding not found', async () => {
            mockHoardingRepo.findById.mockResolvedValue(null);

            await expect(bookingService.createBooking(validBookingData)).rejects.toThrow(
                BadRequestError
            );
        });

        it('should throw error when dates overlap with existing booking', async () => {
            mockHoardingRepo.findById.mockResolvedValue(mockHoarding);
            mockBookingRepo.findByHoardingId.mockResolvedValue([
                {
                    id: 'existing-booking',
                    startDate: new Date('2024-06-15'),
                    endDate: new Date('2024-06-25'),
                    status: 'confirmed',
                },
            ]);

            await expect(bookingService.createBooking(validBookingData)).rejects.toThrow(
                'Hoarding is already booked'
            );
        });

        it('should throw error when startDate or endDate is missing', async () => {
            mockHoardingRepo.findById.mockResolvedValue(mockHoarding);

            await expect(
                bookingService.createBooking({
                    ...validBookingData,
                    startDate: undefined,
                })
            ).rejects.toThrow('Start date and end date are required');
        });

        it('should allow booking when dates do not overlap', async () => {
            mockHoardingRepo.findById.mockResolvedValue(mockHoarding);
            mockBookingRepo.findByHoardingId.mockResolvedValue([
                {
                    id: 'existing-booking',
                    startDate: new Date('2024-05-01'),
                    endDate: new Date('2024-05-31'),
                    status: 'confirmed',
                },
            ]);
            mockBookingRepo.create.mockResolvedValue({
                id: 'booking-123',
                ...validBookingData,
            });

            const result = await bookingService.createBooking(validBookingData);

            expect(result).toHaveProperty('id');
            expect(mockBookingRepo.create).toHaveBeenCalled();
        });
    });
});

