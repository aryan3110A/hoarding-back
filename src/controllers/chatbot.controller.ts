import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { chatbotOrchestrator } from '../chatbot/chatbot.orchestrator';
import type { ChatbotFilters, ChatbotIntent } from '../chatbot/chatbot.types';

export class ChatbotController {
  async getSuggestions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      chatbotOrchestrator.assertAccess(req.user?.role?.name || '');
      res.status(200).json(ApiResponse.success(chatbotOrchestrator.getSuggestions()));
    } catch (error) {
      next(error);
    }
  }

  async query(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const message = String(req.body?.message || '');
      const sessionId = String(req.body?.sessionId || 'default');
      const intent = req.body?.intent as ChatbotIntent | undefined;
      const filters = (req.body?.filters || {}) as ChatbotFilters;

      const response = await chatbotOrchestrator.query({
        message,
        sessionId,
        intent,
        filters,
        actor: {
          userId: req.user?.id || '',
          role: req.user?.role?.name || '',
        },
      });

      res.status(200).json(ApiResponse.success(response));
    } catch (error) {
      next(error);
    }
  }

  async exportCsv(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const intent = req.body?.intent as ChatbotIntent;
      const filters = (req.body?.filters || {}) as ChatbotFilters;
      const csv = await chatbotOrchestrator.exportCsv({
        intent,
        filters,
        actor: {
          userId: req.user?.id || '',
          role: req.user?.role?.name || '',
        },
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="shubham-assistant-export.csv"');
      res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  }
}
