import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { ContractService } from '../services/contract.service';

const svc = new ContractService();

export class ContractController {
  async getRenewalsDue(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const actorId = req.user?.id || '';
      const actorRole = (req.user as any)?.role?.name || '';
      const days = req.query?.days ? Number(req.query.days) : 15;
      const renewals = await svc.listRenewalsDue({ actorId, actorRole, days });
      res.status(200).json(ApiResponse.success(renewals, 'Renewals due retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async sendRenewalReminder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const contractId = req.params.id;
      const actorId = req.user?.id || '';
      const actorName = req.user?.name || '';
      const actorRole = (req.user as any)?.role?.name || '';
      const result = await svc.sendRenewalReminder(contractId, {
        id: actorId,
        name: actorName,
        role: actorRole,
      });
      res.status(200).json(ApiResponse.success(result, 'Renewal reminder sent'));
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const contracts = await svc.listAll();
      res.status(200).json(ApiResponse.success(contracts, 'Contracts retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const payload = req.body;
      const userId = req.user?.id;
      const created = await svc.createContract(payload, userId || '');
      res.status(201).json(ApiResponse.success(created, 'Contract created'));
    } catch (error) {
      next(error);
    }
  }

  async renew(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const contractId = req.params.id;
      const opts = req.body || {};
      const actorId = req.user?.id || '';
      const result = await svc.renewContract(contractId, actorId, opts);
      res.status(200).json(ApiResponse.success(result, 'Renewal processed'));
    } catch (error) {
      next(error);
    }
  }

  async cancel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const contractId = req.params.id;
      const actorId = req.user?.id || '';
      const result = await svc.cancelContract(contractId, actorId);
      res.status(200).json(ApiResponse.success(result, 'Contract cancelled'));
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const contractId = req.params.id;
      const contract = await svc.getById(contractId);
      res.status(200).json(ApiResponse.success(contract, 'Contract retrieved'));
    } catch (error) {
      next(error);
    }
  }
}
