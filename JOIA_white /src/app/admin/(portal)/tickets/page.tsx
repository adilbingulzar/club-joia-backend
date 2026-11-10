import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { listTicketTypes, searchTickets } from "@/services/ticket.service";
import { listEventsAdmin } from "@/services/event.service";
import { EventSwitcher } from "@/components/admin/event-switcher";
import { defaultAdminEvent } from "@/components/admin/event-helpers";
import { buttonClasses } from "@/components/ui/button-styles";
import { EmptyState } from "@/components/joia/states";
import { listTiers } from "@/services/membership.service";
import { AdminCard, AdminDataTable, AdminPageHeader, FilterBar, FilterInput, FilterSelect } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { SelectField } from "@/components/ui/form";
import { formatDateTime } from "@/lib/utils";
import { sp, spEnum, spPage, withParams, type SP } from "@/lib/search-params";
import { TICKET_STATUSES } from "@/validators/admin";
import { bulkIssueAction } from "../actions";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsAdminPage({ searchParams }: PageProps<"/admin/tickets">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Tickets searchParams={searchParams} />
    </Suspense>
  );
}

async function Tickets({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("tickets:view");
  const params = await searchParams;
  const events = await listEventsAdmin(actor);
  if (events.length === 0) {
    return <EmptyState tone="light" title="No events yet" description="Tickets always belong to an event. Create the event and its ticket types first." action={{ href: "/admin/events/new", label: "Create new event" }} />;
  }
  const requested = sp(params, "event");
  const event = events.find((e) => e.id === requested) ?? defaultAdminEvent(events)!;
  const [data, types, tiers] = await Promise.all([
    searchTickets(actor, { eventId: event.id, q: sp(params, "q"), status: spEnum(params, "status", TICKET_STATUSES), ticketTypeId: sp(params, "type"), page: spPage(params) }),
    listTicketTypes(event.id),
    listTiers(),
  ]);
  const base = `/admin/tickets?event=${event.id}`;
  return (
    <>
      <AdminPageHeader
        eyebrow="Tickets"
        title={event.name}
        description={`${data.total} ticket${data.total === 1 ? "" : "s"} for this event. Issue individual tickets from a member's page.`}
        actions={
          can(actor.role, "events:manage") ? (
            <Link href={`/admin/events/${event.id}#ticket-types`} className={buttonClasses("secondary", "sm")}>
              Edit ticket types
            </Link>
          ) : undefined
        }
      />
      <EventSwitcher events={events} activeId={event.id} href={(id) => `/admin/tickets?event=${id}`} />
      <AdminCard title="Ticket types for this event" className="mb-6">
        {types.length === 0 ? (
          <p className="text-sm text-black/55">
            No ticket types yet.{" "}
            {can(actor.role, "events:manage") && <Link href={`/admin/events/${event.id}#ticket-types`} className="text-ruby">Add the first ticket type →</Link>}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {types.map((t) => (
              <li key={t.id}>
                <Link href={`${base}&type=${t.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-black/8 px-3 py-2.5 text-sm hover:border-black/25">
                  <span className="min-w-0">
                    <span className="font-medium">{t.name}</span> <span className="font-mono text-xs text-black/45">{t.code}</span>
                    <span className="block truncate text-xs text-black/50">{t.zones.map((z) => z.zone.name).join(", ") || "No zones"}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-black/55">
                    {t._count.tickets} issued
                    {!t.active && <span className="block text-ruby">inactive</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
      {can(actor.role, "tickets:manage") && types.some((t) => t.active) && (
        <AdminCard title="Bulk issue" className="mb-6">
          <ActionForm action={bulkIssueAction} submitLabel="Issue to eligible members" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="eventId" value={event.id} />
            <SelectField tone="light" label="Ticket type" name="ticketTypeId" className="min-w-72" placeholder="Choose…" options={types.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))} />
            <SelectField tone="light" label="Only tier" name="tierId" className="min-w-48" placeholder="All active members" options={tiers.map((t) => ({ value: t.id, label: t.displayName }))} />
          </ActionForm>
          <p className="mt-3 text-xs text-black/50">Issues one ticket to every active member (optionally of one tier) who doesn’t already hold this type, and notifies them.</p>
        </AdminCard>
      )}
      <FilterBar action="/admin/tickets">
        <input type="hidden" name="event" value={event.id} />
        <FilterInput label="Search" name="q" defaultValue={sp(params, "q")} placeholder="Ticket number, member name or number" />
        <FilterSelect label="Type" name="type" defaultValue={sp(params, "type")} options={types.map((t) => ({ value: t.id, label: t.name }))} />
        <FilterSelect label="Status" name="status" defaultValue={sp(params, "status")} options={TICKET_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
      </FilterBar>
      <AdminDataTable
        caption="Tickets"
        rows={data.rows}
        rowKey={(t) => t.id}
        empty="No tickets match."
        pagination={{ page: data.page, pageSize: data.pageSize, total: data.total, href: (p) => withParams("/admin/tickets", params, { page: p }) }}
        columns={[
          { header: "Ticket", cell: (t) => <Link href={`/admin/tickets/${t.id}`} className="font-mono text-xs hover:text-ruby">{t.ticketNumber}</Link> },
          { header: "Member", cell: (t) => <Link href={`/admin/members/${t.member.id}`} className="hover:text-ruby">{t.member.firstName} {t.member.lastName}</Link> },
          { header: "Type", cell: (t) => t.ticketType.name },
          { header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
          { header: "Check-ins", cell: (t) => t._count.checkIns, className: "text-right" },
          { header: "Issued", cell: (t) => <span className="text-xs text-black/55">{formatDateTime(t.issuedAt)}</span> },
        ]}
      />
    </>
  );
}
