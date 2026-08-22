import { prisma } from '../lib/prisma';

const SALES_ROLES = ['sales', 'sales_head', 'manager'];

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const STOP_WORDS = new Set([
  'for',
  'in',
  'the',
  'a',
  'an',
  'of',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'january',
  'february',
  'march',
  'april',
  'performance',
  'report',
  'month',
  'this',
  'last',
]);

export const extractSalespersonFromMessage = (message: string): string | undefined => {
  const text = message.trim();
  if (!text) return undefined;
  const lower = normalize(text);

  if (/\bsales\s+user\b/.test(lower)) {
    return 'sales user';
  }

  const patterns = [
    /\b([\w][\w\s.'-]{0,50}?)\s+performance\b/i,
    /\bperformance\s+(?:for|of)\s+([\w][\w\s.'-]{1,50}?)(?:\s+for|\s+in|\?|$|,)/i,
    /\b([\w][\w\s.'-]{1,50}?)(?:'s)?\s+(?:performance|report)\b/i,
    /\b(?:show|batao)\s+([\w][\w\s.'-]{1,50}?)(?:'s)?\s+(?:performance|report)\b/i,
    /\b([\w][\w\s.'-]{1,50}?)\s+(?:ne|e)\s+(?:aa\s+)?month\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    const normalized = normalize(candidate);
    if (normalized.length < 2) continue;
    if (STOP_WORDS.has(normalized)) continue;
    if (/^(sales|user|salesperson|person)$/i.test(normalized)) continue;
    return candidate;
  }

  return undefined;
};

const scoreNameMatch = (query: string, userName: string) => {
  const q = normalize(query);
  const n = normalize(userName);
  if (!q || !n) return 0;

  let score = 0;
  if (n === q) score += 200;
  if (n.startsWith(q)) score += 80;
  if (n.includes(q)) score += 40;

  const qWords = q.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const nWords = n.split(' ');

  if (qWords.length > 0) {
    const matchedWords = qWords.filter((w) => nWords.some((nw) => nw === w || nw.startsWith(w)));
    score += matchedWords.length * 25;
    if (matchedWords.length === qWords.length && qWords.length === nWords.length) score += 50;
  }

  if (q === 'sales user' && n === 'sales user') score += 500;

  return score;
};

type SalesUserRow = { id: string; name: string };

export const resolveSalesUser = async (name?: string): Promise<SalesUserRow[]> => {
  if (!name?.trim()) return [];

  const query = name.trim();
  const allSales = await prisma.user.findMany({
    where: {
      role: { name: { in: SALES_ROLES } },
      isActive: true,
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const scored = allSales
    .map((user: SalesUserRow) => ({ user, score: scoreNameMatch(query, user.name) }))
    .filter((row: { user: SalesUserRow; score: number }) => row.score > 0)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

  if (scored.length > 0) {
    return scored.map((row: { user: SalesUserRow }) => row.user);
  }

  const fallback = await prisma.user.findMany({
    where: {
      name: { contains: query, mode: 'insensitive' },
      role: { name: { in: SALES_ROLES } },
      isActive: true,
    },
    select: { id: true, name: true },
    take: 10,
    orderBy: { name: 'asc' },
  });

  return fallback;
};

export const pickBestSalesUser = (
  users: SalesUserRow[],
  query: string,
): SalesUserRow | null => {
  if (!users.length) return null;
  if (users.length === 1) return users[0];

  const scored = users
    .map((user) => ({ user, score: scoreNameMatch(query, user.name) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best) return null;

  if (!second || best.score - second.score >= 15) {
    return best.user;
  }

  return null;
};
