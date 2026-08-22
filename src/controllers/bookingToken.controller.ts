import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, UploadedFile } from '../types/authenticated-request';
import { BlockHoardingService } from '../services/bookingToken.service';
import { ApiResponse } from '../lib/apiResponse';

const service = new BlockHoardingService();

export class BlockHoardingController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { hoardingId, dateFrom, dateTo, durationMonths, notes, client } = req.body as {
        hoardingId?: string;
        dateFrom?: string;
        dateTo?: string;
        durationMonths?: number;
        notes?: string;
        client?: { name?: string; phone?: string; email?: string; companyName?: string };
      };

      const block = await service.createBlock({
        hoardingId: String(hoardingId || ''),
        dateFrom: String(dateFrom || ''),
        // pass dateTo if present (legacy flow), otherwise durationMonths preferred
        dateTo: dateTo ? String(dateTo) : undefined,
        durationMonths: typeof durationMonths === 'number' ? Number(durationMonths) : undefined,
        notes: typeof notes === 'string' ? notes : undefined,
        client: {
          name: String(client?.name || ''),
          phone: String(client?.phone || ''),
          email: client?.email ? String(client.email) : undefined,
          companyName: client?.companyName ? String(client.companyName) : undefined,
        },
        salesUserId: req.user.id,
        actorRoleName: req.user.role.name,
      });
      res.status(201).json(ApiResponse.success(block, 'Hoarding blocked successfully'));
    } catch (err) {
      next(err);
    }
  }

  async confirm(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { executionType, plannedLiveDate, durationMonths, durationDays } = req.body as {
        executionType?: string;
        plannedLiveDate?: string;
        durationMonths?: number;
        durationDays?: number;
      };

      const durationInput =
        typeof durationDays === 'number' && !Number.isNaN(durationDays)
          ? `${Number(durationDays)}d`
          : typeof durationMonths === 'number' && !Number.isNaN(durationMonths)
            ? Number(durationMonths)
            : undefined;
      await service.confirmToken(
        id,
        req.user.id,
        req.user.role.name,
        executionType,
        plannedLiveDate,
        durationInput,
        {
          paymentPlanType: req.body?.paymentPlanType,
          billingFrequency: req.body?.billingFrequency,
          gstApplicable: req.body?.gstApplicable,
          finalAgreedBasePrice: req.body?.finalAgreedBasePrice,
          modeOfPayment: req.body?.modeOfPayment,
          printingChargesBase: req.body?.printingChargesBase,
          mountingChargesBase: req.body?.mountingChargesBase,
          poRequired: req.body?.poRequired,
          poNotes: req.body?.poNotes,
          expectedPoDate: req.body?.expectedPoDate,
          billingCompanyName: req.body?.billingCompanyName,
          billingPhone: req.body?.billingPhone,
          billingEmail: req.body?.billingEmail,
          gstin: req.body?.gstin,
          billingAddress: req.body?.billingAddress,
        },
      );
      res.status(200).json(ApiResponse.success(null, 'Booking confirmed'));
    } catch (err) {
      next(err);
    }
  }

  async updateDesignStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { status } = req.body as { status?: string };
      if (!status) return res.status(400).json(ApiResponse.error('Status is required'));
      await service.updateDesignStatus(id, req.user.id, String(status));
      res.status(200).json(ApiResponse.success(null, 'Design status updated'));
    } catch (err) {
      next(err);
    }
  }

  async cancel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      await service.cancelToken(id, req.user.id, req.user.role.name);
      res.status(200).json(ApiResponse.success(null, 'Token cancelled'));
    } catch (err) {
      next(err);
    }
  }

  async release(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      await service.cancelToken(id, req.user.id, req.user.role.name);
      res.status(200).json(ApiResponse.success(null, 'Token released'));
    } catch (err) {
      next(err);
    }
  }

  async requestExtension(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      await service.requestExtension(id, { id: req.user.id, roleName: req.user.role.name });
      res.status(200).json(ApiResponse.success(null, 'Extension requested'));
    } catch (err) {
      next(err);
    }
  }

  async approveExtension(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      await service.approveExtension(id, { id: req.user.id, roleName: req.user.role.name });
      res.status(200).json(ApiResponse.success(null, 'Extension approved'));
    } catch (err) {
      next(err);
    }
  }

  async rejectExtension(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      await service.rejectExtension(id, { id: req.user.id, roleName: req.user.role.name });
      res.status(200).json(ApiResponse.success(null, 'Extension rejected'));
    } catch (err) {
      next(err);
    }
  }

  async mine(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const tokens = await service.listMyTokens(req.user.id);
      res.status(200).json(ApiResponse.success(tokens));
    } catch (err) {
      next(err);
    }
  }

  async assignedToMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const tokens = await service.listAssignedToDesigner(req.user.id);
      res.status(200).json(ApiResponse.success(tokens));
    } catch (err) {
      next(err);
    }
  }

  async assignedInstallations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const tokens = await service.listAssignedToFitter(req.user.id);
      res.status(200).json(ApiResponse.success(tokens));
    } catch (err) {
      next(err);
    }
  }

  async fitters(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const rows = await service.listActiveFitters();
      res.status(200).json(ApiResponse.success(rows));
    } catch (err) {
      next(err);
    }
  }

  async designers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const rows = await service.listActiveDesigners();
      res.status(200).json(ApiResponse.success(rows));
    } catch (err) {
      next(err);
    }
  }

  async assignFitter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { fitterId } = req.body as { fitterId?: string };
      await service.assignFitter(id, req.user.id, req.user.role.name, fitterId);
      res.status(200).json(ApiResponse.success(null, 'Fitter assigned'));
    } catch (err) {
      next(err);
    }
  }

  async updateFitterStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { status } = req.body as { status?: string };
      if (!status) return res.status(400).json(ApiResponse.error('Status is required'));
      await service.updateFitterStatus(id, req.user.id, String(status));
      res.status(200).json(ApiResponse.success(null, 'Installation status updated'));
    } catch (err) {
      next(err);
    }
  }

  async completeInstallation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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
        return res
          .status(400)
          .json(ApiResponse.error('At least one installation proof image is required'));
      }
      const mapped = files.map((f) => ({
        filename: f.filename,
        url: `/uploads/installation/${f.filename}`,
      }));
      await service.completeInstallationWithProof(id, req.user.id, mapped);
      res.status(200).json(ApiResponse.success(null, 'Installation submitted'));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const token = await service.getTokenDetails(id, req.user);
      res.status(200).json(ApiResponse.success(token));
    } catch (err) {
      next(err);
    }
  }

  async recent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { from, to, hoardingId, salesUserId } = req.query as Record<string, string | undefined>;
      const rows = await service.listRecentTokens({ from, to, hoardingId, salesUserId });
      res.status(200).json(ApiResponse.success(rows));
    } catch (err) {
      next(err);
    }
  }
}
