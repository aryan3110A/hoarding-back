import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, UploadedFile } from '../types/authenticated-request';
import { SupervisorService } from '../services/supervisor.service';
import { MediaStorageService } from '../services/mediaStorage.service';
import { ApiResponse } from '../lib/apiResponse';
import { BadRequestError } from '../lib/errors';

const service = new SupervisorService();
const mediaStorageService = new MediaStorageService();

export class SupervisorController {
  async listExecutionBoard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const data = await service.listExecutionBoard(
        req.query as {
          tab?: string;
          page?: string;
          limit?: string;
          clientName?: string;
          city?: string;
          status?: string;
          dateFrom?: string;
          dateTo?: string;
        },
        { id: req.user.id, roleName: req.user.role.name },
      );
      res.status(200).json(ApiResponse.success(data));
    } catch (err) {
      next(err);
    }
  }

  async listHoardings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const data = await service.listHoardings(
        req.query as {
          page?: string;
          limit?: string;
          status?: string;
          sizeMatch?: string;
          condition?: string;
          materialReceived?: string;
        },
      );
      res.status(200).json(ApiResponse.success(data));
    } catch (err) {
      next(err);
    }
  }

  async listDesigners(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const data = await service.listDesigners();
      res.status(200).json(ApiResponse.success(data));
    } catch (err) {
      next(err);
    }
  }

  async updateChecklist(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { isCorrectSize, isGoodCondition, isFlexReceived, isReadyForInstall } = req.body as {
        isCorrectSize?: boolean;
        isGoodCondition?: boolean;
        isFlexReceived?: boolean;
        isReadyForInstall?: boolean;
      };
      const updated = await service.updateChecklist(
        id,
        { isCorrectSize, isGoodCondition, isFlexReceived, isReadyForInstall },
        { id: req.user.id, roleName: req.user.role.name },
      );
      res.status(200).json(ApiResponse.success(updated, 'Checklist updated'));
    } catch (err) {
      next(err);
    }
  }

  async uploadChecklistImage(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const rawFiles = req.files || [];
      let files: UploadedFile[] = [];
      if (Array.isArray(rawFiles)) {
        files = rawFiles as UploadedFile[];
      } else {
        files = Object.values(rawFiles as Record<string, UploadedFile[]>)?.flat() || [];
      }
      if (!files || files.length === 0) {
        return res.status(400).json(ApiResponse.error('At least one image is required'));
      }
      const mapped = await mediaStorageService.storeSupervisorChecklistImages(id, files);
      const updated = await service.uploadChecklistImages(
        id,
        { id: req.user.id, roleName: req.user.role.name },
        mapped,
      );
      res.status(200).json(ApiResponse.success(updated, 'Checklist image uploaded'));
    } catch (err) {
      next(err);
    }
  }

  async uploadExecutionImages(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const type = String((req.body as { type?: string })?.type || '')
        .trim()
        .toLowerCase();
      if (!['mount', 'remount', 'unmount'].includes(type)) {
        throw new BadRequestError('Image type must be one of: mount, remount, unmount');
      }

      const rawFiles = req.files || [];
      let files: UploadedFile[] = [];
      if (Array.isArray(rawFiles)) {
        files = rawFiles as UploadedFile[];
      } else {
        files = Object.values(rawFiles as Record<string, UploadedFile[]>)?.flat() || [];
      }
      if (!files || files.length === 0) {
        return res.status(400).json(ApiResponse.error('At least one image is required'));
      }
      const mapped = await mediaStorageService.storeSupervisorExecutionImages(
        id,
        type as 'mount' | 'remount' | 'unmount',
        files,
      );

      const updated = await service.uploadExecutionImages(
        id,
        { id: req.user.id, roleName: req.user.role.name },
        type as 'mount' | 'remount' | 'unmount',
        mapped,
      );
      res.status(200).json(ApiResponse.success(updated, 'Execution images uploaded'));
    } catch (err) {
      next(err);
    }
  }

  async updateExecutionStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const nextStatus = String((req.body as { status?: string })?.status || '')
        .trim()
        .toLowerCase();
      if (
        ![
          'pending',
          'received',
          'live',
          'remount_pending',
          'remounted',
          'unmount_pending',
          'unmounted',
        ].includes(nextStatus)
      ) {
        throw new BadRequestError('Invalid execution status');
      }

      const updated = await service.updateExecutionStatus(
        id,
        nextStatus as
          | 'pending'
          | 'received'
          | 'live'
          | 'remount_pending'
          | 'remounted'
          | 'unmount_pending'
          | 'unmounted',
        { id: req.user.id, roleName: req.user.role.name },
      );

      res.status(200).json(ApiResponse.success(updated, 'Execution status updated'));
    } catch (err) {
      next(err);
    }
  }

  async setExecutionType(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { executionType, designerId } = req.body as {
        executionType?: string;
        designerId?: string;
      };
      const normalized = String(executionType || '').toUpperCase();
      if (!['CLIENT_CDR', 'IN_HOUSE_DESIGN', 'CLIENT_DIRECT_FLEX'].includes(normalized)) {
        throw new BadRequestError('Invalid execution type');
      }
      const updated = await service.setExecutionType(
        id,
        normalized as 'CLIENT_CDR' | 'IN_HOUSE_DESIGN' | 'CLIENT_DIRECT_FLEX',
        { id: req.user.id, roleName: req.user.role.name },
        designerId ? String(designerId) : undefined,
      );
      res.status(200).json(ApiResponse.success(updated, 'Execution type updated'));
    } catch (err) {
      next(err);
    }
  }

  async markFit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const updated = await service.markFit(id, { id: req.user.id, roleName: req.user.role.name });
      res.status(200).json(ApiResponse.success(updated, 'Hoarding marked under process'));
    } catch (err) {
      next(err);
    }
  }

  async markLive(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { liveDate, billingStartDate, billingPeriodOverrideNote } = req.body as {
        liveDate?: string;
        billingStartDate?: string;
        billingPeriodOverrideNote?: string;
      };
      const updated = await service.markLive(
        id,
        { id: req.user.id, roleName: req.user.role.name },
        liveDate,
        billingStartDate,
        billingPeriodOverrideNote,
      );
      res.status(200).json(ApiResponse.success(updated, 'Hoarding marked live'));
    } catch (err) {
      next(err);
    }
  }

  async setLiveDate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { plannedLiveDate } = req.body as { plannedLiveDate?: string };
      const updated = await service.setPlannedLiveDate(
        id,
        { id: req.user.id, roleName: req.user.role.name },
        plannedLiveDate,
      );
      res.status(200).json(ApiResponse.success(updated, 'Live date set'));
    } catch (err) {
      next(err);
    }
  }

  async markRemoval(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };
      const updated = await service.markRemoval(id, String(reason || ''), {
        id: req.user.id,
        roleName: req.user.role.name,
      });
      res.status(200).json(ApiResponse.success(updated, 'Hoarding marked for removal'));
    } catch (err) {
      next(err);
    }
  }

  async generateOperationalPdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const buffer = await service.generateOperationalPdf(id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=hoarding-${id}-operational.pdf`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  }
}
