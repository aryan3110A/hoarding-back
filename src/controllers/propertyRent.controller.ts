import { Response, NextFunction } from 'express';
import { PropertyRentService } from '../services/propertyRent.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { NotFoundError } from '../lib/errors';

const service = new PropertyRentService();

export class PropertyRentController {
  async save(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const actor = req.user;
      const rent = await service.save(req.body, actor);
      res.status(200).json(ApiResponse.success(rent, 'Property rent saved'));
    } catch (e) {
      next(e);
    }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { propertyGroupId } = req.params;
      try {
        const rent = await service.get(propertyGroupId);
        return res.status(200).json(ApiResponse.success(rent));
      } catch (err: unknown) {
        if (
          err instanceof NotFoundError ||
          (err instanceof Error && err.name === 'NotFoundError')
        ) {
          return res.status(200).json(ApiResponse.success(null, 'Property rent not found'));
        }
        throw err;
      }
    } catch (e) {
      next(e);
    }
  }

  async getByLandlord(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { landlordName } = req.params;
      try {
        const rent = await service.getByLandlord(decodeURIComponent(String(landlordName || '')));
        return res.status(200).json(ApiResponse.success(rent));
      } catch (err: unknown) {
        if (
          err instanceof NotFoundError ||
          (err instanceof Error && err.name === 'NotFoundError')
        ) {
          return res.status(200).json(ApiResponse.success(null, 'Landlord rent not found'));
        }
        throw err;
      }
    } catch (e) {
      next(e);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 100 } = req.query;
      const p = parseInt(page as string) || 1;
      const l = parseInt(limit as string) || 100;
      const skip = (p - 1) * l;
      const result = await service.list({ skip, take: l });
      res.status(200).json(ApiResponse.success(result));
    } catch (e) {
      next(e);
    }
  }

  async summary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const stats = await service.summary();
      res.status(200).json(ApiResponse.success(stats));
    } catch (e) {
      next(e);
    }
  }

  async dueBoard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const rows = await service.dueBoard();
      res.status(200).json(ApiResponse.success(rows));
    } catch (e) {
      next(e);
    }
  }

  async recordPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const body = (req.body || {}) as any;
      const file = (req as any).file as
        | { filename?: string; path?: string; originalname?: string }
        | undefined;

      const screenshotPath = file?.filename
        ? `/uploads/rent-payments/${file.filename}`
        : body.screenshotPath
          ? String(body.screenshotPath)
          : undefined;
      const screenshotUrl = screenshotPath || undefined;

      const result = await service.recordPayment({
        propertyRentId: body.propertyRentId ? String(body.propertyRentId) : undefined,
        propertyGroupId: body.propertyGroupId ? String(body.propertyGroupId) : undefined,
        landlordName: body.landlordName ? String(body.landlordName) : undefined,
        amountPaid: body.amountPaid,
        paymentDate: String(body.paymentDate || ''),
        paymentMode: String(body.paymentMode || ''),
        remarks: body.remarks ? String(body.remarks) : undefined,
        screenshotUrl,
        screenshotPath,
        recordedById: req.user.id,
      });

      res.status(201).json(ApiResponse.success(result, 'Rent payment recorded'));
    } catch (e) {
      next(e);
    }
  }

  async paymentTotals(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const totals = await service.paymentTotals();
      res.status(200).json(ApiResponse.success(totals));
    } catch (e) {
      next(e);
    }
  }
}
