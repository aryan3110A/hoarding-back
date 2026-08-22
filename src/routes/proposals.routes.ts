import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { ProposalsController } from '../controllers/proposals.controller';

const router = Router();
const controller = new ProposalsController();

// Sales can generate proposal PDFs
router.post(
  '/pdf',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.generatePdf,
);

// Create DRAFT proposal (sales)
router.post('/', authenticate, authorize(['sales']), controller.create);

// Update DRAFT proposal (sales)
router.patch('/:id', authenticate, authorize(['sales']), controller.updateDraft);

// Rate Approval Requests
router.post('/:id/rate-approval', authenticate, authorize(['sales']), controller.requestRateApproval);
router.get('/rate-approvals/pending', authenticate, authorize(['owner', 'manager', 'admin']), controller.listPendingRateApprovals);
router.post('/rate-approvals/:requestId/approve', authenticate, authorize(['owner', 'manager', 'admin']), controller.approveRateApproval);
router.post('/rate-approvals/:requestId/reject', authenticate, authorize(['owner', 'manager', 'admin']), controller.rejectRateApproval);

// Send proposal (generate + store PDF, mark SENT)
router.post('/:id/send', authenticate, authorize(['sales']), controller.send);

// Generate/store PDF without changing proposal status (DRAFT-safe)
router.post(
  '/:id/generate-pdf',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.generateAndStorePdf,
);

// Finalize proposal (mark FINALIZED)
router.post('/:id/finalize', authenticate, authorize(['sales']), controller.finalize);

// List proposals (sales can see own proposals)
router.get('/', authenticate, authorize(['sales', 'owner', 'manager', 'admin']), controller.list);

// Get proposal by id
router.get(
  '/:id',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.getById,
);

// Get proposal PDF by id
router.get(
  '/:id/pdf',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin']),
  controller.generatePdfById,
);

export default router;
