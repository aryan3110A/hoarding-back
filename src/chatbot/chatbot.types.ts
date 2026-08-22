export type ChatbotIntent =
  | 'SALES_TOTAL_MONTH'
  | 'SALES_COMPARE_MONTHS'
  | 'SALES_REMAINING_REVENUE'
  | 'SALES_PERSON_PERFORMANCE'
  | 'SALES_TOP_PERFORMER'
  | 'HOARDING_STATUS_COUNT'
  | 'HOARDING_EMPTY_MONTH'
  | 'HOARDING_CITY_BREAKDOWN'
  | 'HOARDING_EXPIRING'
  | 'HOARDING_OCCUPANCY_SNAPSHOT'
  | 'RENT_DUE'
  | 'RENT_OVERDUE'
  | 'RENT_LANDLORD_WISE'
  | 'ENQUIRY_COUNT'
  | 'ENQUIRY_BY_SOURCE'
  | 'ENQUIRY_PENDING_FOLLOWUP'
  | 'ENQUIRY_IN_PROCESS'
  | 'ENQUIRY_INTEREST_BY_LOCATION'
  | 'PROPOSAL_STATS'
  | 'PROPOSAL_NEW_PARTY'
  | 'FOLLOWUP_STATS'
  | 'CLIENT_SUMMARY'
  | 'CLIENT_RENEWALS_DUE'
  | 'CLIENT_TOP_BY_REVENUE'
  | 'CLIENT_ACTIVE_HOARDINGS'
  | 'GENERAL_HELP'
  | 'CLARIFICATION_NEEDED';

export type ChatbotFilters = {
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  daysAhead?: number;
  city?: string;
  area?: string;
  zone?: string;
  landmark?: string;
  hoardingType?: string;
  status?: string;
  salespersonId?: string;
  salespersonName?: string;
  clientId?: string;
  clientName?: string;
  snapshotDate?: string;
  comparePreviousMonth?: boolean;
  hoardingStatus?: 'live' | 'vacant' | 'available' | 'occupied' | 'all';
};

export type NluResult = {
  intent: ChatbotIntent;
  language: 'english' | 'hinglish' | 'gujlish' | 'mixed';
  filters: ChatbotFilters;
  needsClarification: boolean;
  clarificationQuestion?: string;
  clarificationOptions?: string[];
  inheritsContext: string[];
  confidence: number;
};

export type ChatbotAction = {
  type: 'navigate' | 'expand' | 'export';
  label: string;
  href?: string;
  exportType?: 'csv';
  payload?: Record<string, unknown>;
};

export type ChatbotExpandable = {
  id: string;
  title: string;
  rows: Array<Record<string, string | number | null>>;
};

export type ChatbotResponse = {
  summary: string;
  resolvedPeriod?: string;
  dataFreshness: string;
  breakdown: Array<{ label: string; value: string }>;
  details?: string;
  expandable?: ChatbotExpandable[];
  actions: ChatbotAction[];
  intent: ChatbotIntent;
  filters: ChatbotFilters;
  rawData?: unknown;
};

export type ChatbotSessionContext = {
  lastIntent?: ChatbotIntent;
  lastFilters?: ChatbotFilters;
  lastCity?: string;
  lastDateRange?: { startDate: string; endDate: string };
};

export type ChatbotActor = {
  userId: string;
  role: string;
};

export type SuggestionCategory = {
  id: string;
  label: string;
  prompts: Array<{
    label: string;
    intent: ChatbotIntent;
    filters?: ChatbotFilters;
  }>;
};
