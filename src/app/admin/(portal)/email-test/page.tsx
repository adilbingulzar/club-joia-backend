import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { emailSettings } from "@/services/email-test.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { LoadingSkeleton } from "@/components/joia/states";
import { TextArea, TextField } from "@/components/ui/form";
import { sendTestEmailAction } from "../actions";

export const metadata: Metadata = { title: "Email test", robots: { index: false, follow: false } };

/** Hidden page (not in the menu): send a plain test email to check delivery. Super admins only. */
export default function EmailTestPage() {
  return (
    <Suspense fallback={<LoadingSkeleton lines={6} />}>
      <EmailTest />
    </Suspense>
  );
}

async function EmailTest() {
  const actor = await requirePermissionPage("settings:manage");
  const s = emailSettings(actor);
  const rows: [string, string][] = [
    ["Sending through", s.driver === "console" ? "console (off: written to the server log only)" : s.driver],
    ["From", s.from],
    ...(s.driver === "postmark" ? ([["Postmark stream", s.stream], ["Postmark token", s.postmarkToken ? "set" : "missing"]] as [string, string][]) : []),
  ];
  return (
    <>
      <AdminPageHeader eyebrow="System" title="Email test" description="Send a plain test email to check that emails are delivered and where they land (inbox or spam)." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <AdminCard title="Send a test email" className="h-fit">
          <ActionForm action={sendTestEmailAction} submitLabel="Send test email">
            <TextField tone="light" label="To" name="to" type="email" required placeholder="name@example.com" />
            <TextField tone="light" label="Subject" name="subject" defaultValue="CLUB JOIA 300 test email" maxLength={150} />
            <TextArea tone="light" label="Message" name="text" rows={4} defaultValue="This is a test email from admin.clubjoia300.com." maxLength={5000} />
          </ActionForm>
        </AdminCard>
        <AdminCard title="Email settings" className="h-fit">
          <dl className="divide-y divide-black/6 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5">
                <dt className="text-black/55">{k}</dt>
                <dd className="min-w-0 break-all text-right font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-black/50">Sent? Postmark&apos;s Activity page shows whether each email was delivered, bounced or blocked.</p>
        </AdminCard>
      </div>
    </>
  );
}
