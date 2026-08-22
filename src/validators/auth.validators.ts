import { z } from 'zod';

export const loginSchema = z.object({
  body: z
    .object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      password: z.string().min(1), // Allow shorter passwords for demo/testing
      deviceId: z.string(),
      deviceName: z.string().optional(),
      platform: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    })
    .refine((data) => data.email || data.phone, {
      message: 'Either email or phone must be provided',
      path: ['email'],
    }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string(),
  }),
});

export const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
  }),
});
