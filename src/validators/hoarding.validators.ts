import { z } from 'zod';

export const createHoardingSchema = z.object({
  body: z
    .object({
      code: z.string().optional(),
      title: z.string().optional(),
      city: z.string().optional(),
      area: z.string().optional(),
      landmark: z.string().optional(),
      roadName: z.string().optional(),
      side: z.enum(['LHS', 'RHS']).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      widthCm: z.number().optional(),
      heightCm: z.number().optional(),
      type: z.string().optional(),
      ownership: z.string().optional(),
      landlordId: z.string().uuid(),
      categoryId: z.preprocess(
        (v) => (v === null || v === '' ? undefined : v),
        z.string().uuid().optional(),
      ),
      standardRate: z.number().min(0).optional(),
      minimumRate: z.number().min(0).optional(),
      baseRate: z.number().optional(),
    })
    .refine(
      (data) => {
        const standard =
          typeof data.standardRate === 'number'
            ? data.standardRate
            : typeof data.baseRate === 'number'
              ? data.baseRate
              : undefined;
        const minimum = data.minimumRate;
        if (typeof minimum !== 'number' || typeof standard !== 'number') return true;
        return minimum <= standard;
      },
      {
        message: 'minimumRate cannot be greater than standardRate',
        path: ['minimumRate'],
      },
    ),
});

export const updateHoardingSchema = z.object({
  body: z
    .object({
      title: z.string().optional(),
      city: z.string().optional(),
      area: z.string().optional(),
      landmark: z.string().optional(),
      roadName: z.string().optional(),
      side: z.enum(['LHS', 'RHS']).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      widthCm: z.number().optional(),
      heightCm: z.number().optional(),
      type: z.string().optional(),
      ownership: z.string().optional(),
      landlordId: z.preprocess(
        (v) => (v === null || v === '' ? undefined : v),
        z.string().uuid().optional(),
      ),
      status: z.string().optional(),
      categoryId: z.preprocess(
        (v) => (v === null || v === '' ? undefined : v),
        z.string().uuid().optional(),
      ),
      standardRate: z.number().min(0).optional(),
      minimumRate: z.number().min(0).optional(),
      baseRate: z.number().optional(),
    })
    .refine(
      (data) => {
        const standard =
          typeof data.standardRate === 'number'
            ? data.standardRate
            : typeof data.baseRate === 'number'
              ? data.baseRate
              : undefined;
        const minimum = data.minimumRate;
        if (typeof minimum !== 'number' || typeof standard !== 'number') return true;
        return minimum <= standard;
      },
      {
        message: 'minimumRate cannot be greater than standardRate',
        path: ['minimumRate'],
      },
    ),
});
