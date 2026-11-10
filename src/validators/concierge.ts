import { z } from "zod";
import { HHMM } from "@/lib/time";

export const CONCIERGE_CATEGORIES = ["TRANSPORT", "DINING", "HOTEL", "YACHT", "NIGHTLIFE", "TICKET_SUPPORT", "SPECIAL_REQUEST", "OTHER"] as const;
export const CONCIERGE_STATUSES = ["NEW", "IN_PROGRESS", "WAITING_FOR_MEMBER", "CONFIRMED", "COMPLETED", "CANCELLED"] as const;
export const CONCIERGE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const newConciergeSchema = z.object({
  category: z.enum(CONCIERGE_CATEGORIES, { message: "Choose a category." }),
  subject: z.string().trim().min(3, "Add a short subject.").max(120),
  description: z.string().trim().min(5, "Tell us a little more.").max(3000),
  preferredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
    .optional(),
  preferredTime: z.string().regex(HHMM, "Use a valid time.").optional(),
  numberOfPeople: z.coerce.number().int().min(1).max(50).optional(),
  notes: z.string().trim().max(1000).optional(),
  eventId: z.string().max(64).optional(),
});

export const conciergeMessageSchema = z.object({
  requestId: z.string().min(1).max(64),
  message: z.string().trim().min(1, "Write a message.").max(3000),
});

export const staffConciergeMessageSchema = conciergeMessageSchema.extend({
  internalNote: z.stringbool().default(false),
});
