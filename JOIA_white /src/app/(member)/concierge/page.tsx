import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConciergeBell, Plus } from "lucide-react";
import { requireMember } from "@/lib/auth/dal";
import { listMyRequests } from "@/services/concierge.service";
import { OPEN_CONCIERGE_STATUSES } from "@/domain/concierge";
import { ConciergeRequestCard } from "@/components/joia/concierge-request-card";
import { EmptyState, PageLoading } from "@/components/joia/states";
import { buttonClasses } from "@/components/ui/button-styles";

export const metadata: Metadata = { title: "Concierge" };

export default function ConciergePage() {
  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">At your service</p>
          <h1 className="display mt-2 text-5xl">Concierge</h1>
        </div>
        <Link href="/concierge/new" className={buttonClasses("primary", "sm")}>
          <Plus className="size-4" aria-hidden /> Request
        </Link>
      </header>
      <Suspense fallback={<PageLoading label="Loading requests" />}>
        <Requests />
      </Suspense>
    </div>
  );
}

async function Requests() {
  const actor = await requireMember();
  const requests = await listMyRequests(actor);
  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<ConciergeBell />}
        title="How may we help?"
        description="Transfers, tables, yachts, hotels — tell us what you need and the CLUB JOIA concierge team will take care of it."
        action={{ href: "/concierge/new", label: "Make a request" }}
      />
    );
  }
  const open = requests.filter((r) => OPEN_CONCIERGE_STATUSES.includes(r.status));
  const closed = requests.filter((r) => !OPEN_CONCIERGE_STATUSES.includes(r.status));
  return (
    <div className="space-y-8">
      {open.length > 0 && (
        <section aria-label="Open requests" className="space-y-3">
          <p className="eyebrow">Open</p>
          {open.map((r) => (
            <ConciergeRequestCard key={r.id} request={r} />
          ))}
        </section>
      )}
      {closed.length > 0 && (
        <section aria-label="Past requests" className="space-y-3">
          <p className="eyebrow">Past</p>
          {closed.map((r) => (
            <ConciergeRequestCard key={r.id} request={r} />
          ))}
        </section>
      )}
    </div>
  );
}
