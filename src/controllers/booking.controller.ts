import { Response, NextFunction } from 'express';
import { BookingService } from '../services/booking.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { Prisma } from '@prisma/client';

const bookingService = new BookingService();

export class BookingController {
    async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const bookings = await bookingService.getAllBookings();
            res.status(200).json(ApiResponse.success(bookings, 'Bookings retrieved'));
        } catch (error) {
            next(error);
        }
    }

    async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user) throw new Error('User not authenticated');
            const { hoardingId, ...rest } = req.body;
            
            // Create booking data with only Prisma-compatible fields
            // Use relations, not direct foreign key fields
            const bookingData: Prisma.BookingCreateInput = {
                clientName: rest.clientName,
                clientContact: rest.clientContact,
                status: rest.status || 'confirmed',
                hoarding: { connect: { id: hoardingId } },
                createdByUser: { connect: { id: req.user.id } },
            };
            
            if (rest.startDate) {
                bookingData.startDate = new Date(rest.startDate);
            }
            if (rest.endDate) {
                bookingData.endDate = new Date(rest.endDate);
            }
            if (rest.price !== undefined && rest.price !== null) {
                bookingData.price = rest.price;
            }
            
            const booking = await bookingService.createBooking(bookingData);
            res.status(201).json(ApiResponse.success(booking, 'Booking created'));
        } catch (error) {
            next(error);
        }
    }
}
