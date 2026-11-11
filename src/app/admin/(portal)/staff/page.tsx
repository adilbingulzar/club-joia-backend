import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listStaff } from "@/services/staff.service";
import { emailDeliveryConfigured } from "@/services/email.service";
import { whatsappDeliveryConfigured } from "@/services/whatsapp.service";
import { AdminCard, AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionButton, ActionForm } from "@/components/admin/action-controls";
import { PermissionBadge, StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { Checkbox, Notice, SelectField, TextField } from "@/components/ui/form";
import { mfaRequired, ROLE_LABELS } from "@/lib/auth/permissions";
import { CONCIERGE_CATEGORY_LABELS } from "@/domain/concierge";
import { formatDateTime } from "@/lib/utils";
import { sp, type SP } from "@/lib/search-params";
import { CONCIERGE_CATEGORY_VALUES, STAFF_ROLE_VALUES } from "@/validators/admin";
import { createStaffAction, resendStaffInvitationAction, resetStaffMfaAction, setStaffStatusAction, updateStaffContactAction } from "../actions";
import { RoleSelect } from "./role-select";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage({ searchParams }: PageProps<"/admin/staff">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={5} />}>
      <Staff searchParams={searchParams} />
    </Suspense>
  );
}

type StaffContactDefaults = { whatsappNumber?: string | null; alertByEmail?: boolean; alertByWhatsapp?: boolean; conciergeCategories?: string[] };

/** WhatsApp number, alert channels and concierge responsibilities — shared by create and edit. */
function ContactFields({ s }: { s?: StaffContactDefaults }) {
  return (
    <>
      <TextField tone="light" label="WhatsApp number" name="whatsappNumber" type="tel" defaultValue={s?.whatsappNumber ?? ""} placeholder="+971 50 123 4567" hint="International format with country code." />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-black/60">Concierge alerts by</legend>
        <Checkbox tone="light" name="alertByEmail" defaultChecked={s?.alertByEmail ?? true} label="Email" />
        <Checkbox tone="light" name="alertByWhatsapp" defaultChecked={s?.alertByWhatsapp ?? false} label="WhatsApp" />
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-black/60">Responsible for</legend>
        <p className="mb-2 text-xs text-black/50">New requests in these categories alert this person. Concierge staff with none selected receive every category; admins are alerted only when nobody else covers a category.</p>
        <div className="grid grid-cols-2 gap-2">
          {CONCIERGE_CATEGORY_VALUES.map((c) => (
            <Checkbox key={c} tone="light" name="conciergeCategories[]" value={c} defaultChecked={s?.conciergeCategories?.includes(c)} label={CONCIERGE_CATEGORY_LABELS[c]} />
          ))}
        </div>
      </fieldset>
    </>
  );
}

async function Staff({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("staff:manage");
  const params = await searchParams;
  const staff = await listStaff(actor);
  const editing = staff.find((s) => s.id === sp(params, "edit"));
  const emailOn = emailDeliveryConfigured();
  const whatsappOn = whatsappDeliveryConfigured();
  return (
    <>
      <AdminPageHeader eyebrow="Security" title="Staff" description="Role changes sign the person out everywhere so new permissions apply immediately. Staff sessions last 12 hours. Staff sign in at /admin/login. Admins and super admins also enter a code from an authenticator app; resetting it makes them set it up again at their next sign-in." />
      {(!emailOn || !whatsappOn) && (
        <div className="mb-6">
          <Notice tone="light" title="Alert delivery not fully configured">
            {!emailOn && "Email alerts are only written to the server log until an email provider is configured (EMAIL_DRIVER). "}
            {!whatsappOn && "WhatsApp alerts are only written to the server log until Twilio is configured (WHATSAPP_DRIVER). "}
            Each request shows which alerts were sent in its internal notes.
          </Notice>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <AdminDataTable
          caption="Staff accounts"
          rows={staff}
          rowKey={(s) => s.id}
          columns={[
            { header: "Name", cell: (s) => <span><Link href={`/admin/staff?edit=${s.id}`} className="font-medium hover:text-ruby">{s.name}</Link><span className="block text-xs text-black/50">{s.email}</span></span> },
            { header: "Role", cell: (s) => (s.id === actor.userId ? <PermissionBadge role={s.role} /> : <RoleSelect userId={s.id} role={s.role} />) },
            {
              header: "Alerts",
              cell: (s) => (
                <span className="flex flex-col gap-0.5 text-xs text-black/60">
                  <span className="flex items-center gap-1.5">
                    {s.alertByEmail && <Mail className="size-3.5" aria-label="Email alerts" />}
                    {s.alertByWhatsapp && <MessageCircle className="size-3.5" aria-label="WhatsApp alerts" />}
                    {s.whatsappNumber ? <span className="font-mono">{s.whatsappNumber}</span> : !s.alertByEmail && <span className="text-black/40">none</span>}
                  </span>
                  {s.conciergeCategories.length > 0 && <span className="text-black/45">{s.conciergeCategories.map((c) => CONCIERGE_CATEGORY_LABELS[c]).join(", ")}</span>}
                </span>
              ),
            },
            { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
            {
              header: "Two-factor",
              cell: (s) => (
                <span className="flex items-center gap-1 text-xs text-black/60">
                  {s.mfaEnabled ? "On" : mfaRequired(s.role) ? <span className="text-black/45">Set up at next sign-in</span> : <span className="text-black/40">Not required</span>}
                  {s.mfaEnabled && s.id !== actor.userId && (
                    <ActionButton label="Reset" variant="ghost" run={resetStaffMfaAction.bind(null, s.id)} confirm={{ title: `Reset two-factor sign-in for ${s.name}?`, description: "They are signed out everywhere and set up their authenticator app again at their next sign-in. Use this when they lost their phone.", destructive: true }} />
                  )}
                </span>
              ),
            },
            { header: "Last sign-in", cell: (s) => <span className="text-xs text-black/55">{s.lastLoginAt ? formatDateTime(s.lastLoginAt) : "never"}</span> },
            {
              header: "",
              cell: (s) => (
                <span className="flex items-center gap-1">
                  <Link href={`/admin/staff?edit=${s.id}`} className="rounded-full px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 hover:text-ink">Edit</Link>
                  {s.id === actor.userId ? null : s.status === "PENDING_ACTIVATION" ? (
                    <ActionButton label="Re-send invite" variant="ghost" run={resendStaffInvitationAction.bind(null, s.id)} />
                  ) : s.status === "ACTIVE" ? (
                    <ActionButton label="Disable" variant="ghost" run={setStaffStatusAction.bind(null, s.id, "DISABLED")} confirm={{ title: `Disable ${s.name}?`, description: "They are signed out everywhere immediately.", destructive: true }} />
                  ) : (
                    <ActionButton label="Enable" variant="ghost" run={setStaffStatusAction.bind(null, s.id, "ACTIVE")} />
                  )}
                </span>
              ),
            },
          ]}
        />
        {editing ? (
          <AdminCard title={`Edit ${editing.name}`} className="h-fit" actions={<Link href="/admin/staff" className="text-xs text-black/50 hover:text-ink">Close</Link>}>
            <ActionForm action={updateStaffContactAction} submitLabel="Save" key={editing.id}>
              <input type="hidden" name="userId" value={editing.id} />
              <TextField tone="light" label="Name" name="name" defaultValue={editing.name} required />
              <p className="text-xs text-black/50">{editing.email} · {ROLE_LABELS[editing.role]}</p>
              <ContactFields s={editing} />
            </ActionForm>
          </AdminCard>
        ) : (
          <AdminCard title="Add staff" className="h-fit">
            <ActionForm action={createStaffAction} submitLabel="Create & invite" resetOnSuccess>
              <TextField tone="light" label="Name" name="name" required />
              <TextField tone="light" label="Email" name="email" type="email" required />
              <SelectField tone="light" label="Role" name="role" defaultValue="CHECK_IN_STAFF" options={STAFF_ROLE_VALUES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
              <ContactFields />
            </ActionForm>
          </AdminCard>
        )}
      </div>
    </>
  );
}
