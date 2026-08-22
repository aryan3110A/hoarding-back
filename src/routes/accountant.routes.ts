import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { AccountantController } from '../controllers/accountant.controller';
import { accountantBillUpload } from '../middleware/upload.middleware';

const router = Router();
const controller = new AccountantController();

router.get(
  '/summary',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.getSummary,
);

router.get(
  '/billing-queue',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.getBillingQueue,
);

router.get(
  '/firms',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.listFirmOptions,
);

router.post(
  '/billing-events/:id/po-pending',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.markBillingEventPoPending,
);

router.post(
  '/bills/generate',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  accountantBillUpload.single('billPdf'),
  controller.generateBill,
);

router.get(
  '/invoices',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.listInvoices,
);

router.post(
  '/invoices',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.createInvoice,
);

router.patch(
  '/invoices/:id',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.updateInvoice,
);

router.post(
  '/invoices/:id/payments',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.recordPayment,
);

router.get(
  '/payments',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.listPayments,
);

router.get(
  '/payment-tracking',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.getPaymentTrackingOverview,
);

router.post(
  '/invoices/:id/reminder',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.scheduleInvoiceReminder,
);

router.get(
  '/printing-expenses',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.listPrintingExpenses,
);

router.post(
  '/printing-expenses',
  authenticate,
  authorize(['accountant', 'owner', 'manager', 'admin']),
  controller.createPrintingExpense,
);

export default router;
