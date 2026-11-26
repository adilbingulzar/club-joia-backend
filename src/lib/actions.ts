import "server-only";
import { z } from "zod";
import { getActor } from "@/lib/auth/dal";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";
import type { Actor } from "@/services/context";

/**
 * Server Action wrapper: authenticates, validates input with zod, runs the service call,
 * and converts failures into a user-safe ActionResult. Next.js already rejects cross-origin
 * Server Action POSTs (Origin vs Host check), which is our CSRF protection for actions;
 * session cookies are SameSite=Lax as a second layer.
 */
export async function authedAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (actor: Actor, data: z.infer<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const actor = await getActor();
    if (!actor) throw new AppError("UNAUTHENTICATED", "Your session has ended. Please sign in again.");
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    return { ok: true, data: await fn(actor, parsed.data) };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// "tierId" → "Tier", "emergencyContactName" → "Emergency contact name"
function fieldLabel(key: string): string {
  const words = key.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A field left empty arrives as undefined (formToObject), which Zod reports as "Invalid input:
 * expected string, received undefined"; staff and members get "<Field> is required." instead.
 */
function readableMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type" && /received undefined$/.test(issue.message)) {
    const key = String(issue.path[issue.path.length - 1] ?? "");
    return key ? `${fieldLabel(key)} is required.` : "Please fill in all required fields.";
  }
  return issue.message;
}

export function validationError(error: z.ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (fieldErrors[key] ??= []).push(readableMessage(issue));
  }
  const first = error.issues[0] ? readableMessage(error.issues[0]) : "Please check the form.";
  return new AppError("VALIDATION", first, fieldErrors);
}

/** FormData → plain object (multi-value keys become arrays; empty strings become undefined). */
export function formToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const all = form.getAll(key).filter((v) => typeof v === "string") as string[];
    const values = all.map((v) => (v === "" ? undefined : v));
    out[key] = key.endsWith("[]") ? values.filter(Boolean) : values[0];
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k.replace(/\[\]$/, ""), v]));
}
