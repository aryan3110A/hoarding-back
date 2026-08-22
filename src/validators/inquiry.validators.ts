import { z } from 'zod';

const inquirySourceEnum = z.enum([
  'WALK_IN',
  'SELF_GENERATED',
  'VIA_TELEPHONIC',
  'VIA_WHATSAPP',
  'REFERENCE',
  'OTHERS',
]);

const followupStatusEnum = z.enum(['PENDING', 'DONE']);
const inquiryPerformanceStageEnum = z.enum([
  'IN_PROCESS',
  'WON',
  'FOLLOW_UP_LATER',
  'DEAD',
  'NOT_INTERESTED',
]);

const optionalDateInput = z
  .union([z.string(), z.date()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v == null) return undefined;
    const raw = String(v).trim();
    if (!raw) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid date');
    }
    return parsed;
  });

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export const createInquirySchema = z.object({
  body: z
    .object({
      clientName: z.string().min(1, 'Client Name is required'),
      companyName: z
        .string()
        .optional()
        .or(z.literal(''))
        .transform((v) => (v ? v : undefined)),
      phone: z
        .string()
        .min(1, 'Phone is required')
        .regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
      email: z
        .string()
        .email()
        .optional()
        .or(z.literal(''))
        .transform((v) => (v ? v : undefined)),
      city: z.string().min(1, 'City is required'),
      area: z.string().min(1, 'Area is required'),
      location: z.string().min(1, 'Location is required'),
      purpose: z
        .string()
        .optional()
        .or(z.literal(''))
        .transform((v) => (v ? v : undefined)),
      performanceStage: inquiryPerformanceStageEnum.optional(),
      source: inquirySourceEnum,
      assignedSalesId: z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
      firstContactDate: optionalDateInput,
      nextFollowupDate: optionalDateInput,
      followupStatus: followupStatusEnum.optional(),
    })
    .superRefine((val, ctx) => {
      if (val.nextFollowupDate && val.nextFollowupDate < startOfToday()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nextFollowupDate'],
          message: 'Next follow-up date cannot be in the past',
        });
      }
    }),
});

export const updateInquirySchema = z.object({
  body: z
    .object({
      clientName: z.string().min(1).optional(),
      companyName: z.string().nullable().optional(),
      phone: z
        .string()
        .min(1)
        .regex(/^\d{10}$/, 'Phone must be exactly 10 digits')
        .optional(),
      email: z.string().email().nullable().optional(),
      city: z.string().min(1).optional(),
      area: z.string().min(1).optional(),
      location: z.string().min(1).optional(),
      purpose: z.string().nullable().optional(),
      status: z.enum(['OPEN', 'LOCKED', 'CLOSED']).optional(),
      performanceStage: inquiryPerformanceStageEnum.optional(),
      source: inquirySourceEnum.optional(),
      assignedSalesId: z.string().uuid().nullable().optional(),
      categoryId: z.string().uuid().nullable().optional(),
      firstContactDate: optionalDateInput,
      nextFollowupDate: optionalDateInput,
      followupStatus: followupStatusEnum.optional(),
    })
    .superRefine((val, ctx) => {
      if (val.nextFollowupDate && val.nextFollowupDate < startOfToday()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nextFollowupDate'],
          message: 'Next follow-up date cannot be in the past',
        });
      }
    })
    .refine((val) => Object.keys(val).length > 0, {
      message: 'At least one field is required',
    }),
});
