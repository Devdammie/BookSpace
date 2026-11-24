import { z } from 'zod';

export const ROLES = ['member', 'approver', 'admin'] as const;
export const USER_TYPES = ['student', 'lecturer', 'staff'] as const;
export const RESOURCE_KINDS = ['room', 'equipment'] as const;
export const RESOURCE_STATUSES = ['active', 'maintenance', 'retired'] as const;

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(200)
  .transform((value) => value.toLowerCase());

const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM');

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  departmentSlug: slugSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1).max(200).optional(),
  })
  .refine((value) => value.confirmPassword === undefined || value.confirmPassword === value.newPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  });

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: slugSchema,
  timezone: z.string().min(1).max(100).default('America/Los_Angeles'),
  adminFullName: z.string().trim().min(2).max(200),
  adminEmail: emailSchema,
  adminPassword: passwordSchema,
});


export const createUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(200),
  userType: z.enum(USER_TYPES),
  roles: z.array(z.enum(ROLES)).min(1).default(['member']),
  temporaryPassword: passwordSchema.optional(),
});

export const updateMeSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
});

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(200).optional(),
    userType: z.enum(USER_TYPES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide a field to update' });

export const setRolesSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1),
});

export const createResourceSchema = z.object({
  kind: z.enum(RESOURCE_KINDS),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(''),
  location: z.string().trim().min(1).max(200),
  capacity: z.number().int().positive().max(10000),
  approvalRequired: z.boolean().default(false),
  minMinutes: z.number().int().positive().max(24 * 60).default(30),
  maxMinutes: z.number().int().positive().max(24 * 60).default(240),
  maxAdvanceDays: z.number().int().min(0).max(365).default(30),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  assetTag: z.string().trim().max(100).nullable().optional(),
  serialNo: z.string().trim().max(100).nullable().optional(),
  parentResourceId: z.string().uuid().nullable().optional(),
  allowedUserTypes: z.array(z.enum(USER_TYPES)).default([]),
});

export const updateResourceSchema = createResourceSchema.partial().extend({
  status: z.enum(RESOURCE_STATUSES).optional(),
});

export const hoursSchema = z.object({
  hours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        openTime: timeSchema,
        closeTime: timeSchema,
      }),
    )
    .max(21),
});

export const blockSchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  reason: z.string().trim().min(3).max(500),
});

export const approversSchema = z.object({
  userIds: z.array(z.string().uuid()).max(20),
});

export const createBookingSchema = z
  .object({
    resourceId: z.string().uuid(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    purpose: z.string().trim().min(3).max(500),
  })
  .refine((value) => new Date(value.endTime) > new Date(value.startTime), {
    message: 'End time must be after the start time',
    path: ['endTime'],
  });

export const updateBookingSchema = z
  .object({
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    purpose: z.string().trim().min(3).max(500),
    version: z.number().int().positive(),
  })
  .refine((value) => new Date(value.endTime) > new Date(value.startTime), {
    message: 'End time must be after the start time',
    path: ['endTime'],
  });

export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const approveBookingSchema = z.object({
  version: z.number().int().positive(),
});

export const rejectBookingSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export const rescheduleBookingSchema = z
  .object({
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    version: z.number().int().positive(),
  })
  .refine((value) => new Date(value.endTime) > new Date(value.startTime), {
    message: 'End time must be after the start time',
    path: ['endTime'],
  });

export const settingsSchema = z.object({
  timezone: z.string().min(1).max(100),
  pendingExpiryHours: z.number().int().min(1).max(168),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
