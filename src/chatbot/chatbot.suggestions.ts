import type { SuggestionCategory } from './chatbot.types';

export const CHATBOT_SUGGESTIONS: SuggestionCategory[] = [
  {
    id: 'sales',
    label: 'Sales',
    prompts: [
      { label: 'Total sales this month', intent: 'SALES_TOTAL_MONTH' },
      {
        label: "Compare this month's sales with last month",
        intent: 'SALES_COMPARE_MONTHS',
        filters: { comparePreviousMonth: true },
      },
      { label: 'New sales versus renewals this month', intent: 'SALES_TOTAL_MONTH' },
      { label: 'Show salesperson performance this month', intent: 'SALES_TOP_PERFORMER' },
      { label: 'Who generated the most business this month?', intent: 'SALES_TOP_PERFORMER' },
      { label: 'How much remaining revenue is scheduled?', intent: 'SALES_REMAINING_REVENUE' },
    ],
  },
  {
    id: 'hoardings',
    label: 'Hoardings',
    prompts: [
      {
        label: 'How many hoardings are currently live?',
        intent: 'HOARDING_STATUS_COUNT',
        filters: { hoardingStatus: 'live' },
      },
      {
        label: 'How many hoardings are currently vacant?',
        intent: 'HOARDING_STATUS_COUNT',
        filters: { hoardingStatus: 'available' },
      },
      {
        label: 'Which hoardings will become available in the next 15 days?',
        intent: 'HOARDING_EXPIRING',
        filters: { daysAhead: 15 },
      },
      {
        label: 'Show hoardings expiring in the next 10 days',
        intent: 'HOARDING_EXPIRING',
        filters: { daysAhead: 10 },
      },
      {
        label: 'Which hoardings remained empty throughout this month?',
        intent: 'HOARDING_EMPTY_MONTH',
      },
      { label: 'Show occupied and available hoardings city-wise', intent: 'HOARDING_CITY_BREAKDOWN' },
    ],
  },
  {
    id: 'rent',
    label: 'Rent',
    prompts: [
      { label: 'How much rent is due in the next 7 days?', intent: 'RENT_DUE', filters: { daysAhead: 7 } },
      { label: 'How much rent is due in the next 30 days?', intent: 'RENT_DUE', filters: { daysAhead: 30 } },
      { label: 'Show landlord-wise upcoming rent', intent: 'RENT_LANDLORD_WISE', filters: { daysAhead: 30 } },
      {
        label: 'Which hoardings are contributing to upcoming rent?',
        intent: 'RENT_LANDLORD_WISE',
        filters: { daysAhead: 30 },
      },
      { label: 'Show overdue rent payments', intent: 'RENT_OVERDUE' },
    ],
  },
  {
    id: 'enquiries',
    label: 'Enquiries',
    prompts: [
      { label: 'How many enquiries were generated this month?', intent: 'ENQUIRY_COUNT' },
      { label: 'Show enquiries source-wise', intent: 'ENQUIRY_BY_SOURCE' },
      { label: 'How many proposals were sent this month?', intent: 'PROPOSAL_STATS' },
      { label: 'Show new-party proposals salesperson-wise', intent: 'PROPOSAL_NEW_PARTY' },
      { label: 'Which enquiries are still in process?', intent: 'ENQUIRY_IN_PROCESS' },
      { label: 'Which enquiries have pending follow-ups?', intent: 'ENQUIRY_PENDING_FOLLOWUP' },
    ],
  },
  {
    id: 'clients',
    label: 'Clients',
    prompts: [
      { label: 'Which clients have renewals due this month?', intent: 'CLIENT_RENEWALS_DUE' },
      { label: 'Show client-wise active hoardings', intent: 'CLIENT_ACTIVE_HOARDINGS' },
      { label: 'Which client has booked the most hoardings?', intent: 'CLIENT_TOP_BY_REVENUE' },
      { label: 'Top clients by revenue', intent: 'CLIENT_TOP_BY_REVENUE' },
    ],
  },
];
