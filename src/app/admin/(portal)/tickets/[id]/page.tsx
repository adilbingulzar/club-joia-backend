import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { isAppError } from "@/lib/errors";
import { getTicketAdmin } from "@/services/ticket.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionButton, ActionForm } from "@/components/admin/action-controls";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { TextField } from "@/components/ui/form";
import { formatDateTime } from "@/lib/utils";
import { reissueCredentialAction, revokeTicketAction, suspendTicketAction } from "../../actions";

export const metadata: Metadata = { title: "Ticket" };

export default function TicketAdminPage({ params }: PageProps<"/admin/tickets/[id]">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={5} />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: Pick<PageProps<"/admin/tickets/[id]">, "params">) {
  const actor = await requirePermissionPage("tickets:view");
  const { id } = await params;
  let t;
  try {
    t = await getTicketAdmin(actor, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const manage = can(actor.role, "tickets:manage");
  const tz = t.event.timezone;
  const fmt = (d: Date) => formatDateTime(d, tz);

  return (
    <>
      <AdminPageHeader
        eyebrow={`${t.event.name} · ${t.ticketType.name}`}
        title={t.ticketNumber}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={t.effectiveStatus} />
            <Link href={`/admin/members/${t.member.id}`} className="hover:text-ruby">
              {t.member.firstName} {t.member.lastName} · {t.member.membershipNumber}
            </Link>
          </span>
        }
        actions={
          manage &&
          t.status !== "REVOKED" && (
            <>
              <ActionButton
                label="Reissue QR credential"
                run={reissueCredentialAction.bind(null, t.id)}
                confirm={{ title: "Reissue QR credential?", description: "Every QR code currently on the member's phone (and any screenshot) stops working immediately. The member's app picks up the new credential automatically." }}
              />
              {t.status === "ACTIVE" && <ActionButton label="Suspend" variant="outline" run={suspendTicketAction.bind(null, t.id, true)} />}
              {t.status === "SUSPENDED" && <ActionButton label="Unsuspend" run={suspendTicketAction.bind(null, t.id, false)} />}
            </>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <AdminCard title="Details">
          <dl className="space-y-2 text-sm">
            {[
              ["Valid from", fmt(t.validFrom)],
              ["Valid until", fmt(t.validUntil)],
              ["Entry policy", t.ticketType.entryPolicy.toLowerCase().replace("_", " ")],
              ["Zones", t.ticketType.zones.map((z) => z.zone.name).join(", ")],
              ["Issued", `${fmt(t.issuedAt)} by ${t.issuedBy?.name ?? "system"}`],
              ...(t.revokedAt ? [["Revoked", `${fmt(t.revokedAt)} by ${t.revokedBy?.name ?? "—"} — ${t.revokeReason ?? ""}`]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-black/50">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </AdminCard>
        <AdminCard title="QR credentials">
          <ul className="space-y-2 text-sm">
            {t.credentials.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>Version {c.version} · {fmt(c.issuedAt)}</span>
                <StatusBadge status={c.revokedAt ? "REVOKED" : "ACTIVE"} label={c.revokedAt ? c.revokeReason ?? "revoked" : "current"} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-black/45">Credential references are never displayed. QR tokens are signed, expire after minutes, and are verified against these records.</p>
        </AdminCard>
        {t.status === "REVOKED" && (
          <AdminCard title="Revoked" className="border-ruby/30">
            <p role="status" className="text-sm">Ticket revoked. Its QR code no longer validates at any checkpoint.</p>
          </AdminCard>
        )}
        {manage && t.status !== "REVOKED" && (
          <AdminCard title="Revoke ticket">
            <ActionForm action={revokeTicketAction} submitLabel="Revoke ticket" submitVariant="danger">
              <input type="hidden" name="ticketId" value={t.id} />
              <TextField tone="light" label="Reason" name="reason" required placeholder="e.g. Issued in error" />
            </ActionForm>
            <p className="mt-3 text-xs text-black/50">Revocation is immediate and permanent; scans return REVOKED.</p>
          </AdminCard>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <AdminCard title="Check-ins">
          <ul className="divide-y divide-black/6 text-sm">
            {t.checkIns.map((c) => (
              <li key={c.id} className="flex justify-between py-2">
                <span>{c.zone.name} · {c.staff.name}</span>
                <span className="text-xs text-black/50">{fmt(c.checkedInAt)}</span>
              </li>
            ))}
            {t.checkIns.length === 0 && <li className="py-2 text-black/50">Not checked in yet.</li>}
          </ul>
        </AdminCard>
        <AdminCard title="Scan history">
          <ul className="divide-y divide-black/6 text-sm">
            {t.scanLogs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {l.action.toLowerCase()} · {l.method.toLowerCase()} · {l.zone?.name ?? "—"} <span className="text-black/45">by {l.staff.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={l.result} />
                  <span className="text-xs text-black/50">{fmt(l.scanTime)}</span>
                </span>
              </li>
            ))}
            {t.scanLogs.length === 0 && <li className="py-2 text-black/50">No scans yet.</li>}
          </ul>
        </AdminCard>
      </div>
    </>
  );
}
