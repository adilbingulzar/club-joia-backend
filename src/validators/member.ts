import { z } from "zod";
import { emailSchema } from "./auth";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+()\d\s.-]*$/, "Use digits, spaces and + only.")
  .optional()
  .transform((v) => (v ? v : null));

/** Fields a member may edit about themselves. Name and membership fields are admin-managed. */
export const memberSelfProfileSchema = z.object({
  displayName: optionalText(60),
  mobile: phone,
  country: optionalText(60),
  city: optionalText(60),
  nationality: optionalText(60),
  company: optionalText(100),
  jobTitle: optionalText(100),
  industry: optionalText(100),
  bio: optionalText(600),
});

export const hospitalitySchema = z.object({
  dietaryRequirements: optionalText(300),
  allergies: optionalText(300),
  shirtSize: z.enum(["XS", "S", "M", "L", "XL", "XXL"]).optional().nullable().transform((v) => v ?? null),
  seatingPreference: optionalText(200),
  drinksPreference: optionalText(200),
  arrivalNotes: optionalText(300),
});

export const emergencySchema = z.object({
  emergencyContactName: optionalText(100),
  emergencyContactPhone: phone,
});

export const notificationPrefsSchema = z.object({
  push: z.stringbool().default(false),
  programmeUpdates: z.stringbool().default(false),
  conciergeUpdates: z.stringbool().default(false),
});

export const privacySchema = z.object({
  marketingEmails: z.stringbool().default(false),
});

/** Admin create/edit (superset of member-editable fields). */
export const adminMemberSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(60),
  lastName: z.string().trim().min(1, "Last name is required.").max(60),
  email: emailSchema,
  displayName: optionalText(60),
  mobile: phone,
  country: optionalText(60),
  city: optionalText(60),
  nationality: optionalText(60),
  company: optionalText(100),
  jobTitle: optionalText(100),
  industry: optionalText(100),
  dietaryRequirements: optionalText(300),
  allergies: optionalText(300),
  emergencyContactName: optionalText(100),
  emergencyContactPhone: phone,
});

export const adminCreateMemberSchema = adminMemberSchema.extend({
  tierId: z.string().min(1, "Choose a membership tier."),
  homeChapterId: z.string().optional(),
  sendInvitation: z.stringbool().default(true),
});
