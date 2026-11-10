import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Parsed lazily (first access) so that `next build` does not
 * require runtime secrets, but any request touching a missing secret fails loudly.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  QR_SIGNING_SECRET: z.string().min(32, "QR_SIGNING_SECRET must be at least 32 characters"),
  QR_SIGNING_SECRET_PREVIOUS: z.string().min(32).optional(),
  QR_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  WEB_PUSH_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().default("mailto:concierge@clubjoia.example"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  EMAIL_DRIVER: z.enum(["console", "smtp", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("CLUB JOIA 300 <no-reply@clubjoia.example>"),
  /** smtp driver: e.g. smtps://user:password@smtp.example.com:465 */
  SMTP_URL: z.string().optional(),
  /** resend driver */
  RESEND_API_KEY: z.string().optional(),

  /** WhatsApp alerts to staff: "console" (logged only) or "twilio". */
  WHATSAPP_DRIVER: z.enum(["console", "twilio"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Sender, e.g. whatsapp:+14155238886 */
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  /** Approved WhatsApp template (Content SID, HX…) with variables {{1}} = title, {{2}} = details, {{3}} = link. */
  TWILIO_WHATSAPP_CONTENT_SID: z.string().optional(),

  CRON_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment — ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.STORAGE_DRIVER === "local") {
    console.warn("[config] STORAGE_DRIVER=local in production: uploads will not persist on serverless hosts.");
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === "production";
