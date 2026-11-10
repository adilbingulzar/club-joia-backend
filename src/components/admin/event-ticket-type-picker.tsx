"use client";

import { useState } from "react";
import { SelectField } from "@/components/ui/form";

import type { EventTicketTypeOption } from "./event-helpers";

/** Event first, then one of that event's ticket types — tickets always belong to an event. */
export function EventTicketTypePicker({ options, defaultEventId }: { options: EventTicketTypeOption[]; defaultEventId?: string }) {
  const [eventId, setEventId] = useState(defaultEventId ?? (options.length === 1 ? options[0].eventId : ""));
  const event = options.find((o) => o.eventId === eventId);
  return (
    <>
      <SelectField
        tone="light"
        label="Event"
        name="eventId"
        className="min-w-56"
        value={eventId}
        onChange={(e) => setEventId(e.target.value)}
        placeholder="Choose event…"
        options={options.map((o) => ({ value: o.eventId, label: o.eventName }))}
      />
      <SelectField
        key={eventId}
        tone="light"
        label="Ticket type"
        name="ticketTypeId"
        className="min-w-56"
        disabled={!event}
        placeholder={event ? (event.types.length ? "Choose ticket type…" : "No active ticket types") : "Choose an event first"}
        options={event?.types.map((t) => ({ value: t.id, label: t.name })) ?? []}
      />
    </>
  );
}
