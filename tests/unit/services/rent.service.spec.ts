import { RentService } from '../../../src/services/rent.service';
import { RentRepository } from '../../../src/repositories/rent.repository';
import { HoardingRepository } from '../../../src/repositories/hoarding.repository';
import { BadRequestError, NotFoundError } from '../../../src/lib/errors';

// Mock dependencies
jest.mock('../../../src/repositories/rent.repository');
jest.mock('../../../src/repositories/hoarding.repository');

describe('RentService', () => {
    let rentService: RentService;
    let mockRentRepository: jest.Mocked<RentRepository>;
    let mockHoardingRepository: jest.Mocked<HoardingRepository>;

    beforeEach(() => {
        mockRentRepository = new RentRepository() as jest.Mocked<RentRepository>;
        mockHoardingRepository = new HoardingRepository() as jest.Mocked<HoardingRepository>;

        // Inject mocks manually since we can't easily use DI container here without setup
        // But since RentService instantiates them directly, we need to mock the module.
        // The jest.mock calls above mock the module, so new RentRepository() returns the mock.

        rentService = new RentService();
        // We need to access the instances created inside RentService.
        // Since we can't easily do that without modifying RentService to accept deps,
        // we rely on the fact that jest.mock replaces the constructor.
        // However, to control the instance methods, we need to get the instance.
        // A better way is to spy on the prototype or use a shared mock instance pattern.

        // Let's use the shared mock instance pattern if possible, or just assume the module mock works.
        // For simplicity in this environment, let's assume the module mock returns our mock instance.
        (RentRepository as jest.Mock).mockImplementation(() => mockRentRepository);
        (HoardingRepository as jest.Mock).mockImplementation(() => mockHoardingRepository);

        // Re-instantiate service to use the mocks
        rentService = new RentService();
    });

    describe('saveRent', () => {
        it('should calculate nextDueDate correctly for Monthly payment', async () => {
            const hoardingId = 'h1';
            const data = {
                partyType: 'Private',
                rentAmount: 1000,
                paymentMode: 'Monthly',
                lastPaymentDate: '2023-01-01',
            };

            mockHoardingRepository.findById.mockResolvedValue({ id: hoardingId } as any);
            mockRentRepository.findByHoardingId.mockResolvedValue(null);
            mockRentRepository.create.mockResolvedValue({} as any);

            await rentService.saveRent(hoardingId, data);

            expect(mockRentRepository.create).toHaveBeenCalledWith(expect.objectContaining({
                nextDueDate: new Date('2023-02-01'),
            }));
        });

        it('should throw NotFoundError if hoarding does not exist', async () => {
            mockHoardingRepository.findById.mockResolvedValue(null);
            await expect(rentService.saveRent('invalid', {})).rejects.toThrow(NotFoundError);
        });
    });

    describe('recalculateRent', () => {
        it('should increase rent by 10%', async () => {
            const hoardingId = 'h1';
            mockRentRepository.findByHoardingId.mockResolvedValue({
                id: 'r1',
                rentAmount: 1000,
                incrementYear: 2023,
            } as any);
            mockRentRepository.update.mockResolvedValue({} as any);

            await rentService.recalculateRent(hoardingId);

            expect(mockRentRepository.update).toHaveBeenCalledWith('r1', expect.objectContaining({
                rentAmount: expect.anything(), // Decimal is tricky to match exactly without Prisma.Decimal
            }));

            // Verify the calculation logic indirectly or check the call arguments
            const updateCall = mockRentRepository.update.mock.calls[0];
            const updateData = updateCall[1];
            expect(Number(updateData.rentAmount)).toBe(1100);
        });
    });
});
