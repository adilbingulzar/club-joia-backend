import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarDays } from "lucide-react";
import { requireMember } from "@/lib/auth/dal";
import { listMemberEvents } from "@/services/event.service";
import { EventHero } from "@/components/joia/event-hero";
import { EmptyState, PageLoading } from "@/components/joia/states";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">The club calendar</p>
        <h1 className="display mt-2 text-5xl">Events</h1>
      </header>
      <Suspense fallback={<PageLoading label="Loading events" variant="hero" />}>
        <EventsList />
      </Suspense>
    </div>
  );
}

async function EventsList() {
  await requireMember();
  const events = await listMemberEvents();
  if (events.length === 0) {
    return <EmptyState icon={<CalendarDays />} title="No events yet" description="Your next CLUB JOIA 300 experience will appear here." />;
  }
  return (
    <div className="space-y-5">
      {events.map((e) => (
        <EventHero key={e.id} city={e.city} title={e.info.tagline ?? e.name} start={e.start} end={e.end} heroImage={e.heroImageUrl} href={`/events/${e.slug}`} />
      ))}
      <p className="pt-2 text-center text-[10px] uppercase tracking-[0.3em] text-pearl-dim">More chapters to be announced</p>
    </div>
  );
}
