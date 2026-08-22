import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/rbac.middleware';
import { eventBus } from '../lib/eventBus';

const router = Router();

// Server-Sent Events for hoarding status updates, available to sales and admins
router.get(
  '/hoarding-status',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin', 'supervisor']),
  (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const onEvent = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    eventBus.on('hoarding-status', onEvent);

    req.on('close', () => {
      eventBus.off('hoarding-status', onEvent);
      try {
        res.end();
      } catch (_) {}
    });
  },
);

// Server-Sent Events for per-user notifications
router.get(
  '/notifications',
  authenticate,
  authorize(['sales', 'owner', 'manager', 'admin', 'designer', 'supervisor']),
  (req, res) => {
    const userId = String((req as any).user?.id || '');
    if (!userId) {
      res.status(401).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const onEvent = (payload: any) => {
      if (!payload || String(payload.userId || '') !== userId) return;
      res.write(`data: ${JSON.stringify(payload.notification)}\n\n`);
    };
    eventBus.on('notification', onEvent);

    req.on('close', () => {
      eventBus.off('notification', onEvent);
      try {
        res.end();
      } catch (_) {}
    });
  },
);

// Server-Sent Events for design status updates
router.get(
  '/design-status',
  authenticate,
  authorize(['owner', 'manager', 'admin', 'designer']),
  (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const onEvent = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    eventBus.on('design-status', onEvent);

    req.on('close', () => {
      eventBus.off('design-status', onEvent);
      try {
        res.end();
      } catch (_) {}
    });
  },
);

export default router;
