import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { allFeatureFlags, FEATURE_FLAGS } from "@/lib/config/features";
import { env } from "@/lib/config/env";
import { getSettings } from "@/services/settings.service";
import { emailDeliveryConfigured } from "@/services/email.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { TextField } from "@/components/ui/form";
import { updateSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton lines={8} />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await requirePermissionPage("settings:manage");
  const settings = await getSettings();
  const flags = allFeatureFlags();
  const e = env();
  const checks: [string, boolean, string][] = [
    ["Web push (VAPID)", Boolean(e.WEB_PUSH_PUBLIC_KEY && e.WEB_PUSH_PRIVATE_KEY), "WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY"],
    ["Previous QR key (rotation window)", Boolean(e.QR_SIGNING_SECRET_PREVIOUS), "QR_SIGNING_SECRET_PREVIOUS"],
    ["Email delivery", emailDeliveryConfigured(), "EMAIL_DRIVER — only 'console' exists in V1"],
    ["Object storage", e.STORAGE_DRIVER === "s3", `STORAGE_DRIVER=${e.STORAGE_DRIVER}`],
    ["Cron secret (scheduled notifications)", Boolean(e.CRON_SECRET), "CRON_SECRET"],
  ];
  return (
    <>
      <AdminPageHeader eyebrow="System" title="Settings" description="Operational settings. Secrets are environment variables and never stored or shown here." />
      <div className="grid gap-6 xl:grid-cols-2">
        <AdminCard title="Support & legal">
          <ActionForm action={updateSettingsAction} submitLabel="Save settings">
            <TextField tone="light" label="Support email" name="support.email" defaultValue={settings["support.email"]} />
            <TextField tone="light" label="Support phone" name="support.phone" defaultValue={settings["support.phone"]} />
            <TextField tone="light" label="Support WhatsApp" name="support.whatsapp" defaultValue={settings["support.whatsapp"]} />
            <TextField tone="light" label="Terms URL" name="legal.termsUrl" defaultValue={settings["legal.termsUrl"]} />
            <TextField tone="light" label="Privacy policy URL" name="legal.privacyUrl" defaultValue={settings["legal.privacyUrl"]} />
          </ActionForm>
        </AdminCard>
        <div className="space-y-6">
          <AdminCard title="Integrations">
            <ul className="divide-y divide-black/6 text-sm">
              {checks.map(([label, ok, hint]) => (
                <li key={label} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    {label}
                    <span className="block font-mono text-[11px] text-black/45">{hint}</span>
                  </span>
                  <StatusBadge status={ok ? "ACTIVE" : "DRAFT"} label={ok ? "configured" : "not configured"} />
                </li>
              ))}
            </ul>
          </AdminCard>
          <AdminCard title="Feature flags (future phases)">
            <ul className="divide-y divide-black/6 text-sm">
              {Object.entries(flags).map(([flag, on]) => (
                <li key={flag} className="flex items-center justify-between py-2.5">
                  <span className="font-mono text-xs">{FEATURE_FLAGS[flag as keyof typeof FEATURE_FLAGS]}</span>
                  <StatusBadge status={on ? "ACTIVE" : "DRAFT"} label={on ? "on" : "off"} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-black/50">Flags are set via environment variables at deploy time.</p>
          </AdminCard>
        </div>
      </div>
    </>
  );
}
