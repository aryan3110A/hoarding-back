import { z } from 'zod';

export const saveRentSchema = z.object({
    body: z.object({
        partyType: z.enum(['Government', 'Private', 'Friend']),
        rentAmount: z.number().or(z.string().transform(Number)),
        incrementYear: z.number().optional(),
        paymentMode: z.enum(['Yearly', 'Half-Yearly', 'Quarterly', 'Monthly']),
        lastPaymentDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    }),
});
