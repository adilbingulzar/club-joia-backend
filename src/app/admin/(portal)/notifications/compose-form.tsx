"use client";

import { useState } from "react";
import { ActionForm } from "@/components/admin/action-controls";
import { Checkbox, SelectField, TextArea, TextField } from "@/components/ui/form";
import { sendNotificationAction } from "../actions";

type Opt = { value: string; label: string };

const TEMPLATES = [
  { title: "Welcome to CLUB JOIA 300", body: "Your membership card and Abu Dhabi credentials are ready in the app.", type: "ANNOUNCEMENT" },
  { title: "Your Friday access credential is ready", body: "Your Friday access credential is now available.", type: "TICKET" },
  { title: "VIP Yacht Lunch", body: "VIP Yacht Lunch begins at 12:30.", type: "PROGRAMME" },
  { title: "Transport update", body: "Sunday transport departure has changed. Please check the programme.", type: "TRANSPORT" },
];

export function ComposeForm({ tiers, events, members, pushConfigured }: { tiers: Opt[]; events: Opt[]; members: Opt[]; pushConfigured: boolean }) {
  const [target, setTarget] = useState("ALL_MEMBERS");
  const [tpl, setTpl] = useState<(typeof TEMPLATES)[number] | null>(null);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TEMPLATES.map((t) => (
          <button key={t.title} type="button" onClick={() => setTpl(t)} className="rounded-full border border-black/12 px-2.5 py-1 text-[11px] text-black/60 hover:border-ink hover:text-ink">
            {t.title}
          </button>
        ))}
      </div>
      <ActionForm action={sendNotificationAction} submitLabel="Send / schedule" resetOnSuccess>
        <div key={tpl?.title ?? "blank"} className="space-y-4">
          <TextField tone="light" label="Title" name="title" required maxLength={80} defaultValue={tpl?.title} />
          <TextArea tone="light" label="Message" name="body" required maxLength={300} defaultValue={tpl?.body} />
          <SelectField
            tone="light"
            label="Type"
            name="type"
            defaultValue={tpl?.type ?? "ANNOUNCEMENT"}
            options={["ANNOUNCEMENT", "PROGRAMME", "TICKET", "CONCIERGE", "TRANSPORT", "MEMBERSHIP"].map((t) => ({ value: t, label: t.toLowerCase() }))}
          />
        </div>
        <SelectField
          tone="light"
          label="Audience"
          name="targetType"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          options={[
            { value: "ALL_MEMBERS", label: "All active members" },
            { value: "TIER", label: "A membership tier" },
            { value: "EVENT", label: "Ticket holders of an event" },
            { value: "MEMBER", label: "An individual member" },
          ]}
        />
        {target === "TIER" && <SelectField tone="light" label="Tier" name="tierId" options={tiers} />}
        {target === "EVENT" && <SelectField tone="light" label="Event" name="eventId" options={events} />}
        {target === "MEMBER" && <SelectField tone="light" label="Member" name="memberId" options={members} />}
        <TextField tone="light" label="Open in app (optional)" name="url" placeholder="/events/abu-dhabi-2026" />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-black/60">Channels</legend>
          <Checkbox tone="light" name="channels[]" value="IN_APP" defaultChecked label="In-app notification centre" />
          <Checkbox tone="light" name="channels[]" value="WEB_PUSH" defaultChecked={pushConfigured} disabled={!pushConfigured} label="Web push" description={pushConfigured ? undefined : "VAPID keys not configured."} />
        </fieldset>
        <TextField tone="light" label="Schedule (optional, Abu Dhabi time)" name="scheduledAt" type="datetime-local" hint="Leave empty to send now." />
      </ActionForm>
    </>
  );
}
