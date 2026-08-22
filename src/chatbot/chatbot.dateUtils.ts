import type { ChatbotFilters } from './chatbot.types';

const pad = (n: number) => String(n).padStart(2, '0');

export const formatInr = (value: number) =>
  `₹${Math.round(value).toLocaleString('en-IN')}`;

export const formatDate = (value: Date | string | null | undefined) => {
  if (!value) return 'N/A';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const formatPeriod = (start: Date, end: Date) =>
  `${formatDate(start)} to ${formatDate(end)}`;

export const startOfDay = (value: Date) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (value: Date) => {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

export const startOfMonth = (year: number, month: number) =>
  new Date(year, month - 1, 1, 0, 0, 0, 0);

export const endOfMonth = (year: number, month: number) =>
  new Date(year, month, 0, 23, 59, 59, 999);

export const resolveDateRange = (filters: ChatbotFilters, now = new Date()) => {
  if (filters.startDate && filters.endDate) {
    return {
      startDate: startOfDay(new Date(filters.startDate)),
      endDate: endOfDay(new Date(filters.endDate)),
    };
  }

  if (filters.month && filters.year) {
    return {
      startDate: startOfMonth(filters.year, filters.month),
      endDate: endOfMonth(filters.year, filters.month),
    };
  }

  if (filters.daysAhead) {
    const start = startOfDay(now);
    const end = endOfDay(new Date(now.getTime() + filters.daysAhead * 86400000));
    return { startDate: start, endDate: end };
  }

  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return {
    startDate: startOfMonth(y, m),
    endDate: endOfMonth(y, m),
  };
};

export const resolvePreviousMonthRange = (filters: ChatbotFilters, now = new Date()) => {
  const current = resolveDateRange(filters, now);
  const prev = new Date(current.startDate);
  prev.setMonth(prev.getMonth() - 1);
  return {
    startDate: startOfMonth(prev.getFullYear(), prev.getMonth() + 1),
    endDate: endOfMonth(prev.getFullYear(), prev.getMonth() + 1),
  };
};

export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

export const dataFreshnessLabel = () => {
  const now = new Date();
  return `Data updated as of ${formatDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
};
