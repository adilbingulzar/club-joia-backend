import { NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { MEMBER_API_NO_STORE, memberApiError, requireMemberApiKey } from "@/lib/member-api";
import { activateSchema, loginSchema, requestResetSchema, setPasswordSchema } from "@/validators/auth";
import {
  activateAccount,
  authenticate,
  peekAuthToken,
  requestPasswordReset,
  resetPassword,
  revokeSessionByToken,
  validateSessionToken,
  type RequestMeta,
} from "@/services/auth.service";
import type { Actor } from "@/services/context";
import { issueQrForMyTicket } from "@/services/qr.service";
import { isMemberAppAction, memberFile, runMemberAppAction } from "@/services/member-app.service";

/**
 * The member app on the website (club-joia-300-next: /login, /activate, /forgot-password,
 * /reset-password and the member's pages under /account, a copy of src/app/(member)). Members don't come here: this app is behind the IP allowlist, so the
 * website's server calls this API (Authorization: Bearer MEMBER_API_KEY; left out of the
 * allowlist in src/proxy.ts) and keeps the member's session token in its own cookie.
 *
 * POST /api/member-app/<action>, JSON in and out; errors: { error: { code, message, fieldErrors? } }.
 * Every body may carry ip and userAgent: the member's, for rate limits and the audit log.
 *   login        { email, password }                        -> { session, expiresAt }   (members only)
 *   logout       { session }                                -> { ok }
 *   activation   { token }                                  -> { email, name } | 404
 *   activate     { token, password, confirm, acceptTerms }  -> { session, expiresAt }
 *   forgot       { email }                                  -> { ok }   (same answer for any email)
 *   reset-check  { token }                                  -> { email } | 404
 *   reset        { token, password, confirm }               -> { ok }
 *   qr           { session, ticketNumber }                  -> { token, expiresAt, refreshInSeconds }
 *   file         { session, key }                           -> the stored file itself (its content type)
 * The member's pages and forms (src/services/member-app.service.ts: home, card, events, concierge-create, ...):
 *   <action>     { session, fields: { ... } }               -> { data }
 *   A form with a file (concierge) comes as multipart/form-data: session, ip, userAgent, its fields
 *   and the file as "attachment".
 */
type Body = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");

function meta(body: Body): RequestMeta {
  return { ipAddress: str(body.ip).slice(0, 64) || null, userAgent: str(body.userAgent).slice(0, 500) || null };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

const signedOut = () => new AppError("UNAUTHENTICATED", "Please sign in.");

/** The member of a session token; staff sessions don't count here. */
async function memberActor(body: Body): Promise<Actor & { memberId: string }> {
  const user = await validateSessionToken(str(body.session));
  if (!user || user.role !== "MEMBER" || !user.memberId) throw signedOut();
  const m = meta(body);
  return { userId: user.userId, role: user.role, memberId: user.memberId, sessionId: user.sessionId, ipAddress: m.ipAddress, userAgent: m.userAgent };
}

/** An activation or reset link that belongs to a member (staff links are for the staff portal). */
async function memberToken(token: string, type: "ACTIVATION" | "PASSWORD_RESET") {
  const row = await peekAuthToken(token, type);
  return row && row.role === "MEMBER" ? row : null;
}

const invalidLink = (type: "ACTIVATION" | "PASSWORD_RESET") =>
  new AppError(
    "INVALID_STATE",
    type === "ACTIVATION"
      ? "This activation link is invalid or has expired. Please ask CLUB JOIA concierge for a new invitation."
      : "This reset link is invalid or has expired. Please request a new one.",
  );

async function run(action: string, body: Body): Promise<unknown> {
  switch (action) {
    case "login": {
      const d = parse(loginSchema, { email: str(body.email), password: str(body.password) });
      const r = await authenticate(d.email, d.password, meta(body));
      if (r.role !== "MEMBER") {
        await revokeSessionByToken(r.token);
        throw new AppError("FORBIDDEN", "This sign-in is for CLUB JOIA members. Staff sign in at the staff portal.");
      }
      return { session: r.token, expiresAt: r.expiresAt.toISOString() };
    }
    case "logout":
      if (str(body.session)) await revokeSessionByToken(str(body.session).slice(0, 100));
      return { ok: true };
    case "activation": {
      const row = await memberToken(str(body.token), "ACTIVATION");
      if (!row) throw invalidLink("ACTIVATION");
      return { email: row.email, name: row.name };
    }
    case "activate": {
      const d = parse(activateSchema, { token: str(body.token), password: str(body.password), confirm: str(body.confirm), acceptTerms: str(body.acceptTerms) });
      if (!(await memberToken(d.token, "ACTIVATION"))) throw invalidLink("ACTIVATION");
      const r = await activateAccount(d.token, d.password, meta(body));
      return { session: r.token, expiresAt: r.expiresAt.toISOString() };
    }
    case "forgot": {
      const d = parse(requestResetSchema, { email: str(body.email) });
      await requestPasswordReset(d.email, meta(body));
      return { ok: true };
    }
    case "reset-check": {
      const row = await memberToken(str(body.token), "PASSWORD_RESET");
      if (!row) throw invalidLink("PASSWORD_RESET");
      return { email: row.email };
    }
    case "reset": {
      const d = parse(setPasswordSchema, { token: str(body.token), password: str(body.password), confirm: str(body.confirm) });
      if (!(await memberToken(d.token, "PASSWORD_RESET"))) throw invalidLink("PASSWORD_RESET");
      await resetPassword(d.token, d.password, meta(body));
      return { ok: true };
    }
    case "qr": {
      const actor = await memberActor(body);
      return issueQrForMyTicket(actor, str(body.ticketNumber).slice(0, 100));
    }
    default:
      throw new AppError("NOT_FOUND", "Unknown action.");
  }
}

// JSON, or multipart/form-data for a form with a file: its strings as fields, the file apart
async function readBody(request: Request): Promise<{ body: Body; file: File | null }> {
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) throw new AppError("VALIDATION", "Send a form.");
    const fields: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string" && !["session", "ip", "userAgent"].includes(k)) fields[k] = v;
    const file = form.get("attachment");
    return { body: { session: form.get("session"), ip: form.get("ip"), userAgent: form.get("userAgent"), fields }, file: file instanceof File && file.size > 0 ? file : null };
  }
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("VALIDATION", "Send a JSON object.");
  return { body, file: null };
}

export async function POST(request: Request, ctx: RouteContext<"/api/member-app/[action]">) {
  try {
    await requireMemberApiKey(request);
    const { action } = await ctx.params;
    const { body, file } = await readBody(request);
    if (action === "file") {
      const f = await memberFile(await memberActor(body), str(body.key).slice(0, 300));
      return new NextResponse(new Uint8Array(f.body), { headers: { ...MEMBER_API_NO_STORE, "Content-Type": f.contentType } });
    }
    if (isMemberAppAction(action)) {
      const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? (body.fields as Record<string, unknown>) : {};
      const data = await runMemberAppAction(action, await memberActor(body), { fields, file });
      return NextResponse.json({ data: data ?? null }, { headers: MEMBER_API_NO_STORE });
    }
    return NextResponse.json(await run(action, body), { headers: MEMBER_API_NO_STORE });
  } catch (e) {
    return memberApiError(e);
  }
}
