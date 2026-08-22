import { Request, Response, NextFunction } from 'express';
import { HoardingService } from '../services/hoarding.service';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';

const hoardingService = new HoardingService();

export class HoardingController {
  async listRemountRenew(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const rows = await hoardingService.listRemountRenewRows({
        actorId: req.user.id,
        actorRole: req.user.role.name,
      });
      res.status(200).json(ApiResponse.success(rows));
    } catch (error) {
      next(error);
    }
  }

  async requestRemount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const updated = await hoardingService.requestRemount(id, {
        id: req.user.id,
        roleName: req.user.role.name,
      });
      res.status(200).json(ApiResponse.success(updated, 'Remount requested'));
    } catch (error) {
      next(error);
    }
  }

  async notifySupervisor(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const result = await hoardingService.sendSupervisorProceedReminder(id, {
        id: req.user.id,
        roleName: req.user.role.name,
        name: req.user.name,
      });
      res.status(200).json(ApiResponse.success(result, 'Notification sent to supervisor'));
    } catch (error) {
      next(error);
    }
  }

  async completeRemount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const updated = await hoardingService.completeRemount(id, {
        id: req.user.id,
        roleName: req.user.role.name,
      });
      res.status(200).json(ApiResponse.success(updated, 'Remount completed'));
    } catch (error) {
      next(error);
    }
  }

  async renew(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { tenure, newAmount, remountRequired } = req.body as {
        tenure?: number;
        newAmount?: number;
        remountRequired?: boolean;
      };
      const result = await hoardingService.renewHoarding(
        id,
        {
          tenure: Number(tenure || 0),
          newAmount: Number(newAmount || 0),
          remountRequired: !!remountRequired,
        },
        {
          id: req.user.id,
          roleName: req.user.role.name,
        },
      );
      res.status(200).json(ApiResponse.success(result, 'Hoarding renewed'));
    } catch (error) {
      next(error);
    }
  }

  async renewalHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const rows = await hoardingService.listRenewalHistory(id);
      res.status(200).json(ApiResponse.success(rows));
    } catch (error) {
      next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const hoarding = await hoardingService.create(req.body);
      res.status(201).json(ApiResponse.success(hoarding, 'Hoarding created'));
    } catch (error) {
      next(error);
    }
  }

  async nextCode(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const code = await hoardingService.generateNextSACode();
      res.status(200).json(ApiResponse.success({ code }));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const hoarding = await hoardingService.update(id, req.body);
      res.status(200).json(ApiResponse.success(hoarding, 'Hoarding updated'));
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const hoarding = await hoardingService.getById(id);
      if (!hoarding) {
        return res.status(404).json(ApiResponse.error('Hoarding not found'));
      }
      res.status(200).json(ApiResponse.success(hoarding));
    } catch (error) {
      next(error);
    }
  }

  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Pass user for territory filtering (sales users)
      const result = await hoardingService.getAll(req.query, req.user);
      res.status(200).json(ApiResponse.success(result));
    } catch (error) {
      next(error);
    }
  }

  async listCities(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const cities = await hoardingService.listCities();
      res.status(200).json(ApiResponse.success(cities));
    } catch (error) {
      next(error);
    }
  }

  async listLandmarks(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const landmarks = await hoardingService.listLandmarks();
      res.status(200).json(ApiResponse.success(landmarks));
    } catch (error) {
      next(error);
    }
  }

  async listTypes(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const types = await hoardingService.listTypes();
      res.status(200).json(ApiResponse.success(types));
    } catch (error) {
      next(error);
    }
  }

  async getAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const availability = await hoardingService.getAvailability(id);
      res.status(200).json(ApiResponse.success(availability));
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const mode = req.query.mode === 'permanent' ? 'permanent' : 'recycle';
      const result = await hoardingService.delete(id, mode, req.user?.id);
      res.status(200).json(ApiResponse.success(result, `Hoarding deleted (${mode})`));
    } catch (error) {
      next(error);
    }
  }

  async addImages(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { type, filenames } = req.body as { type?: string; filenames?: string[] };
      if (!Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json(ApiResponse.error('No filenames provided'));
      }
      const result = await hoardingService.addImageMetadata(id, {
        type: type || 'default',
        filenames,
      });
      res.status(200).json(ApiResponse.success(result, 'Image metadata added'));
    } catch (error) {
      next(error);
    }
  }

  async markUnderProcess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const updated = await hoardingService.markUnderProcess(id, {
        id: req.user?.id,
        roleName: req.user?.role?.name,
      });
      res.status(200).json(ApiResponse.success(updated, 'Status updated'));
    } catch (error) {
      next(error);
    }
  }

  async finalizeStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = req.body as { status?: string };
      if (!status) return res.status(400).json(ApiResponse.error('Status is required'));
      const updated = await hoardingService.finalizeWorkflowStatus(id, String(status), {
        id: req.user?.id,
        roleName: req.user?.role?.name,
      });
      res.status(200).json(ApiResponse.success(updated, 'Status updated'));
    } catch (error) {
      next(error);
    }
  }
}
