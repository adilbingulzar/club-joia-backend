import { z } from "zod";
import { emailSchema } from "./auth";
import { HHMM } from "@/lib/time";
import { PROGRAMME_ICON_KEYS } from "@/domain/programme-icons";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

export const MEMBERSHIP_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"] as const;
export const TICKET_STATUSES = ["ACTIVE", "USED", "REVOKED", "EXPIRED", "SUSPENDED"] as const;
export const EVENT_STATUSES = ["DRAFT", "PUBLISHED", "LIVE", "COMPLETED", "ARCHIVED", "CANCELLED"] as const;
export const PROGRAM_CATEGORIES = ["ARRIVAL", "HOSPITALITY", "RACING", "FOOD", "ENTERTAINMENT", "NETWORKING", "CONCIERGE", "AFTER_PARTY", "OTHER"] as const;
export const PROGRAM_VISIBILITIES = ["DRAFT", "MEMBERS", "RESTRICTED"] as const;
export const ENTRY_POLICIES = ["SINGLE_ENTRY", "DAILY_ENTRY", "MULTI_ENTRY"] as const;
export const NOTIFICATION_TYPES = ["ANNOUNCEMENT", "PROGRAMME", "TICKET", "CONCIERGE", "TRANSPORT", "MEMBERSHIP", "SYSTEM"] as const;
export const TARGET_TYPES = ["ALL_MEMBERS", "TIER", "EVENT", "MEMBER"] as const;
export const STAFF_ROLE_VALUES = ["CONCIERGE", "CHECK_IN_STAFF", "ADMIN", "SUPER_ADMIN"] as const;

export const assignMembershipSchema = z.object({
  memberId: z.string().min(1),
  tierId: z.string().min(1, "Choose a tier."),
  status: z.enum(MEMBERSHIP_STATUSES),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  homeChapterId: z.string().optional(),
});

export const tierSchema = z.object({
  tierId: z.string().min(1),
  displayName: z.string().trim().min(1).max(40),
  description: optionalText(300),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #EF233C."),
  sortOrder: z.coerce.number().int().min(0).max(1000),
  active: z.stringbool().default(false),
});

export const programmeItemSchema = z.object({
  id: z.string().optional(),
  eventId: z.string().min(1),
  date: dateStr,
  startTime: z.string().regex(HHMM, "Use 24-hour HH:MM."),
  endTime: z.string().regex(HHMM, "Use 24-hour HH:MM.").optional().transform((v) => v ?? null),
  title: z.string().trim().min(1, "Title is required.").max(120),
  subtitle: optionalText(160),
  description: optionalText(1000),
  location: optionalText(120),
  category: z.enum(PROGRAM_CATEGORIES),
  icon: z.enum(PROGRAMME_ICON_KEYS).optional().transform((v) => v ?? null),
  visibility: z.enum(PROGRAM_VISIBILITIES),
  requiredEntitlementCode: optionalText(60),
  capacity: z.coerce.number().int().min(1).max(100000).optional().transform((v) => v ?? null),
});

const eventFields = {
  name: z.string().trim().min(1, "Name is required.").max(120),
  venue: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(60),
  country: z.string().trim().min(1).max(60),
  timezone: z.string().trim().min(1).max(60),
  startDate: dateStr,
  endDate: dateStr,
  description: optionalText(2000),
  tagline: optionalText(80),
  ticketPrefix: z.string().trim().regex(/^[A-Za-z0-9]{0,6}$/, "Up to 6 letters or numbers.").optional(),
  supportEmail: optionalText(120),
  supportPhone: optionalText(40),
  dressCode: optionalText(300),
};

export const eventSchema = z.object({ id: z.string().min(1), status: z.enum(EVENT_STATUSES), ...eventFields });

export const eventCreateSchema = z.object({
  ...eventFields,
  slug: z.string().trim().regex(/^[a-z0-9-]{0,60}$/, "Lowercase letters, numbers and dashes.").optional(),
  chapterId: z.string().optional(),
  cloneFromEventId: z.string().optional(),
  cloneProgramme: z.stringbool().default(false),
});

export const zoneSchema = z.object({
  id: z.string().optional(),
  eventId: z.string().min(1),
  code: z.string().trim().regex(/^[A-Za-z0-9_]{2,24}$/, "Letters, numbers and underscores."),
  name: z.string().trim().min(1).max(60),
  description: optionalText(200),
  requiredEntitlementCode: optionalText(60),
  active: z.stringbool().default(false),
});

export const ticketTypeSchema = z.object({
  id: z.string().optional(),
  eventId: z.string().min(1),
  code: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, "2–10 letters or numbers."),
  name: z.string().trim().min(1).max(80),
  description: optionalText(300),
  validFrom: z.string().min(1, "Required."),
  validUntil: z.string().min(1, "Required."),
  entryPolicy: z.enum(ENTRY_POLICIES),
  active: z.stringbool().default(false),
  zoneIds: z.array(z.string()).default([]),
});

export const issueTicketSchema = z.object({
  memberId: z.string().min(1),
  eventId: z.string().min(1, "Choose the event first."),
  ticketTypeId: z.string().min(1, "Choose a ticket type."),
});
export const bulkIssueSchema = z.object({
  eventId: z.string().min(1, "Choose the event first."),
  ticketTypeId: z.string().min(1, "Choose a ticket type."),
  tierId: z.string().optional(),
});
export const revokeSchema = z.object({ ticketId: z.string().min(1), reason: z.string().trim().min(3, "Give a short reason.").max(200) });

export const notificationSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    body: z.string().trim().min(2).max(300),
    type: z.enum(NOTIFICATION_TYPES),
    targetType: z.enum(TARGET_TYPES),
    tierId: z.string().optional(),
    eventId: z.string().optional(),
    memberId: z.string().optional(),
    url: z.string().trim().max(200).optional(),
    channels: z.array(z.enum(["IN_APP", "WEB_PUSH"])).min(1, "Choose at least one channel."),
    scheduledAt: z.string().optional(),
  })
  .transform((v) => ({
    ...v,
    targetId: v.targetType === "TIER" ? v.tierId : v.targetType === "EVENT" ? v.eventId : v.targetType === "MEMBER" ? v.memberId : undefined,
  }));

export const CONCIERGE_CATEGORY_VALUES = ["TRANSPORT", "DINING", "HOTEL", "YACHT", "NIGHTLIFE", "TICKET_SUPPORT", "SPECIAL_REQUEST", "OTHER"] as const;

/** International number in E.164 form, e.g. +971501234567 (spaces/dashes are stripped). */
export const whatsappSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[\s\-().]/g, "") : null))
  .refine((v) => v === null || /^\+[1-9]\d{7,14}$/.test(v), "Use international format, e.g. +971 50 123 4567.");

const staffContactFields = {
  whatsappNumber: whatsappSchema,
  alertByEmail: z.stringbool().default(false),
  alertByWhatsapp: z.stringbool().default(false),
  conciergeCategories: z.array(z.enum(CONCIERGE_CATEGORY_VALUES)).default([]),
};

export const staffSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: emailSchema,
    role: z.enum(STAFF_ROLE_VALUES),
    ...staffContactFields,
  })
  .refine((v) => !v.alertByWhatsapp || v.whatsappNumber, { message: "Add a WhatsApp number to receive WhatsApp alerts.", path: ["whatsappNumber"] });

export const staffContactSchema = z
  .object({ userId: z.string().min(1), name: z.string().trim().min(2).max(80), ...staffContactFields })
  .refine((v) => !v.alertByWhatsapp || v.whatsappNumber, { message: "Add a WhatsApp number to receive WhatsApp alerts.", path: ["whatsappNumber"] });

export const staffConciergeUpdateSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(["NEW", "IN_PROGRESS", "WAITING_FOR_MEMBER", "CONFIRMED", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToId: z.string().optional(),
});

export const settingsSchema = z.object({
  "support.email": z.string().trim().max(120).optional().default(""),
  "support.phone": z.string().trim().max(40).optional().default(""),
  "support.whatsapp": z.string().trim().max(40).optional().default(""),
  "legal.termsUrl": z.string().trim().max(300).optional().default(""),
  "legal.privacyUrl": z.string().trim().max(300).optional().default(""),
});
