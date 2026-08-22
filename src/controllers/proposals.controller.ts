import { Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { ApiResponse } from '../lib/apiResponse';
import { ProposalsService } from '../services/proposals.service';

const service = new ProposalsService();

const toProposalFilenamePart = (value?: string | null) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const sanitized = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || 'client';
};

const toProposalTimestampPart = (value?: Date | string | null) => {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}_${pad(
    safeDate.getHours(),
  )}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`;
};

const buildProposalFilename = (proposal?: {
  client?: { name?: string | null; companyName?: string | null } | null;
  pdfGeneratedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}) => {
  const displayName =
    String(proposal?.client?.companyName || '').trim() ||
    String(proposal?.client?.name || '').trim();
  const clientPart = toProposalFilenamePart(displayName);
  const timestampPart = toProposalTimestampPart(
    proposal?.pdfGeneratedAt || proposal?.updatedAt || proposal?.createdAt || new Date(),
  );
  return `proposal_${clientPart}_${timestampPart}.pdf`;
};

export class ProposalsController {
  async generateAndStorePdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const updated = await service.generateAndStorePdf({
        proposalId: String(id),
        actorId: req.user.id,
        actorRole: req.user.role?.name,
      });
      res.status(200).json(ApiResponse.success(updated));
    } catch (err) {
      next(err);
    }
  }
  async generatePdf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { hoardings, client } = req.body as { hoardings: string[]; client?: any };
      if (!Array.isArray(hoardings) || hoardings.length === 0) {
        return res.status(400).json(ApiResponse.error('No hoardings provided'));
      }

      // Service will stream a PDF buffer back
      const pdfBuffer = await service.generateProposalPdf({
        hoardingIds: hoardings,
        client,
        actorId: req.user.id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      const filename = buildProposalFilename({ client, pdfGeneratedAt: new Date() });
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));

      const body = req.body as any;
      const client = body?.client;
      const proposalDate = body?.proposalDate;
      const mode = body?.mode;
      const discountType = body?.discountType;
      const discountValue = body?.discountValue;
      const printingCharges = body?.printingCharges;
      const mountingCharges = body?.mountingCharges;
      const globalDiscountPct = body?.globalDiscountPct;
      const includeGst = body?.includeGst;
      const gstRatePct = body?.gstRatePct;

      // Backwards-compatible: allow `hoardings: string[]` OR `hoardings: {hoardingId,...}[]`
      const hoardingsRaw = body?.hoardings;
      let hoardings: Array<{
        hoardingId: string;
        discountPct?: number;
        illumination?: boolean;
        illuminationCost?: number;
      }> = [];
      if (
        Array.isArray(hoardingsRaw) &&
        hoardingsRaw.length > 0 &&
        typeof hoardingsRaw[0] === 'string'
      ) {
        hoardings = (hoardingsRaw as string[]).map((id: string) => ({ hoardingId: id }));
      } else if (Array.isArray(hoardingsRaw)) {
        hoardings = hoardingsRaw;
      }
      if (!client || !client.phone || !Array.isArray(hoardings) || hoardings.length === 0) {
        return res.status(400).json(ApiResponse.error('Invalid request'));
      }

      const created = await service.createDraftProposal({
        client,
        hoardings,
        salesUserId: req.user.id,
        proposalDate,
        mode,
        discountType,
        discountValue,
        printingCharges,
        mountingCharges,
        globalDiscountPct,
        includeGst,
        gstRatePct,
      });
      res.status(201).json(ApiResponse.success(created));
    } catch (err) {
      next(err);
    }
  }

  async updateDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const body = req.body as any;
      const updated = await service.updateDraftProposal({
        proposalId: String(id),
        actorId: req.user.id,
        actorRole: req.user.role?.name,
        proposalDate: body?.proposalDate,
        mode: body?.mode,
        discountType: body?.discountType,
        discountValue: body?.discountValue,
        printingCharges: body?.printingCharges,
        mountingCharges: body?.mountingCharges,
        globalDiscountPct: body?.globalDiscountPct,
        includeGst: body?.includeGst,
        gstRatePct: body?.gstRatePct,
        hoardings: body?.hoardings,
      });
      res.status(200).json(ApiResponse.success(updated));
    } catch (err) {
      next(err);
    }
  }

  async send(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const updated = await service.sendProposal({
        proposalId: String(id),
        actorId: req.user.id,
        actorRole: req.user.role?.name,
      });
      res.status(200).json(ApiResponse.success(updated));
    } catch (err) {
      next(err);
    }
  }

  async finalize(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const body = (req.body || {}) as any;
      const selectedHoardingIds = Array.isArray(body?.hoardingIds)
        ? (body.hoardingIds as unknown[]).map((x) => String(x || '')).filter(Boolean)
        : undefined;
      const finalRates =
        body?.finalRates && typeof body.finalRates === 'object'
          ? Object.fromEntries(
              Object.entries(body.finalRates as Record<string, unknown>).map(([k, v]) => [
                String(k || ''),
                Number(v),
              ]),
            )
          : undefined;
      const updated = await service.finalizeProposal({
        proposalId: String(id),
        actorId: req.user.id,
        actorRole: req.user.role?.name,
        selectedHoardingIds,
        finalRates,
      });
      res.status(200).json(ApiResponse.success(updated));
    } catch (err) {
      next(err);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const roleName = (req.user.role?.name || '').toLowerCase();
      const rows = await service.listProposals({
        salesUserId: roleName === 'sales' ? req.user.id : undefined,
      });
      res.status(200).json(ApiResponse.success(rows));
    } catch (err) {
      next(err);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const row = await service.getProposalById(String(id));
      if (!row) return res.status(404).json(ApiResponse.error('Not found'));

      const roleName = (req.user.role?.name || '').toLowerCase();
      if (roleName === 'sales' && row.salesUserId !== req.user.id) {
        return res.status(403).json(ApiResponse.error('Forbidden'));
      }
      res.status(200).json(ApiResponse.success(row));
    } catch (err) {
      next(err);
    }
  }

  async generatePdfById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const proposal = await service.getProposalById(String(id));
      if (!proposal) return res.status(404).json(ApiResponse.error('Not found'));

      const roleName = (req.user.role?.name || '').toLowerCase();
      if (roleName === 'sales' && proposal.salesUserId !== req.user.id) {
        return res.status(403).json(ApiResponse.error('Forbidden'));
      }

      // If we already have a stored PDF, prefer serving it.
      if (proposal.pdfPath) {
        const diskPath = path.resolve(
          process.cwd(),
          'uploads',
          ...String(proposal.pdfPath).split('/'),
        );
        try {
          await fs.access(diskPath);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename=${buildProposalFilename(proposal)}`);
          return res.sendFile(diskPath);
        } catch (_) {
          // fallback to on-the-fly generation
        }
      }

      const pdfBuffer = await service.generateProposalPdf({
        proposalId: String(id),
        actorId: req.user.id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${buildProposalFilename(proposal)}`);
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  }

  async requestRateApproval(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { id } = req.params;
      const { hoardingId, proposedRate, reason, remarks } = req.body;
      if (!hoardingId || proposedRate == null || !reason) {
        return res.status(400).json(ApiResponse.error('Missing required fields'));
      }
      const request = await service.requestRateApproval({
        proposalId: String(id),
        hoardingId: String(hoardingId),
        proposedRate: Number(proposedRate),
        reason: String(reason),
        remarks: remarks ? String(remarks) : undefined,
        requestedById: req.user.id,
      });
      res.status(201).json(ApiResponse.success(request));
    } catch (err) {
      next(err);
    }
  }

  async listPendingRateApprovals(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const list = await service.listPendingRateApprovals();
      res.status(200).json(ApiResponse.success(list));
    } catch (err) {
      next(err);
    }
  }

  async approveRateApproval(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { requestId } = req.params;
      const { remarks } = req.body;
      const request = await service.approveRateApproval(
        String(requestId),
        req.user.id,
        remarks ? String(remarks) : undefined
      );
      res.status(200).json(ApiResponse.success(request));
    } catch (err) {
      next(err);
    }
  }

  async rejectRateApproval(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) return res.status(401).json(ApiResponse.error('Unauthorized'));
      const { requestId } = req.params;
      const { remarks } = req.body;
      const request = await service.rejectRateApproval(
        String(requestId),
        req.user.id,
        remarks ? String(remarks) : undefined
      );
      res.status(200).json(ApiResponse.success(request));
    } catch (err) {
      next(err);
    }
  }
}
