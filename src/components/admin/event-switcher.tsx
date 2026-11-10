import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Event tabs for event-scoped admin pages (programme, tickets). Each programme and every ticket
 * belongs to exactly one event, so these pages always work inside the selected event.
 */
export function EventSwitcher({
  events,
  activeId,
  href,
}: {
  events: { id: string; name: string; start: string; status: string }[];
  activeId: string | null;
  href: (eventId: string) => string;
}) {
  return (
    <nav aria-label="Choose event" className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
      {events.map((e) => {
        const active = e.id === activeId;
        return (
          <Link
            key={e.id}
            href={href(e.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-xl border px-4 py-2.5 transition-colors",
              active ? "border-ink bg-ink text-white" : "border-black/12 bg-white hover:border-black/30",
            )}
          >
            <span className="block text-sm font-medium">{e.name}</span>
            <span className={cn("block text-[10px] uppercase tracking-[0.16em]", active ? "text-white/60" : "text-black/45")}>
              {e.start.slice(0, 7)} · {e.status.toLowerCase()}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
