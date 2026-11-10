import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";

/**
 * SettingsService — small key/value system configuration editable by SUPER_ADMIN.
 * Secrets never live here (they are environment variables).
 */
export const SETTING_DEFAULTS = {
  "support.email": "concierge@clubjoia.example",
  "support.phone": "+971 00 000 0000",
  "support.whatsapp": "",
  "legal.termsUrl": "/legal/terms",
  "legal.privacyUrl": "/legal/privacy",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: Object.keys(SETTING_DEFAULTS) } } });
  const out = { ...SETTING_DEFAULTS } as Record<SettingKey, string>;
  for (const r of rows) out[r.key as SettingKey] = String(r.value ?? "");
  return out;
}

export async function updateSettings(actor: Actor, values: Partial<Record<SettingKey, string>>) {
  requirePermission(actor, "settings:manage");
  const before = await getSettings();
  await db.$transaction(
    Object.entries(values)
      .filter(([k]) => k in SETTING_DEFAULTS)
      .map(([key, value]) =>
        db.systemSetting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue, updatedById: actor.userId },
          update: { value: value as Prisma.InputJsonValue, updatedById: actor.userId },
        }),
      ),
  );
  await recordAudit(actor, { action: "settings.update", entityType: "system_setting", before, after: values });
}
