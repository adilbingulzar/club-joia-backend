import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { listEventsAdmin } from "@/services/event.service";
import { AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { buttonClasses } from "@/components/ui/button-styles";

export const metadata: Metadata = { title: "Events" };

export default function EventsAdminPage() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={3} />}>
      <List />
    </Suspense>
  );
}

async function List() {
  const actor = await requirePermissionPage("programme:manage");
  const events = await listEventsAdmin(actor);
  return (
    <>
      <AdminPageHeader
        eyebrow="Global events"
        title="Events"
        description="Every CLUB JOIA experience is an event with its own access zones, ticket types and programme."
        actions={
          can(actor.role, "events:manage") ? (
            <Link href="/admin/events/new" className={buttonClasses("primary", "sm")}>
              <Plus className="size-4" aria-hidden /> Create new event
            </Link>
          ) : undefined
        }
      />
      <AdminDataTable
        caption="Events"
        rows={events}
        rowKey={(e) => e.id}
        empty="No events yet."
        columns={[
          { header: "Event", cell: (e) => <Link href={`/admin/events/${e.id}`} className="font-medium hover:text-ruby">{e.name}</Link> },
          { header: "Chapter", cell: (e) => e.chapter?.name ?? "—" },
          { header: "Dates", cell: (e) => `${e.start} → ${e.end}` },
          { header: "Timezone", cell: (e) => <span className="font-mono text-xs">{e.timezone}</span> },
          { header: "Status", cell: (e) => <StatusBadge status={e.status} /> },
          { header: "Programme", cell: (e) => <Link href={`/admin/programme?event=${e.id}`} className="text-ruby">{e._count.programItems} items</Link> },
          { header: "Ticket types", cell: (e) => <Link href={`/admin/events/${e.id}#ticket-types`} className="text-ruby">{e._count.ticketTypes}</Link>, className: "text-right" },
          { header: "Tickets", cell: (e) => <Link href={`/admin/tickets?event=${e.id}`} className="text-ruby">{e._count.tickets}</Link>, className: "text-right" },
        ]}
      />
    </>
  );
}
