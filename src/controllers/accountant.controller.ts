import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { AccountantService } from '../services/accountant.service';

const svc = new AccountantService();

export class AccountantController {
  async getSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const summary = await svc.getSummary();
      res.status(200).json(ApiResponse.success(summary, 'Accountant summary'));
    } catch (error) {
      next(error);
    }
  }

  async listInvoices(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await svc.listInvoices({
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        clientId: req.query.clientId ? String(req.query.clientId) : undefined,
        contractId: req.query.contractId ? String(req.query.contractId) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
      });
      res.status(200).json(ApiResponse.success(result, 'Invoices retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async createInvoice(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const actorId = req.user?.id || '';
      const created = await svc.createInvoice(req.body, actorId);
      res.status(201).json(ApiResponse.success(created, 'Invoice created'));
    } catch (error) {
      next(error);
    }
  }

  async updateInvoice(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const invoiceId = req.params.id;
      const updated = await svc.updateInvoice(invoiceId, req.body || {});
      res.status(200).json(ApiResponse.success(updated, 'Invoice updated'));
    } catch (error) {
      next(error);
    }
  }

  async recordPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const invoiceId = req.params.id;
      const actorId = req.user?.id || '';
      const payment = await svc.recordPayment(invoiceId, req.body || {}, actorId);
      res.status(201).json(ApiResponse.success(payment, 'Payment recorded'));
    } catch (error) {
      next(error);
    }
  }

  async listPayments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await svc.listPayments({
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        invoiceId: req.query.invoiceId ? String(req.query.invoiceId) : undefined,
      });
      res.status(200).json(ApiResponse.success(result, 'Payments retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async getPaymentTrackingOverview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await svc.getPaymentTrackingOverview({
        search: req.query.search ? String(req.query.search) : undefined,
      });
      res.status(200).json(ApiResponse.success(result, 'Payment tracking retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async scheduleInvoiceReminder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const updated = await svc.scheduleInvoiceReminder(String(req.params.id || ''), {
        reminderAt: String(req.body?.reminderAt || ''),
        reminderNote: req.body?.reminderNote ? String(req.body.reminderNote) : undefined,
      });
      res.status(200).json(ApiResponse.success(updated, 'Invoice reminder scheduled'));
    } catch (error) {
      next(error);
    }
  }

  async listPrintingExpenses(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await svc.listPrintingExpenses({
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        contractId: req.query.contractId ? String(req.query.contractId) : undefined,
        clientId: req.query.clientId ? String(req.query.clientId) : undefined,
      });
      res.status(200).json(ApiResponse.success(result, 'Printing expenses retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async createPrintingExpense(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const actorId = req.user?.id || '';
      const created = await svc.createPrintingExpense(req.body, actorId);
      res.status(201).json(ApiResponse.success(created, 'Printing expense created'));
    } catch (error) {
      next(error);
    }
  }

  async getBillingQueue(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await svc.getBillingQueue({
        tab: req.query.tab ? String(req.query.tab) : undefined,
        clientId: req.query.clientId ? String(req.query.clientId) : undefined,
      });
      res.status(200).json(ApiResponse.success(result, 'Billing queue retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async listFirmOptions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const rows = await svc.listFirmOptions();
      res.status(200).json(ApiResponse.success(rows, 'Billing firms retrieved'));
    } catch (error) {
      next(error);
    }
  }

  async markBillingEventPoPending(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const updated = await svc.markBillingEventPoPending(String(req.params.id || ''));
      res.status(200).json(ApiResponse.success(updated, 'Billing event marked PO Pending'));
    } catch (error) {
      next(error);
    }
  }

  async generateBill(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const actorId = req.user?.id || '';
      const file = (req as any).file as { path?: string } | undefined;
      const eventIdsRaw = req.body?.eventIds;
      const eventIds = Array.isArray(eventIdsRaw)
        ? eventIdsRaw
        : typeof eventIdsRaw === 'string' && eventIdsRaw.trim().startsWith('[')
          ? JSON.parse(eventIdsRaw)
          : typeof eventIdsRaw === 'string'
            ? eventIdsRaw
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
            : [];

      const created = await svc.generateBill(
        {
          eventIds,
          firmName: String(req.body?.firmName || ''),
          billNumber: String(req.body?.billNumber || ''),
          remarks: req.body?.remarks ? String(req.body.remarks) : undefined,
        },
        actorId,
        file?.path || null,
      );
      res.status(201).json(ApiResponse.success(created, 'Bill generated successfully'));
    } catch (error) {
      next(error);
    }
  }
}
