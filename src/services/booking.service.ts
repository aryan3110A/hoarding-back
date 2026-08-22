import { BookingRepository } from '../repositories/booking.repository';
import { HoardingRepository } from '../repositories/hoarding.repository';
import { BadRequestError } from '../lib/errors';
import { Prisma } from '@prisma/client';

const bookingRepository = new BookingRepository();
const hoardingRepository = new HoardingRepository();

export class BookingService {
    async createBooking(data: Prisma.BookingCreateInput) {
        const hoardingId = data.hoarding?.connect?.id;
        if (!hoardingId) {
            throw new BadRequestError('Hoarding ID is required');
        }

        const hoarding = await hoardingRepository.findById(hoardingId);
        if (!hoarding) {
            throw new BadRequestError('Hoarding not found');
        }

        if (!data.startDate || !data.endDate) {
            throw new BadRequestError('Start date and end date are required');
        }

        // Basic overlap check (Phase 1: simple check)
        const existingBookings = await bookingRepository.findByHoardingId(hoarding.id);
        const newStart = new Date(data.startDate as Date);
        const newEnd = new Date(data.endDate as Date);

        const hasOverlap = existingBookings.some(b => {
            if (!b.startDate || !b.endDate) return false;
            const bStart = new Date(b.startDate);
            const bEnd = new Date(b.endDate);
            return (newStart <= bEnd && newEnd >= bStart);
        });

        if (hasOverlap) {
            throw new BadRequestError('Hoarding is already booked for these dates');
        }

        // Create clean booking data - explicitly set only what we need
        // Prisma doesn't allow both hoardingId and hoarding relation, or createdBy and createdByUser
        // We use relations only
        const bookingData: Prisma.BookingCreateInput = {
            hoarding: data.hoarding, // Use relation, NOT hoardingId
            clientName: data.clientName,
            clientContact: data.clientContact,
            status: data.status || 'confirmed',
            startDate: data.startDate,
            endDate: data.endDate,
        };
        
        // Only add price if provided
        if (data.price !== undefined && data.price !== null) {
            bookingData.price = data.price;
        }
        
        // Use createdByUser relation (NOT createdBy field)
        if (data.createdByUser) {
            bookingData.createdByUser = data.createdByUser;
        }

        // Explicitly ensure no hoardingId or createdBy fields are present
        return bookingRepository.create(bookingData);
    }

    async getAllBookings() {
        return bookingRepository.findAll();
    }
}
