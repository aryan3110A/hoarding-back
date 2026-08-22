import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import EnquiryService from '../services/enquiry.service';

export class EnquiryController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const rows = await EnquiryService.listAll();
      res.status(200).json(ApiResponse.success(rows, 'Enquiries retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const payload = req.body || {};
      const created = await EnquiryService.createEnquiry(payload, req.user.id);
      res.status(201).json(ApiResponse.success(created, 'Enquiry created successfully'));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const payload = req.body || {};
      const updated = await EnquiryService.update(id, payload);
      res.status(200).json(ApiResponse.success(updated, 'Enquiry updated successfully'));
    } catch (error) {
      next(error);
    }
  }
}
