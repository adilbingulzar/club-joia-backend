import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listEventsAdmin } from "@/services/event.service";
import { listProgrammeAdmin } from "@/services/programme.service";
import { listEntitlementCatalogue } from "@/services/entitlement.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { EventSwitcher } from "@/components/admin/event-switcher";
import { defaultAdminEvent } from "@/components/admin/event-helpers";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { ProgrammeIcon } from "@/components/joia/programme-icon";
import { PROGRAMME_ICONS, PROGRAMME_ICON_KEYS } from "@/domain/programme-icons";
import { storedImageUrl } from "@/lib/files";
import { StatusBadge } from "@/components/joia/badges";
import { EmptyState, LoadingSkeleton } from "@/components/joia/states";
import { SelectField, TextArea, TextField } from "@/components/ui/form";
import { buttonClasses } from "@/components/ui/button-styles";
import { categoryStyles } from "@/styles/design-tokens";
import { formatDateOnly } from "@/lib/time";
import { sp, type SP } from "@/lib/search-params";
import { PROGRAM_CATEGORIES, PROGRAM_VISIBILITIES } from "@/validators/admin";
import { saveProgrammeItemAction } from "../actions";
import { ProgrammeRowControls } from "./row-controls";

export const metadata: Metadata = { title: "Programme" };

export default function ProgrammeAdminPage({ searchParams }: PageProps<"/admin/programme">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Programme searchParams={searchParams} />
    </Suspense>
  );
}

async function Programme({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("programme:manage");
  const params = await searchParams;
  const events = await listEventsAdmin(actor);
  if (events.length === 0) {
    return (
      <EmptyState
        tone="light"
        title="No events yet"
        description="Every programme belongs to an event. Create the event first."
        action={{ href: "/admin/events/new", label: "Create new event" }}
      />
    );
  }
  const requested = sp(params, "event");
  const eventId = (events.find((e) => e.id === requested) ?? defaultAdminEvent(events)!).id;
  const [data, catalogue] = await Promise.all([listProgrammeAdmin(actor, eventId), listEntitlementCatalogue()]);
  const editId = sp(params, "edit");
  const editing = editId === "new" ? null : data.items.find((i) => i.id === editId);
  const showForm = editId === "new" || Boolean(editing);
  const base = `/admin/programme?event=${eventId}`;

  return (
    <>
      <AdminPageHeader
        eyebrow="Programme"
        title={data.event.name}
        description={`All member-facing times come from here, local to ${data.event.timezone}. Draft items are hidden from members; restricted items show only to members holding the chosen entitlement.`}
        actions={
          <Link href={`${base}&edit=new`} className={buttonClasses("primary", "sm")}>
            <Plus className="size-4" aria-hidden /> Add item to this event
          </Link>
        }
      />
      <EventSwitcher events={events} activeId={eventId} href={(id) => `/admin/programme?event=${id}`} />
      {data.items.some((i) => i.isSample) && (
        <p className="mb-5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Items marked <strong>sample</strong> are seeded placeholder content. Editing an item clears the flag; members see “Provisional programme” while any remain.
        </p>
      )}
      <div className={showForm ? "grid gap-6 xl:grid-cols-[1fr_440px]" : ""}>
        <div className={showForm ? "grid gap-6 2xl:grid-cols-2" : "grid gap-6 lg:grid-cols-3"}>
          {data.days.map((day) => {
            const items = data.items.filter((i) => i.date === day);
            return (
              <AdminCard key={day} title={formatDateOnly(day, { weekday: "long", day: "numeric", month: "short" })}>
                {items.length === 0 && <p className="text-sm text-black/45">No items.</p>}
                <ol className="space-y-2">
                  {items.map((i, idx) => (
                    <li key={i.id} className="rounded-xl border border-black/8 p-3">
                      <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                      <p className="text-xs tabular-nums text-black/55">
                        {i.startTime}
                        {i.endTime && `–${i.endTime}`}
                        <span className="ml-2" style={{ color: `color-mix(in srgb, ${categoryStyles[i.category]?.color ?? "#888"} 55%, black)` }}>
                          {categoryStyles[i.category]?.label}
                        </span>
                      </p>
                      <Link href={`${base}&edit=${i.id}`} className="mt-0.5 block font-medium leading-snug hover:text-ruby">
                        {i.title}
                      </Link>
                      </div>
                      <ProgrammeIcon item={i} color={categoryStyles[i.category]?.color ?? "#888"} size="xs" />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge status={i.visibility} label={i.visibility === "MEMBERS" ? "published" : i.visibility.toLowerCase()} />
                          {i.isSample && <StatusBadge status="SAMPLE" label="sample" tone="warning" />}
                          {i.favorites > 0 && <span className="text-[10px] text-black/45">★ {i.favorites}</span>}
                        </div>
                        <ProgrammeRowControls id={i.id} visibility={i.visibility} restricted={Boolean(i.requiredEntitlementCode)} first={idx === 0} last={idx === items.length - 1} />
                      </div>
                    </li>
                  ))}
                </ol>
              </AdminCard>
            );
          })}
        </div>

        {showForm && (
          <AdminCard title={editing ? "Edit item" : "New item"} actions={<Link href={base} className="text-xs text-black/50 hover:text-ink">Close</Link>} className="h-fit xl:sticky xl:top-6">
            <ActionForm action={saveProgrammeItemAction} submitLabel={editing ? "Save item" : "Add item"} key={editId}>
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <input type="hidden" name="eventId" value={eventId} />
              <TextField tone="light" label="Title" name="title" defaultValue={editing?.title} required />
              <TextField tone="light" label="Subtitle" name="subtitle" defaultValue={editing?.subtitle ?? ""} />
              <div className="grid grid-cols-3 gap-3">
                <SelectField tone="light" label="Day" name="date" defaultValue={editing?.date ?? data.days[0]} options={data.days.map((d) => ({ value: d, label: formatDateOnly(d, { weekday: "short", day: "numeric" }) }))} />
                <TextField tone="light" label="Start" name="startTime" type="time" defaultValue={editing?.startTime ?? "12:00"} required />
                <TextField tone="light" label="End" name="endTime" type="time" defaultValue={editing?.endTime ?? ""} />
              </div>
              <TextField tone="light" label="Location" name="location" defaultValue={editing?.location ?? ""} />
              <div className="grid grid-cols-2 gap-3">
                <SelectField tone="light" label="Category" name="category" defaultValue={editing?.category ?? "HOSPITALITY"} options={PROGRAM_CATEGORIES.map((c) => ({ value: c, label: categoryStyles[c]?.label ?? c }))} />
                <SelectField tone="light" label="Icon" name="icon" defaultValue={editing?.icon ?? ""} placeholder="Automatic (from title)" options={PROGRAMME_ICON_KEYS.map((k) => ({ value: k, label: PROGRAMME_ICONS[k].label }))} />
              </div>
              <TextArea tone="light" label="Description" name="description" defaultValue={editing?.description ?? ""} />
              <div className="grid grid-cols-2 gap-3">
                <SelectField tone="light" label="Visibility" name="visibility" defaultValue={editing?.visibility ?? "DRAFT"} options={PROGRAM_VISIBILITIES.map((v) => ({ value: v, label: v === "MEMBERS" ? "published — all members" : v === "RESTRICTED" ? "published — entitlement only" : "draft" }))} />
                <SelectField tone="light" label="Restricted to" name="requiredEntitlementCode" defaultValue={editing?.requiredEntitlementCode ?? ""} placeholder="—" options={catalogue.map((e) => ({ value: e.code, label: e.name }))} />
              </div>
              <TextField tone="light" label="Capacity" name="capacity" type="number" defaultValue={editing?.capacity ?? ""} />
              <ImageUploadField name="image" label="Image (optional)" currentUrl={storedImageUrl(editing?.image)} />
            </ActionForm>
          </AdminCard>
        )}
      </div>
    </>
  );
}
