import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Lock, Paperclip } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { isAppError } from "@/lib/errors";
import { dateOnly } from "@/lib/time";
import { cn, formatDateTime } from "@/lib/utils";
import { getRequest, listConciergeTeam } from "@/services/concierge.service";
import { CONCIERGE_CATEGORY_LABELS, CONCIERGE_STATUS_STAFF_LABELS } from "@/domain/concierge";
import { pickCurrentMembership } from "@/domain/membership";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { StatusBadge, TierBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { Checkbox, SelectField, TextArea, TextField } from "@/components/ui/form";
import { CONCIERGE_PRIORITIES, CONCIERGE_STATUSES } from "@/validators/concierge";
import { staffConciergeMessageAction, updateConciergeAction } from "../../actions";

export const metadata: Metadata = { title: "Concierge request" };

export default function ConciergeRequestAdminPage({ params }: PageProps<"/admin/concierge/[id]">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: Pick<PageProps<"/admin/concierge/[id]">, "params">) {
  const actor = await requirePermissionPage("concierge:view_all");
  const { id } = await params;
  let r;
  try {
    r = await getRequest(actor, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const team = await listConciergeTeam();
  const member = r.member!;
  const membership = pickCurrentMembership(member.memberships);
  const manage = can(actor.role, "concierge:manage");

  return (
    <>
      <AdminPageHeader
        eyebrow={`${r.reference} · ${CONCIERGE_CATEGORY_LABELS[r.category]}${r.event ? ` · ${r.event.name}` : ""}`}
        title={r.subject}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={r.status} label={CONCIERGE_STATUS_STAFF_LABELS[r.status]} />
            <StatusBadge status={r.priority} />
            <span className="text-xs">opened {formatDateTime(r.createdAt)}</span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <AdminCard title="Request">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.description}</p>
            {r.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-black/60">Notes: {r.notes}</p>}
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-[10px] uppercase tracking-[0.16em] text-black/45">Date</dt><dd>{r.preferredDate ? dateOnly(r.preferredDate) : "—"}</dd></div>
              <div><dt className="text-[10px] uppercase tracking-[0.16em] text-black/45">Time</dt><dd>{r.preferredTime ?? "—"}</dd></div>
              <div><dt className="text-[10px] uppercase tracking-[0.16em] text-black/45">People</dt><dd>{r.numberOfPeople ?? "—"}</dd></div>
            </dl>
          </AdminCard>

          <AdminCard title="Conversation">
            <ol className="space-y-3">
              {r.messages.map((m) =>
                m.senderType === "SYSTEM" ? (
                  <li key={m.id} className="text-center text-[11px] uppercase tracking-[0.14em] text-black/40">{m.message} · {formatDateTime(m.createdAt)}</li>
                ) : (
                  <li
                    key={m.id}
                    className={cn(
                      "rounded-xl p-3 text-sm",
                      m.internalNote ? "border border-dashed border-warning/60 bg-warning/5" : m.senderType === "MEMBER" ? "bg-black/[0.04]" : "bg-ink text-pearl",
                    )}
                  >
                    <p className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] opacity-60">
                      {m.internalNote && <Lock className="size-3" aria-hidden />}
                      {m.internalNote ? "Internal note" : m.senderType === "MEMBER" ? "Member" : "Concierge"} · {m.sender?.name ?? ""} · {formatDateTime(m.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap">{m.message}</p>
                    {m.attachmentKey && (
                      <a href={`/api/files/${m.attachmentKey}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs underline">
                        <Paperclip className="size-3" aria-hidden /> {m.attachmentName ?? "Attachment"}
                      </a>
                    )}
                  </li>
                ),
              )}
              {r.messages.length === 0 && <li className="text-sm text-black/45">No messages yet.</li>}
            </ol>
            {manage && (
              <div className="mt-5 border-t border-black/8 pt-5">
                <ActionForm action={staffConciergeMessageAction} submitLabel="Send" resetOnSuccess>
                  <input type="hidden" name="requestId" value={r.id} />
                  <TextArea tone="light" label="Message" name="message" required placeholder="Reply to the member, or add an internal note…" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Checkbox tone="light" name="internalNote" label="Internal note (never visible to the member)" />
                    <TextField tone="light" label="Attachment" name="attachment" type="file" className="[&_input]:h-10 [&_input]:pt-2" />
                  </div>
                </ActionForm>
              </div>
            )}
          </AdminCard>
        </div>

        <div className="space-y-6">
          {manage && (
            <AdminCard title="Manage">
              <ActionForm action={updateConciergeAction} submitLabel="Update">
                <input type="hidden" name="requestId" value={r.id} />
                <SelectField tone="light" label="Status" name="status" defaultValue={r.status} options={CONCIERGE_STATUSES.map((s) => ({ value: s, label: CONCIERGE_STATUS_STAFF_LABELS[s] }))} />
                <SelectField tone="light" label="Priority" name="priority" defaultValue={r.priority} options={CONCIERGE_PRIORITIES.map((p) => ({ value: p, label: p.toLowerCase() }))} />
                <SelectField tone="light" label="Assigned to" name="assignedToId" defaultValue={r.assignedTo?.id ?? ""} placeholder="Unassigned" options={team.map((t) => ({ value: t.id, label: t.name }))} />
              </ActionForm>
              <p className="mt-3 text-xs text-black/50">Confirmed, completed and “waiting for member” notify the member automatically.</p>
            </AdminCard>
          )}
          <AdminCard title="Member">
            <p className="font-display text-2xl">{member.firstName} {member.lastName}</p>
            <div className="mt-2 flex items-center gap-2">
              {membership && <TierBadge name={membership.tier.displayName} theme={membership.tier.cardTheme} />}
              <span className="font-mono text-xs text-black/50">{member.membershipNumber}</span>
            </div>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-black/50">Email</dt><dd className="truncate">{member.user.email}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-black/50">Mobile</dt><dd>{member.mobile ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-black/50">Dietary</dt><dd>{member.dietaryRequirements ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-black/50">Allergies</dt><dd>{member.allergies ?? "—"}</dd></div>
            </dl>
            {can(actor.role, "members:view") && (
              <Link href={`/admin/members/${member.id}`} className="mt-4 inline-block text-xs text-ruby">Open member record</Link>
            )}
          </AdminCard>
        </div>
      </div>
    </>
  );
}
