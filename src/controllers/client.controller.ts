import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { ClientRepository } from '../repositories/client.repository';
import { ClientService } from '../services/client.service';

const clientRepo = new ClientRepository();
const clientSvc = new ClientService();

export class ClientController {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page = '1', limit = '100' } = req.query as Record<string, string | undefined>;
      const pageNum = parseInt(page || '1') || 1;
      const take = Math.min(Math.max(parseInt(limit || '100') || 50, 1), 1000);
      const skip = (pageNum - 1) * take;
      const clients = await clientRepo.findAll({ skip, take });
      res.status(200).json(ApiResponse.success(clients, 'Clients retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async search(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { q = '', limit = '10' } = req.query as Record<string, string | undefined>;
      const rows = await clientRepo.search(String(q || ''), parseInt(String(limit || '10'), 10));
      res.status(200).json(ApiResponse.success(rows));
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const row = await clientRepo.findById(String(id));
      if (!row) return res.status(404).json(ApiResponse.error('Not found'));
      res.status(200).json(ApiResponse.success(row));
    } catch (error) {
      next(error);
    }
  }

  async getByPhone(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { phone = '' } = req.query as Record<string, string | undefined>;
      const cleanPhone = String(phone || '')
        .trim()
        .replace(/\s+/g, '')
        .replace(/\D/g, '');
      if (!cleanPhone) return res.status(400).json(ApiResponse.error('Phone is required'));

      const row = await clientRepo.findByPhone(cleanPhone);
      res.status(200).json(ApiResponse.success(row || null));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const body = (req.body || {}) as any;
      const input = {
        name: String(body?.name || ''),
        phone: String(body?.phone || ''),
        email: body?.email ? String(body.email) : undefined,
        companyName: body?.companyName ? String(body.companyName) : undefined,
      };
      const created = await clientSvc.createUnique(input, req.user.id);
      res.status(201).json(ApiResponse.success(created));
    } catch (error) {
      next(error);
    }
  }

  async upsertBillingProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const body = (req.body || {}) as any;
      const updated = await clientSvc.upsertBillingProfile(String(id), {
        billingCompanyName: body?.billingCompanyName ? String(body.billingCompanyName) : undefined,
        billingPhone: body?.billingPhone ? String(body.billingPhone) : undefined,
        billingEmail: body?.billingEmail ? String(body.billingEmail) : undefined,
        gstin: body?.gstin ? String(body.gstin) : undefined,
        billingAddress: body?.billingAddress ? String(body.billingAddress) : undefined,
      });
      res.status(200).json(ApiResponse.success(updated, 'Client billing profile updated'));
    } catch (error) {
      next(error);
    }
  }

  async getHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await clientSvc.getHistory(String(id));
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }
}
