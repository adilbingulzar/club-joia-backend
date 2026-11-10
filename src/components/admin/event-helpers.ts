export type EventTicketTypeOption = { eventId: string; eventName: string; types: { id: string; name: string }[] };

/** Groups active ticket types by event for the picker. */
export function groupTicketTypesByEvent(types: { id: string; name: string; active: boolean; eventId: string; event: { name: string } }[]): EventTicketTypeOption[] {
  const map = new Map<string, EventTicketTypeOption>();
  for (const t of types) {
    if (!t.active) continue;
    const g = map.get(t.eventId) ?? { eventId: t.eventId, eventName: t.event.name, types: [] };
    g.types.push({ id: t.id, name: t.name });
    map.set(t.eventId, g);
  }
  return [...map.values()];
}

/**
 * Default event for event-scoped admin pages: the next published/live event that hasn't ended,
 * otherwise the most recent non-archived one. `events` may be in any order.
 */
export function defaultAdminEvent<T extends { id: string; status: string; start: string; end: string }>(events: T[], today = new Date().toISOString().slice(0, 10)): T | undefined {
  const upcoming = events
    .filter((e) => (e.status === "PUBLISHED" || e.status === "LIVE") && e.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  return upcoming ?? events.find((e) => e.status !== "ARCHIVED") ?? events[0];
}
