import { z } from 'zod';

const emptyToUndefined = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
};

export const createLandlordSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Landlord name is required'),
    phone: z.preprocess(emptyToUndefined, z.string().trim().min(6).max(20).optional()),
    email: z.preprocess(emptyToUndefined, z.string().trim().email().optional()),
    address: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  }),
});
