import { Response, NextFunction } from 'express';
import { RentService } from '../services/rent.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const rentService = new RentService();

export class RentController {
    async getRentDetails(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const rent = await rentService.getRentDetails(id);
            res.status(200).json(ApiResponse.success(rent));
        } catch (error) {
            next(error);
        }
    }

    async saveRent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const rent = await rentService.saveRent(id, req.body, req.user);
            res.status(200).json(ApiResponse.success(rent, 'Rent details saved successfully'));
        } catch (error) {
            next(error);
        }
    }

    async recalculateRent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const rent = await rentService.recalculateRent(id);
            res.status(200).json(ApiResponse.success(rent, 'Rent recalculated successfully'));
        } catch (error) {
            next(error);
        }
    }

    async getAllRents(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { page = 1, limit = 100 } = req.query;
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 100;
            const skip = (pageNum - 1) * limitNum;
            const result = await rentService.getAllRents({ skip, take: limitNum });
            res.status(200).json(ApiResponse.success(result));
        } catch (error) {
            next(error);
        }
    }
}
