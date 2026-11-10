import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listChapters, listEventsAdmin } from "@/services/event.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { LoadingSkeleton } from "@/components/joia/states";
import { Checkbox, SelectField, TextArea, TextField } from "@/components/ui/form";
import { createEventAction } from "../../actions";

export const metadata: Metadata = { title: "New event" };

export default function NewEventPage() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <NewEvent />
    </Suspense>
  );
}

async function NewEvent() {
  const actor = await requirePermissionPage("events:manage");
  const [events, chapters] = await Promise.all([listEventsAdmin(actor), listChapters()]);
  return (
    <>
      <AdminPageHeader
        eyebrow="Events"
        title="Create new event"
        description="New events start as drafts — members only see an event once you set its status to published. After creating it, add access zones, ticket types and the programme."
        actions={<Link href="/admin/events" className="text-sm text-black/55 hover:text-ink">Cancel</Link>}
      />
      <AdminCard className="max-w-4xl">
        <ActionForm action={createEventAction} submitLabel="Create event">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField tone="light" label="Event name" name="name" required placeholder="e.g. Monaco Grand Prix 2027" className="md:col-span-2" />
            <TextField tone="light" label="Tagline" name="tagline" placeholder="e.g. Grand Prix Weekend" hint="Shown under the city on the member event card." />
            <TextField tone="light" label="Web address (slug)" name="slug" placeholder="monaco-2027" hint="Optional — generated from the name. Lowercase letters, numbers, dashes." />
            <TextField tone="light" label="Venue" name="venue" required />
            <TextField tone="light" label="City" name="city" required />
            <TextField tone="light" label="Country" name="country" required />
            <TextField tone="light" label="Timezone (IANA)" name="timezone" required placeholder="Europe/Monaco" hint="Programme times and ticket windows use this zone." />
            <TextField tone="light" label="Start date" name="startDate" type="date" required />
            <TextField tone="light" label="End date" name="endDate" type="date" required />
            <TextField tone="light" label="Ticket number prefix" name="ticketPrefix" placeholder="MC27" hint="Up to 6 letters/numbers, e.g. MC27 → MC27-FRI-XXXXXX." />
            <SelectField tone="light" label="Chapter" name="chapterId" placeholder="No chapter" options={chapters.map((c) => ({ value: c.id, label: c.name }))} />
            <TextArea tone="light" label="Description" name="description" className="md:col-span-2" />
            <TextField tone="light" label="Support email" name="supportEmail" type="email" />
            <TextField tone="light" label="Support phone" name="supportPhone" />
            <TextField tone="light" label="Dress code" name="dressCode" className="md:col-span-2" />
            <ImageUploadField name="heroImage" label="Hero image" className="max-w-xl md:col-span-2" />
          </div>
          <fieldset className="rounded-xl border border-black/10 p-4">
            <legend className="px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-black/60">Start from an existing event (optional)</legend>
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField tone="light" label="Copy setup from" name="cloneFromEventId" placeholder="Start empty" options={events.map((e) => ({ value: e.id, label: e.name }))} hint="Copies access zones and ticket types; ticket windows shift to the new dates." />
              <div className="pt-7">
                <Checkbox tone="light" name="cloneProgramme" label="Also copy the programme" description="Copied items are drafts; only days within the new dates are copied." />
              </div>
            </div>
          </fieldset>
        </ActionForm>
      </AdminCard>
    </>
  );
}
