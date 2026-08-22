import { Router } from 'express';
import { DashboardController } from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';

const router = Router();
const dashboardController = new DashboardController();

router.use(authenticate);

// Owner full dashboard (restrict to owner/admin only per spec)
router.get('/owner', authorize(['admin', 'owner']), dashboardController.getOwnerDashboard);

// Manager dashboard (summary + due list)
router.get(
  '/manager',
  authorize(['admin', 'owner', 'manager']),
  dashboardController.getManagerDashboard,
);

// Sales basic dashboard
router.get(
  '/sales',
  authorize(['admin', 'owner', 'manager', 'sales', 'sales_head', 'sales head']),
  dashboardController.getSalesDashboard,
);

router.get(
  '/sales-performance',
  authorize(['admin', 'owner', 'manager', 'sales', 'sales_head', 'sales head']),
  dashboardController.getSalesPerformance,
);

router.get(
  '/sales-performance/clients',
  authorize(['admin', 'owner', 'manager', 'sales', 'sales_head', 'sales head']),
  dashboardController.getSalesPerformanceClients,
);

router.get(
  '/sales-performance/market-visits',
  authorize(['admin', 'owner', 'manager', 'sales', 'sales_head', 'sales head']),
  dashboardController.getSalesMarketVisits,
);

router.post(
  '/sales-performance/market-visits',
  authorize(['admin', 'owner', 'manager', 'sales', 'sales_head', 'sales head']),
  dashboardController.saveSalesMarketVisit,
);

// Designer minimal dashboard
router.get(
  '/designer',
  authorize(['admin', 'owner', 'manager', 'designer']),
  dashboardController.getDesignerDashboard,
);

// Fitter installation dashboard
router.get('/fitter', authorize(['fitter']), dashboardController.getFitterDashboard);

// Expiring contracts for dashboard (owner/manager/admin)
router.get(
  '/expiring-contracts',
  authorize(['admin', 'owner', 'manager']),
  dashboardController.getExpiringContracts,
);

export default router;
