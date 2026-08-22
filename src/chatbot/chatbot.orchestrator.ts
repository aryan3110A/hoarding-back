import { ForbiddenError } from '../lib/errors';
import { parseMessage } from './chatbot.nlu';
import { chatbotDataService } from './chatbot.data.service';
import { chatbotAuditService } from './chatbot.audit.service';
import {
  getSessionContext,
  mergeFiltersWithContext,
  updateSessionContext,
} from './chatbot.context';
import { CHATBOT_SUGGESTIONS } from './chatbot.suggestions';
import type {
  ChatbotActor,
  ChatbotFilters,
  ChatbotIntent,
  ChatbotResponse,
  NluResult,
} from './chatbot.types';
import { resolveDateRange, toIsoDate } from './chatbot.dateUtils';

const OWNER_ROLES = new Set(['owner', 'admin']);

export class ChatbotOrchestrator {
  assertAccess(role: string) {
    const normalized = String(role || '').toLowerCase();
    if (!OWNER_ROLES.has(normalized)) {
      throw new ForbiddenError('Chatbot is currently available to Owner and Admin only.');
    }
  }

  getSuggestions() {
    return CHATBOT_SUGGESTIONS;
  }

  async query(params: {
    message: string;
    sessionId: string;
    actor: ChatbotActor;
    intent?: ChatbotIntent;
    filters?: ChatbotFilters;
  }): Promise<ChatbotResponse> {
    this.assertAccess(params.actor.role);
    const trimmed = params.message.trim();
    let nlu: NluResult;

    if (params.intent) {
      nlu = {
        intent: params.intent,
        language: 'english',
        filters: params.filters || {},
        needsClarification: false,
        inheritsContext: [],
        confidence: 1,
      };
    } else {
      const context = getSessionContext(params.sessionId);
      nlu = await parseMessage(trimmed, context);
    }

    if (nlu.needsClarification && nlu.intent === 'CLARIFICATION_NEEDED') {
      const response: ChatbotResponse = {
        intent: 'CLARIFICATION_NEEDED',
        filters: nlu.filters,
        summary: nlu.clarificationQuestion || 'Please clarify your question.',
        dataFreshness: new Date().toISOString(),
        breakdown: (nlu.clarificationOptions || []).map((opt) => ({
          label: 'Option',
          value: opt,
        })),
        actions: [],
      };
      await chatbotAuditService.log({
        userId: params.actor.userId,
        role: params.actor.role,
        queryText: trimmed,
        detectedLanguage: nlu.language,
        intent: nlu.intent,
        appliedFilters: nlu.filters,
        success: true,
        modulesAccessed: ['chatbot'],
        responseSummary: response.summary,
      });
      return response;
    }

    const mergedFilters = mergeFiltersWithContext(
      params.sessionId,
      nlu.filters,
      nlu.inheritsContext,
    );

    try {
      const response = await chatbotDataService.execute(
        nlu.intent,
        mergedFilters,
        params.actor,
        trimmed,
      );
      const range = resolveDateRange(mergedFilters);
      updateSessionContext(params.sessionId, {
        lastIntent: nlu.intent,
        lastFilters: mergedFilters,
        lastCity: mergedFilters.city,
        lastDateRange: {
          startDate: toIsoDate(range.startDate),
          endDate: toIsoDate(range.endDate),
        },
      });

      await chatbotAuditService.log({
        userId: params.actor.userId,
        role: params.actor.role,
        queryText: trimmed || `[prompt:${nlu.intent}]`,
        detectedLanguage: nlu.language,
        intent: nlu.intent,
        appliedFilters: mergedFilters,
        success: true,
        modulesAccessed: [nlu.intent],
        responseSummary: response.summary,
      });

      return response;
    } catch (error: any) {
      await chatbotAuditService.log({
        userId: params.actor.userId,
        role: params.actor.role,
        queryText: trimmed,
        detectedLanguage: nlu.language,
        intent: nlu.intent,
        appliedFilters: mergedFilters,
        success: false,
        errorCode: error?.message || 'CHATBOT_ERROR',
        modulesAccessed: [nlu.intent],
      });
      return {
        intent: nlu.intent,
        filters: mergedFilters,
        summary: 'The data could not be fetched right now. Please try again.',
        dataFreshness: new Date().toISOString(),
        breakdown: [],
        actions: [],
      };
    }
  }

  async exportCsv(params: {
    intent: ChatbotIntent;
    filters: ChatbotFilters;
    actor: ChatbotActor;
  }) {
    this.assertAccess(params.actor.role);
    const response = await chatbotDataService.execute(params.intent, params.filters, params.actor);
    const rows: string[] = [];
    rows.push('Shubham Assistant Export');
    rows.push(`Intent,${params.intent}`);
    rows.push(`Summary,${response.summary.replace(/,/g, ';')}`);
    rows.push('');
    rows.push('Label,Value');
    for (const item of response.breakdown) {
      rows.push(`${item.label},${item.value}`);
    }
    if (response.expandable?.length) {
      for (const block of response.expandable) {
        rows.push('');
        rows.push(block.title);
        const headers = Object.keys(block.rows[0] || {});
        rows.push(headers.join(','));
        for (const row of block.rows) {
          rows.push(headers.map((h) => String(row[h] ?? '').replace(/,/g, ';')).join(','));
        }
      }
    }
    return rows.join('\n');
  }
}

export const chatbotOrchestrator = new ChatbotOrchestrator();
