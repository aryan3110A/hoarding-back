import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import InquiryService from '../services/inquiry.service';

export class InquiryController {
  async listSalesUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const rows = await InquiryService.listSalesUsers();
      res.status(200).json(ApiResponse.success(rows, 'Sales users retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const result = await InquiryService.list(req.query, { id: req.user.id, role: req.user.role });
      res.status(200).json(ApiResponse.success(result, 'Inquiries retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async getReminders(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const result = await InquiryService.listReminders(req.query, {
        id: req.user.id,
        role: req.user.role,
      });
      res.status(200).json(ApiResponse.success(result, 'Inquiry reminders retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const row = await InquiryService.getById(id, { id: req.user.id, role: req.user.role });
      res.status(200).json(ApiResponse.success(row, 'Inquiry retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const payload = req.body || {};
      const { inquiry, created } = await InquiryService.createInquiry(payload, {
        id: req.user.id,
        role: req.user.role,
      });

      let message = created ? 'Inquiry created successfully' : 'Existing inquiry found';
      try {
        const roleName = String((req.user as any)?.role?.name || (req.user as any)?.role || '')
          .toLowerCase()
          .trim();
        const assignedSalesId = String((inquiry as any)?.assignedSalesId || '').trim();
        if (!created && roleName === 'sales' && assignedSalesId === String(req.user.id)) {
          message = 'Inquiry already exists (assigned to you)';
        }
      } catch (_) {
        // ignore message customization failures
      }

      res.status(created ? 201 : 200).json(ApiResponse.success(inquiry, message));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const payload = req.body || {};
      const updated = await InquiryService.updateInquiry(id, payload, {
        id: req.user.id,
        role: req.user.role,
      });
      res.status(200).json(ApiResponse.success(updated, 'Inquiry updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  async assignSales(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const assignedSalesIdRaw = (req.body || {}).assignedSalesId;
      const assignedSalesId =
        assignedSalesIdRaw == null ? null : String(assignedSalesIdRaw || '').trim() || null;
      const updated = await InquiryService.assignSales(id, assignedSalesId, {
        id: req.user.id,
        role: req.user.role,
      });
      res.status(200).json(ApiResponse.success(updated, 'Sales person assigned successfully'));
    } catch (error) {
      next(error);
    }
  }
}

export default new InquiryController();
