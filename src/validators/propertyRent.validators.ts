import { z } from 'zod';

const manualIncrementSchema = z.object({
  year: z.number().int().min(2).max(5),
  type: z.enum(['PERCENTAGE', 'AMOUNT']),
  value: z.number().or(z.string().transform(Number)),
});

export const savePropertyRentSchema = z.object({
  body: z.object({
    propertyGroupId: z.string().min(1).optional(),
    landlordName: z.string().min(1),
    location: z.string().optional(),
    rentAmount: z.number().or(z.string().transform(Number)),
    incrementCycleYears: z.number().int().min(1).max(5).optional(),
    incrementType: z.enum(['PERCENTAGE', 'AMOUNT']).optional(),
    incrementValue: z.number().or(z.string().transform(Number)).optional(),
    incrementMode: z.enum(['AUTO', 'MANUAL']).optional(),
    manualIncrements: z.array(manualIncrementSchema).max(4).optional(),
    rentStartDate: z.string().optional(),
    paymentFrequency: z.enum(['Monthly', 'Quarterly', 'HalfYearly', 'Yearly']),
    lastPaymentDate: z.string().optional(),
    reminderDays: z.array(z.number().int().positive()).max(3).optional(),
  }),
});
