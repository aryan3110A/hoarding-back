import { config } from '../config';
import type { ChatbotFilters, ChatbotSessionContext } from './chatbot.types';

const sessions = new Map<string, { context: ChatbotSessionContext; expiresAt: number }>();

const ttlMs = () => config.chatbot.sessionTtlMinutes * 60 * 1000;

export const getSessionContext = (sessionId: string): ChatbotSessionContext => {
  const row = sessions.get(sessionId);
  if (!row || row.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return {};
  }
  return row.context;
};

export const updateSessionContext = (
  sessionId: string,
  patch: Partial<ChatbotSessionContext>,
): ChatbotSessionContext => {
  const existing = getSessionContext(sessionId);
  const context: ChatbotSessionContext = {
    ...existing,
    ...patch,
    lastFilters: patch.lastFilters || existing.lastFilters,
  };
  sessions.set(sessionId, { context, expiresAt: Date.now() + ttlMs() });
  return context;
};

export const mergeFiltersWithContext = (
  sessionId: string,
  filters: ChatbotFilters,
  inherits: string[] = [],
): ChatbotFilters => {
  const ctx = getSessionContext(sessionId);
  const merged: ChatbotFilters = { ...filters };

  if (inherits.includes('dateRange') || inherits.includes('month')) {
    if (!merged.startDate && ctx.lastDateRange?.startDate) {
      merged.startDate = ctx.lastDateRange.startDate;
    }
    if (!merged.endDate && ctx.lastDateRange?.endDate) {
      merged.endDate = ctx.lastDateRange.endDate;
    }
    if (!merged.month && ctx.lastFilters?.month) merged.month = ctx.lastFilters.month;
    if (!merged.year && ctx.lastFilters?.year) merged.year = ctx.lastFilters.year;
  }

  if (inherits.includes('city') && !merged.city && ctx.lastCity) {
    merged.city = ctx.lastCity;
  }

  if (!merged.city && ctx.lastFilters?.city) merged.city = ctx.lastFilters.city;
  if (!merged.salespersonName && ctx.lastFilters?.salespersonName) {
    merged.salespersonName = ctx.lastFilters.salespersonName;
  }
  if (!merged.clientName && ctx.lastFilters?.clientName) {
    merged.clientName = ctx.lastFilters.clientName;
  }

  return merged;
};
