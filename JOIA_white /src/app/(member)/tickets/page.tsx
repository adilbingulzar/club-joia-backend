import type { Metadata } from "next";
import { Suspense } from "react";
import { Ticket } from "lucide-react";
import { requireMember } from "@/lib/auth/dal";
import { listMyTickets } from "@/services/ticket.service";
import { TicketCard } from "@/components/joia/ticket-card";
import { EmptyState, PageLoading } from "@/components/joia/states";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsPage() {
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Access credentials</p>
        <h1 className="display mt-2 text-5xl">Tickets</h1>
      </header>
      <Suspense fallback={<PageLoading label="Loading tickets" />}>
        <TicketList />
      </Suspense>
    </div>
  );
}

async function TicketList() {
  const actor = await requireMember();
  const tickets = await listMyTickets(actor);
  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={<Ticket />}
        title="No tickets yet"
        description="CLUB JOIA will issue your access credentials ahead of the weekend. We’ll notify you the moment they’re ready."
        action={{ href: "/concierge/new", label: "Ask concierge" }}
      />
    );
  }
  const byEvent = Map.groupBy(tickets, (t) => t.event.name);
  return (
    <div className="space-y-8">
      {[...byEvent.entries()].map(([eventName, list]) => (
        <section key={eventName} aria-label={eventName}>
          <p className="eyebrow mb-3">{eventName}</p>
          <div className="space-y-3">
            {list.map((t) => (
              <TicketCard key={t.id} ticket={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
