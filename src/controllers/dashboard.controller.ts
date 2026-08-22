import { Response, NextFunction } from 'express';
import { DashboardService } from '../services/dashboard.service';
import SalesPerformanceService from '../services/salesPerformance.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const dashboardService = new DashboardService();

export class DashboardController {
  async getOwnerDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getOwnerDashboardStats();
      res.status(200).json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  }

  async getManagerDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getManagerDashboardStats();
      res.status(200).json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  }

  async getSalesDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const stats = await dashboardService.getSalesDashboardStats(userId);
      res.status(200).json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  }

  async getSalesPerformance(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await SalesPerformanceService.getOverview({
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
        endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
        groupBy: typeof req.query.groupBy === 'string' ? req.query.groupBy : undefined,
        salespersonId:
          typeof req.query.salespersonId === 'string' ? req.query.salespersonId : undefined,
        currentUserId: req.user?.id,
        currentRole: req.user?.role?.name,
      });
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }

  async getSalesPerformanceClients(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await SalesPerformanceService.getClients({
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
        endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
        salespersonId:
          typeof req.query.salespersonId === 'string' ? req.query.salespersonId : undefined,
        currentUserId: req.user?.id,
        currentRole: req.user?.role?.name,
      });
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }

  async getSalesMarketVisits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await SalesPerformanceService.listMarketVisits({
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
        endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
        salespersonId:
          typeof req.query.salespersonId === 'string' ? req.query.salespersonId : undefined,
        currentUserId: req.user?.id,
        currentRole: req.user?.role?.name,
      });
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }

  async saveSalesMarketVisit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await SalesPerformanceService.upsertMarketVisit(req.body || {}, {
        id: req.user?.id,
        role: req.user?.role,
      });
      res.status(200).json(ApiResponse.success(result, 'Market visit saved'));
    } catch (error) {
      next(error);
    }
  }

  async getDesignerDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const stats = await dashboardService.getDesignerDashboardStats(userId);
      res.status(200).json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  }

  async getFitterDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const stats = await dashboardService.getFitterDashboardStats(userId);
      res.status(200).json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  }

  async getExpiringContracts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const rows = await dashboardService.getExpiringContracts();
      res.status(200).json(ApiResponse.success(rows));
    } catch (error) {
      next(error);
    }
  }
}
