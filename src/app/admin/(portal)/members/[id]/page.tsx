import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { dateOnly } from "@/lib/time";
import { formatDateTime } from "@/lib/utils";
import { getMemberForStaff, listChapters } from "@/services/member.service";
import { listTiers } from "@/services/membership.service";
import { getMemberEntitlements, listEntitlementCatalogue } from "@/services/entitlement.service";
import { listMemberTicketsAdmin, listTicketTypes } from "@/services/ticket.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { EventTicketTypePicker } from "@/components/admin/event-ticket-type-picker";
import { groupTicketTypesByEvent } from "@/components/admin/event-helpers";
import { ActionButton, ActionForm } from "@/components/admin/action-controls";
import { StatusBadge, TierBadge } from "@/components/joia/badges";
import { MemberAvatar } from "@/components/joia/member-avatar";
import { LoadingSkeleton } from "@/components/joia/states";
import { SelectField, TextField } from "@/components/ui/form";
import { MEMBERSHIP_STATUSES } from "@/validators/admin";
import {
  anonymizeMemberAction,
  assignMembershipAction,
  entitlementOverrideAction,
  issueTicketAction,
  passwordResetLinkAction,
  resendInvitationAction,
  setAccountStatusAction,
  setMembershipStatusAction,
  updateMemberAction,
} from "../../actions";

export const metadata: Metadata = { title: "Member" };

export default function MemberDetailPage({ params }: PageProps<"/admin/members/[id]">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: Pick<PageProps<"/admin/members/[id]">, "params">) {
  const actor = await requirePermissionPage("members:view");
  const { id } = await params;
  let m;
  try {
    m = await getMemberForStaff(actor, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  if (m.scope !== "full") notFound();
  const manage = can(actor.role, "members:manage");
  const [tiers, chapters, tickets, ticketTypes, catalogue, effective, requests, history] = await Promise.all([
    listTiers(),
    listChapters(),
    listMemberTicketsAdmin(actor, id),
    listTicketTypes(),
    listEntitlementCatalogue(),
    getMemberEntitlements(id),
    db.conciergeRequest.findMany({ where: { memberId: id }, orderBy: { updatedAt: "desc" }, take: 10 }),
    db.auditLog.findMany({ where: { entityId: { in: [id, ...m.memberships.map((x) => x.id)] } }, orderBy: { createdAt: "desc" }, take: 12, include: { actor: { select: { name: true } } } }),
  ]);
  const cm = m.currentMembership;
  const anonymized = Boolean(m.anonymizedAt);

  return (
    <>
      <AdminPageHeader
        eyebrow={`Member · ${m.membershipNumber}`}
        title={`${m.firstName} ${m.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {cm && <TierBadge name={cm.tier.displayName} theme={cm.tier.cardTheme} />}
            {cm && <StatusBadge status={cm.status} label={`membership ${cm.status.toLowerCase()}`} />}
            <StatusBadge status={m.user.status} label={`account ${m.user.status.replace("_", " ").toLowerCase()}`} />
            {m.deletionRequestedAt && <StatusBadge status="X" tone="danger" label={`deletion requested ${dateOnly(m.deletionRequestedAt)}`} />}
          </span>
        }
        actions={
          manage && !anonymized && (
            <>
              {m.user.status === "PENDING_ACTIVATION" && <ActionButton label="Re-send invitation" run={resendInvitationAction.bind(null, id)} />}
              {m.user.status === "ACTIVE" && <ActionButton label="Password reset link" run={passwordResetLinkAction.bind(null, id)} />}
              {cm?.status === "ACTIVE" && (
                <ActionButton label="Suspend membership" variant="outline" run={setMembershipStatusAction.bind(null, id, "SUSPENDED")} confirm={{ title: "Suspend membership?", description: "Tickets stop validating at the door and privileges are paused until reactivated.", destructive: true }} />
              )}
              {cm?.status === "SUSPENDED" && <ActionButton label="Reactivate membership" variant="primary" run={setMembershipStatusAction.bind(null, id, "ACTIVE")} />}
              {m.user.status === "ACTIVE" ? (
                <ActionButton label="Disable sign-in" variant="outline" run={setAccountStatusAction.bind(null, id, "DISABLED")} confirm={{ title: "Disable sign-in?", description: "The member is signed out everywhere and cannot sign in. Tickets will not validate.", destructive: true }} />
              ) : m.user.status === "DISABLED" ? (
                <ActionButton label="Enable sign-in" run={setAccountStatusAction.bind(null, id, "ACTIVE")} />
              ) : null}
            </>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <AdminCard title="Profile">
          <div className="mb-5 flex items-center gap-4">
            <MemberAvatar firstName={m.firstName} lastName={m.lastName} photoUrl={m.profilePhotoKey ? `/api/files/${m.profilePhotoKey}` : null} size={64} className="bg-ink" />
            <div className="text-sm text-black/60">
              <p>Member since {dateOnly(m.memberSince)}</p>
              <p>Last sign-in {m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : "never"}</p>
            </div>
          </div>
          {manage && !anonymized ? (
            <ActionForm action={updateMemberAction} submitLabel="Save profile">
              <input type="hidden" name="memberId" value={m.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <TextField tone="light" label="First name" name="firstName" defaultValue={m.firstName} required />
                <TextField tone="light" label="Last name" name="lastName" defaultValue={m.lastName} required />
                <TextField tone="light" label="Email" name="email" type="email" defaultValue={m.user.email} required />
                <TextField tone="light" label="Mobile" name="mobile" defaultValue={m.mobile ?? ""} />
                <TextField tone="light" label="Preferred name" name="displayName" defaultValue={m.displayName ?? ""} />
                <TextField tone="light" label="Nationality" name="nationality" defaultValue={m.nationality ?? ""} />
                <TextField tone="light" label="City" name="city" defaultValue={m.city ?? ""} />
                <TextField tone="light" label="Country" name="country" defaultValue={m.country ?? ""} />
                <TextField tone="light" label="Company" name="company" defaultValue={m.company ?? ""} />
                <TextField tone="light" label="Job title" name="jobTitle" defaultValue={m.jobTitle ?? ""} />
                <TextField tone="light" label="Industry" name="industry" defaultValue={m.industry ?? ""} />
                <TextField tone="light" label="Dietary" name="dietaryRequirements" defaultValue={m.dietaryRequirements ?? ""} />
                <TextField tone="light" label="Allergies" name="allergies" defaultValue={m.allergies ?? ""} />
                <TextField tone="light" label="Emergency contact" name="emergencyContactName" defaultValue={m.emergencyContactName ?? ""} />
                <TextField tone="light" label="Emergency phone" name="emergencyContactPhone" defaultValue={m.emergencyContactPhone ?? ""} />
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-black/55">{anonymized ? "This member has been anonymised." : "Read-only."}</p>
          )}
        </AdminCard>

        <div className="space-y-6">
          <AdminCard title="Membership">
            {manage && !anonymized ? (
              <ActionForm action={assignMembershipAction} submitLabel={cm ? "Update membership" : "Assign membership"}>
                <input type="hidden" name="memberId" value={m.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField tone="light" label="Tier" name="tierId" defaultValue={cm?.tierId} options={tiers.map((t) => ({ value: t.id, label: t.displayName }))} />
                  <SelectField tone="light" label="Status" name="status" defaultValue={cm?.status ?? "INVITED"} options={MEMBERSHIP_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
                  <TextField tone="light" label="Start date" name="startDate" type="date" defaultValue={cm?.startDate ? dateOnly(cm.startDate) : ""} />
                  <TextField tone="light" label="End date" name="endDate" type="date" defaultValue={cm?.endDate ? dateOnly(cm.endDate) : ""} />
                  <SelectField tone="light" label="Home chapter" name="homeChapterId" defaultValue={cm?.homeChapterId ?? ""} placeholder="—" options={chapters.map((c) => ({ value: c.id, label: c.name }))} />
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm">{cm ? `${cm.tier.displayName} · ${cm.status}` : "No membership"}</p>
            )}
          </AdminCard>

          <AdminCard title="Effective privileges">
            <ul className="mb-4 flex flex-wrap gap-2">
              {catalogue.filter((e) => e.code in effective).map((e) => (
                <li key={e.code} className="rounded-full bg-black/5 px-3 py-1 text-xs">
                  {e.name}
                  {typeof effective[e.code] !== "boolean" && `: ${effective[e.code]}`}
                </li>
              ))}
              {Object.keys(effective).length === 0 && <li className="text-sm text-black/50">None (membership not active).</li>}
            </ul>
            {m.entitlementGrants.length > 0 && (
              <p className="mb-3 text-xs text-black/55">
                Overrides: {m.entitlementGrants.map((g) => `${g.entitlement.name} → ${JSON.stringify(g.value)}${g.reason ? ` (${g.reason})` : ""}`).join("; ")}
              </p>
            )}
            {can(actor.role, "memberships:manage") && !anonymized && (
              <ActionForm action={entitlementOverrideAction} submitLabel="Apply override" className="grid gap-3 md:grid-cols-4 md:items-end">
                <input type="hidden" name="memberId" value={m.id} />
                <SelectField tone="light" label="Entitlement" name="code" options={catalogue.map((e) => ({ value: e.code, label: e.name }))} />
                <SelectField tone="light" label="Action" name="mode" options={[{ value: "grant", label: "Grant" }, { value: "revoke", label: "Revoke" }, { value: "clear", label: "Clear override" }]} />
                <TextField tone="light" label="Value (if numeric/text)" name="value" />
                <TextField tone="light" label="Reason" name="reason" />
              </ActionForm>
            )}
          </AdminCard>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <AdminCard title="Tickets">
          <ul className="mb-5 divide-y divide-black/6 text-sm">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/admin/tickets/${t.id}`} className="hover:text-ruby">
                  {t.ticketType.name} <span className="font-mono text-xs text-black/50">{t.ticketNumber}</span>
                </Link>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-black/45">{t._count.checkIns} check-ins</span>
                  <StatusBadge status={t.effectiveStatus} />
                </span>
              </li>
            ))}
            {tickets.length === 0 && <li className="py-3 text-black/50">No tickets issued.</li>}
          </ul>
          {can(actor.role, "tickets:manage") && !anonymized && (
            <ActionForm action={issueTicketAction} submitLabel="Issue ticket" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="memberId" value={m.id} />
              <EventTicketTypePicker options={groupTicketTypesByEvent(ticketTypes)} />
            </ActionForm>
          )}
        </AdminCard>

        <AdminCard title="Concierge requests">
          <ul className="divide-y divide-black/6 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/admin/concierge/${r.id}`} className="truncate hover:text-ruby">
                  {r.subject} <span className="text-xs text-black/45">{r.reference}</span>
                </Link>
                <StatusBadge status={r.status} />
              </li>
            ))}
            {requests.length === 0 && <li className="py-3 text-black/50">No requests.</li>}
          </ul>
        </AdminCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[2fr_1fr]">
        <AdminCard title="Recent history">
          <ul className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-4">
                <span>
                  <span className="font-mono text-xs">{h.action}</span> <span className="text-black/50">by {h.actor?.name ?? "system"}</span>
                </span>
                <span className="text-xs text-black/45">{formatDateTime(h.createdAt)}</span>
              </li>
            ))}
            {history.length === 0 && <li className="text-black/50">No history.</li>}
          </ul>
        </AdminCard>
        {manage && !anonymized && (
          <AdminCard title="Data protection">
            <p className="mb-4 text-sm text-black/60">
              Erase this member’s personal data (GDPR). Tickets are cancelled; scan and audit history is kept against an anonymous record. This cannot be undone.
            </p>
            <ActionButton
              label="Anonymise member"
              variant="danger"
              run={anonymizeMemberAction.bind(null, id)}
              confirm={{ title: "Anonymise this member?", description: "Personal data will be permanently erased.", destructive: true, confirmLabel: "Erase personal data" }}
            />
          </AdminCard>
        )}
      </div>
    </>
  );
}
