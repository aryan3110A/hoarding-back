import OpenAI from 'openai';
import { config } from '../config';
import type { ChatbotFilters, ChatbotIntent, ChatbotSessionContext, NluResult } from './chatbot.types';
import { parseWithRules } from './chatbot.nlu.rules';
import { extractSalespersonFromMessage } from './chatbot.resolveUser';

const INTENTS: ChatbotIntent[] = [
  'SALES_TOTAL_MONTH',
  'SALES_COMPARE_MONTHS',
  'SALES_REMAINING_REVENUE',
  'SALES_PERSON_PERFORMANCE',
  'SALES_TOP_PERFORMER',
  'HOARDING_STATUS_COUNT',
  'HOARDING_EMPTY_MONTH',
  'HOARDING_CITY_BREAKDOWN',
  'HOARDING_EXPIRING',
  'HOARDING_OCCUPANCY_SNAPSHOT',
  'RENT_DUE',
  'RENT_OVERDUE',
  'RENT_LANDLORD_WISE',
  'ENQUIRY_COUNT',
  'ENQUIRY_BY_SOURCE',
  'ENQUIRY_PENDING_FOLLOWUP',
  'ENQUIRY_IN_PROCESS',
  'ENQUIRY_INTEREST_BY_LOCATION',
  'PROPOSAL_STATS',
  'PROPOSAL_NEW_PARTY',
  'FOLLOWUP_STATS',
  'CLIENT_SUMMARY',
  'CLIENT_RENEWALS_DUE',
  'CLIENT_TOP_BY_REVENUE',
  'CLIENT_ACTIVE_HOARDINGS',
  'GENERAL_HELP',
  'CLARIFICATION_NEEDED',
];

const buildSystemPrompt = (context: ChatbotSessionContext) => `You are an NLU parser for Shubham Advertise hoarding management software.
Return ONLY valid JSON. Never answer business questions directly.
Detect intent and extract filters from English, Hinglish, or Gujlish (Roman script).
Understand typos: hordings=hoardings, ketla/ketli/ketlu=how many, khali=empty/vacant, aavta/agla=upcoming, bharvanu/dena=rent due.

Valid intents: ${INTENTS.join(', ')}

Session context (may apply to follow-ups): ${JSON.stringify(context)}

JSON schema:
{
  "intent": "INTENT_NAME",
  "language": "english|hinglish|gujlish|mixed",
  "filters": {
    "startDate": "YYYY-MM-DD|null",
    "endDate": "YYYY-MM-DD|null",
    "month": number|null,
    "year": number|null,
    "daysAhead": number|null,
    "city": string|null,
    "area": string|null,
    "zone": string|null,
    "landmark": string|null,
    "hoardingType": string|null,
    "salespersonName": string|null,
    "clientName": string|null,
    "snapshotDate": "YYYY-MM-DD|null",
    "comparePreviousMonth": boolean|null,
    "hoardingStatus": "live|vacant|available|occupied|all|null"
  },
  "needsClarification": boolean,
  "clarificationQuestion": string|null,
  "clarificationOptions": string[]|null,
  "inheritsContext": string[],
  "confidence": number
}

For follow-ups like "salesperson-wise batao" after a month query, set inheritsContext=["dateRange","month"] and keep prior month filters.
When the user says "sales user" they usually mean the salesperson named "Sales User", not a generic role label.
If only a month name is given without a 4-digit year (e.g. "for May"), use the current calendar year — never invent 2023 or other past years.
If genuinely ambiguous, use CLARIFICATION_NEEDED.`;

export const parseWithOpenAI = async (
  message: string,
  context: ChatbotSessionContext,
): Promise<NluResult | null> => {
  const apiKey = config.chatbot.openaiApiKey;
  if (!apiKey) return null;

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: config.chatbot.nluModel,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(context) },
        { role: 'user', content: message },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NluResult;
    if (!INTENTS.includes(parsed.intent)) return null;

    const cleanFilters = Object.fromEntries(
      Object.entries(parsed.filters || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    );

    return {
      intent: parsed.intent,
      language: parsed.language || 'english',
      filters: cleanFilters,
      needsClarification: Boolean(parsed.needsClarification),
      clarificationQuestion: parsed.clarificationQuestion || undefined,
      clarificationOptions: parsed.clarificationOptions || undefined,
      inheritsContext: Array.isArray(parsed.inheritsContext) ? parsed.inheritsContext : [],
      confidence: Number(parsed.confidence) || 0.8,
    };
  } catch {
    return null;
  }
};

const sanitizeYearFilter = (message: string, filters: ChatbotFilters): ChatbotFilters => {
  if (/\b20\d{2}\b/.test(message)) return filters;
  if (filters.month && !filters.startDate) {
    return { ...filters, year: new Date().getFullYear() };
  }
  return filters;
};

const mergeRuleEntities = (message: string, ai: NluResult, rules: NluResult | null): NluResult => {
  let filters = sanitizeYearFilter(message, ai.filters);

  const salesperson = extractSalespersonFromMessage(message) || rules?.filters.salespersonName;
  if (salesperson) {
    filters = { ...filters, salespersonName: salesperson };
  }

  if (rules?.filters.month) {
    filters = {
      ...filters,
      month: rules.filters.month,
      year: rules.filters.year || new Date().getFullYear(),
    };
  }

  const intent =
    rules?.intent === 'SALES_PERSON_PERFORMANCE' && salesperson
      ? 'SALES_PERSON_PERFORMANCE'
      : ai.intent;

  return { ...ai, intent, filters };
};

export const parseMessage = async (
  message: string,
  context: ChatbotSessionContext,
): Promise<NluResult> => {
  const rules = parseWithRules(message);
  if (rules && rules.confidence >= 0.85) {
    return { ...rules, filters: sanitizeYearFilter(message, rules.filters) };
  }

  const ai = await parseWithOpenAI(message, context);
  if (ai) return mergeRuleEntities(message, ai, rules);
  if (rules) return { ...rules, filters: sanitizeYearFilter(message, rules.filters) };

  return {
    intent: 'CLARIFICATION_NEEDED',
    language: 'english',
    filters: {},
    needsClarification: true,
    clarificationQuestion:
      'I could not fully understand that. Please try rephrasing, pick a suggested prompt, or specify city/month/salesperson.',
    clarificationOptions: [
      'Total sales this month',
      'Rent due in next 7 days',
      'How many hoardings are live?',
      'Pending follow-ups today',
    ],
    inheritsContext: [],
    confidence: 0.3,
  };
};
