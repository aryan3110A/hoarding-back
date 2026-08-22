import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { SupervisorController } from '../controllers/supervisor.controller';
import {
  supervisorChecklistUpload,
  supervisorExecutionUpload,
} from '../middleware/upload.middleware';

const router = Router();
const controller = new SupervisorController();

router.get(
  '/execution-board',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin', 'sales']),
  controller.listExecutionBoard,
);

router.get(
  '/hoardings',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin', 'sales']),
  controller.listHoardings,
);

router.get(
  '/designers',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  controller.listDesigners,
);

router.put(
  '/hoardings/:id/checklist',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  controller.updateChecklist,
);

router.post(
  '/hoardings/:id/checklist-image',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  supervisorChecklistUpload.array('images', 5),
  controller.uploadChecklistImage,
);

router.post(
  '/hoardings/:id/execution-images',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  supervisorExecutionUpload.array('images', 10),
  controller.uploadExecutionImages,
);

router.put(
  '/hoardings/:id/execution-status',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  controller.updateExecutionStatus,
);

router.put(
  '/hoardings/:id/execution-type',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin', 'sales']),
  controller.setExecutionType,
);

router.put(
  '/hoardings/:id/mark-fit',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  controller.markFit,
);

router.put(
  '/hoardings/:id/mark-live',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  controller.markLive,
);

router.put(
  '/hoardings/:id/live-date',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin', 'sales']),
  controller.setLiveDate,
);

router.put(
  '/hoardings/:id/mark-removal',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  controller.markRemoval,
);

router.get(
  '/hoardings/:id/pdf',
  authenticate,
  authorize(['supervisor', 'owner', 'manager', 'admin']),
  controller.generateOperationalPdf,
);

export default router;
