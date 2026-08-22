import { prisma } from '../lib/prisma';
import type { ChatbotFilters, ChatbotIntent } from './chatbot.types';

export class ChatbotAuditService {
  async log(params: {
    userId: string;
    role: string;
    queryText: string;
    detectedLanguage?: string;
    intent?: ChatbotIntent;
    appliedFilters?: ChatbotFilters;
    success: boolean;
    errorCode?: string;
    modulesAccessed?: string[];
    responseSummary?: string;
  }) {
    try {
      await prisma.chatbotQueryLog.create({
        data: {
          userId: params.userId,
          role: params.role,
          queryText: params.queryText.slice(0, 2000),
          detectedLanguage: params.detectedLanguage || null,
          intent: params.intent || null,
          appliedFilters: params.appliedFilters as any,
          success: params.success,
          errorCode: params.errorCode || null,
          modulesAccessed: params.modulesAccessed || [],
          responseSummary: params.responseSummary?.slice(0, 500) || null,
        },
      });
    } catch {
      // Audit logging must not break chatbot responses.
    }
  }
}

export const chatbotAuditService = new ChatbotAuditService();
