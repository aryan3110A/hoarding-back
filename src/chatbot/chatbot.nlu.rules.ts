import type { ChatbotIntent, ChatbotFilters, NluResult } from './chatbot.types';
import { extractSalespersonFromMessage } from './chatbot.resolveUser';

const monthNames: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const detectLanguage = (text: string): NluResult['language'] => {
  const lower = text.toLowerCase();
  const guj =
    /\b(che|ma|ketla|ketli|ketlu|aavta|divas|thase|thai|moklya|bharvanu|nava|kayo|kaya)\b/.test(
      lower,
    );
  const hin =
    /\b(mein|kitni|kitna|kitne|hai|hain|batao|dena|khali|agle|is month|pachla|kiya|hue|wale)\b/.test(
      lower,
    );
  if (guj && hin) return 'mixed';
  if (guj) return 'gujlish';
  if (hin) return 'hinglish';
  return 'english';
};

const extractMonthYear = (text: string, now = new Date()) => {
  const lower = text.toLowerCase();
  let month: number | undefined;
  let year: number | undefined;

  for (const [name, num] of Object.entries(monthNames)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) {
      month = num;
      break;
    }
  }

  const yearMatch = lower.match(/\b(20\d{2})\b/);
  if (yearMatch) year = Number(yearMatch[1]);

  if (!month && /\b(this month|is month|aa month|current month)\b/.test(lower)) {
    month = now.getMonth() + 1;
    year = now.getFullYear();
  }
  if (!month && /\b(last month|pachla month|previous month)\b/.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    month = d.getMonth() + 1;
    year = d.getFullYear();
  }

  if (month && !year) year = now.getFullYear();
  return { month, year };
};

const extractDaysAhead = (text: string) => {
  const lower = text.toLowerCase();
  const m =
    lower.match(/\b(?:next|agle|aavta)\s+(\d+)\s+(?:days?|din|divas)\b/) ||
    lower.match(/\b(\d+)\s+(?:days?|din|divas)\b/);
  if (m) return Number(m[1]);
  if (/\bnext week\b/.test(lower)) return 7;
  if (/\btoday\b|\baaj\b/.test(lower)) return 0;
  if (/\btomorrow\b|\bkal\b/.test(lower)) return 1;
  return undefined;
};

const extractCity = (text: string) => {
  const m = text.match(
    /\b(?:in|at|ma|mein|me)\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s+(?:zone|area|highway|ma|mein|city)|[?.!,]|$)/i,
  );
  return m?.[1]?.trim();
};

const extractSalesperson = (text: string) => extractSalespersonFromMessage(text);

const extractClient = (text: string) => {
  const m = text.match(/\bclient\s+([A-Za-z0-9][A-Za-z0-9\s.&-]{1,40})/i);
  return m?.[1]?.trim();
};

export const parseWithRules = (message: string): NluResult | null => {
  const text = message.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const language = detectLanguage(text);
  const { month, year } = extractMonthYear(text);
  const daysAhead = extractDaysAhead(text);
  const city = extractCity(text);
  const salespersonName = extractSalesperson(text);
  const clientName = extractClient(text);
  const filters: ChatbotFilters = { month, year, daysAhead, city, salespersonName, clientName };

  const base = (intent: ChatbotIntent, extra: Partial<NluResult> = {}): NluResult => ({
    intent,
    language,
    filters: { ...filters, ...(extra.filters || {}) },
    needsClarification: false,
    inheritsContext: extra.inheritsContext || [],
    confidence: extra.confidence ?? 0.72,
    ...extra,
  });

  if (/\b(help|what can you|kya kar sakte)\b/.test(lower)) {
    return base('GENERAL_HELP', { confidence: 0.95 });
  }

  if (
    /\b(remaining|scheduled|future)\s+(revenue|business)\b/.test(lower) ||
    /\b(baki|remaining)\b.*\b(revenue|business)\b/.test(lower)
  ) {
    return base('SALES_REMAINING_REVENUE');
  }

  if (
    /\b(compare|vs|versus)\b/.test(lower) &&
    /\b(sale|sales|revenue|business)\b/.test(lower)
  ) {
    return base('SALES_COMPARE_MONTHS', { filters: { ...filters, comparePreviousMonth: true } });
  }

  if (
    /\b(total sale|total sales|recognised revenue|recognized revenue|business)\b/.test(lower) ||
    /\b(sale kitni|sale ketli|total sale)\b/.test(lower)
  ) {
    return base('SALES_TOTAL_MONTH');
  }

  if (
    /\b(who generated|most business|top salesperson|sabse zyada|sauthi vadhu)\b/.test(lower)
  ) {
    return base('SALES_TOP_PERFORMER');
  }

  if (salespersonName && /\b(performance|report|enquiries|proposals)\b/.test(lower)) {
    return base('SALES_PERSON_PERFORMANCE', { confidence: 0.92 });
  }

  if (
    /\b(empty throughout|vacant throughout|remained empty|poora month khali)\b/.test(lower) ||
    /\b(empty|vacant|khali)\b.*\b(month|throughout)\b/.test(lower)
  ) {
    return base('HOARDING_EMPTY_MONTH', { filters: { ...filters, hoardingStatus: 'vacant' } });
  }

  if (/\b(expir|renewal due|renewals due)\b/.test(lower)) {
    return base('HOARDING_EXPIRING', {
      filters: { ...filters, daysAhead: daysAhead || 10 },
    });
  }

  if (
    /\b(occupied|available|occupancy|live|vacant)\b/.test(lower) &&
    (city || /\bon\s+\d/.test(lower) || /\bzone\b/.test(lower))
  ) {
    return base('HOARDING_OCCUPANCY_SNAPSHOT', { filters });
  }

  if (/\b(city.?wise|city wise)\b/.test(lower) && /\b(hoarding|occup|available|vacant)\b/.test(lower)) {
    return base('HOARDING_CITY_BREAKDOWN');
  }

  if (/\b(live|vacant|available|empty|khali)\b/.test(lower) && /\b(hoarding|hording)\b/.test(lower)) {
    let hoardingStatus: ChatbotFilters['hoardingStatus'] = 'all';
    if (/\blive\b/.test(lower)) hoardingStatus = 'live';
    else if (/\b(available|vacant|empty|khali)\b/.test(lower)) hoardingStatus = 'available';
    return base('HOARDING_STATUS_COUNT', { filters: { ...filters, hoardingStatus } });
  }

  if (/\b(overdue rent)\b/.test(lower)) return base('RENT_OVERDUE');
  if (/\b(rent due|rent pay|bharvanu|dena hai)\b/.test(lower)) {
    return base('RENT_DUE', { filters: { ...filters, daysAhead: daysAhead || 7 } });
  }
  if (/\b(landlord).*\b(rent)\b/.test(lower)) return base('RENT_LANDLORD_WISE');

  if (/\b(source.?wise|by source)\b/.test(lower) && /\b(enquir)/.test(lower)) {
    return base('ENQUIRY_BY_SOURCE');
  }
  if (/\b(follow.?up|followup|reminder)\b/.test(lower) && /\b(pending|overdue|today)\b/.test(lower)) {
    return base('ENQUIRY_PENDING_FOLLOWUP');
  }
  if (/\b(follow.?up|followup)\b/.test(lower)) return base('FOLLOWUP_STATS');
  if (/\b(in process|still open)\b/.test(lower) && /\b(enquir)/.test(lower)) {
    return base('ENQUIRY_IN_PROCESS');
  }
  if (/\b(interest|interested)\b/.test(lower) && (city || /\bhoarding\b/.test(lower))) {
    return base('ENQUIRY_INTEREST_BY_LOCATION', { filters });
  }
  if (/\b(enquir)/.test(lower)) return base('ENQUIRY_COUNT');

  if (/\b(new.?party|nava party|new party)\b/.test(lower) && /\b(proposal)/.test(lower)) {
    return base('PROPOSAL_NEW_PARTY');
  }
  if (/\b(proposal)/.test(lower)) return base('PROPOSAL_STATS');

  if (/\b(renewal|renew)\b/.test(lower) && /\b(client|pending)\b/.test(lower)) {
    return base('CLIENT_RENEWALS_DUE');
  }
  if (/\b(top client|most hoardings|booking history)\b/.test(lower)) {
    if (/\bhistory\b/.test(lower)) return base('CLIENT_SUMMARY');
    if (/\bmost hoardings\b/.test(lower)) return base('CLIENT_ACTIVE_HOARDINGS');
    return base('CLIENT_TOP_BY_REVENUE');
  }
  if (clientName) return base('CLIENT_SUMMARY');

  if (/\b(salesperson.?wise|team.?wise|breakdown)\b/.test(lower)) {
    return base('SALES_TOP_PERFORMER', {
      inheritsContext: ['dateRange', 'month'],
      confidence: 0.65,
    });
  }

  return null;
};
