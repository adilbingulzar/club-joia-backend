import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Ticket } from "lucide-react";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { isAppError } from "@/lib/errors";
import { formatInZone } from "@/lib/time";
import { getEventAdmin } from "@/services/event.service";
import { listEntitlementCatalogue } from "@/services/entitlement.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { buttonClasses } from "@/components/ui/button-styles";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { Checkbox, Notice, SelectField, TextArea, TextField } from "@/components/ui/form";
import { ENTRY_POLICIES, EVENT_STATUSES } from "@/validators/admin";
import { updateEventAction, upsertTicketTypeAction, upsertZoneAction } from "../../actions";

export const metadata: Metadata = { title: "Event" };

export default function EventDetailPage({ params }: PageProps<"/admin/events/[id]">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={5} />}>
      <Detail params={params} />
    </Suspense>
  );
}

/** "YYYY-MM-DDTHH:mm" in the event timezone, for datetime-local inputs. */
function localInput(d: Date, tz: string) {
  const p = (o: Intl.DateTimeFormatOptions) => formatInZone(d, tz, o, "en-CA");
  return `${p({ year: "numeric", month: "2-digit", day: "2-digit" })}T${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

async function Detail({ params }: Pick<PageProps<"/admin/events/[id]">, "params">) {
  const actor = await requirePermissionPage("programme:manage");
  const { id } = await params;
  let e;
  try {
    e = await getEventAdmin(actor, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const canConfigure = can(actor.role, "events:manage");
  const catalogue = await listEntitlementCatalogue();
  const entOptions = catalogue.map((c) => ({ value: c.code, label: c.name }));

  return (
    <>
      <AdminPageHeader
        eyebrow={e.chapter?.name ?? "Event"}
        title={e.name}
        description={<StatusBadge status={e.status} />}
        actions={
          <>
            <Link href={`/admin/programme?event=${e.id}`} className={buttonClasses("secondary", "sm")}>
              <CalendarDays className="size-4" aria-hidden /> Programme
            </Link>
            <Link href={`/admin/tickets?event=${e.id}`} className={buttonClasses("secondary", "sm")}>
              <Ticket className="size-4" aria-hidden /> Tickets
            </Link>
          </>
        }
      />
      {!canConfigure && (
        <div className="mb-6">
          <Notice tone="light" title="Read-only">Event configuration (dates, zones, ticket types) is managed by super admins. You can edit the programme.</Notice>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <AdminCard title="Event details">
          <ActionForm action={updateEventAction} submitLabel="Save event">
            <fieldset disabled={!canConfigure} className="grid gap-4 md:grid-cols-2">
              <input type="hidden" name="id" value={e.id} />
              <TextField tone="light" label="Name" name="name" defaultValue={e.name} className="md:col-span-2" />
              <TextField tone="light" label="Tagline" name="tagline" defaultValue={e.info.tagline ?? ""} />
              <TextField tone="light" label="Ticket number prefix" name="ticketPrefix" defaultValue={e.info.ticketPrefix ?? ""} hint="Applies to tickets issued from now on." />
              <TextField tone="light" label="Venue" name="venue" defaultValue={e.venue} />
              <TextField tone="light" label="City" name="city" defaultValue={e.city} />
              <TextField tone="light" label="Country" name="country" defaultValue={e.country} />
              <TextField tone="light" label="Timezone (IANA)" name="timezone" defaultValue={e.timezone} />
              <TextField tone="light" label="Start date" name="startDate" type="date" defaultValue={e.start} />
              <TextField tone="light" label="End date" name="endDate" type="date" defaultValue={e.end} />
              <SelectField tone="light" label="Status" name="status" defaultValue={e.status} options={EVENT_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))} />
              <TextArea tone="light" label="Description" name="description" defaultValue={e.description ?? ""} className="md:col-span-2" />
              <TextField tone="light" label="Support email" name="supportEmail" defaultValue={e.info.supportEmail ?? ""} />
              <TextField tone="light" label="Support phone" name="supportPhone" defaultValue={e.info.supportPhone ?? ""} />
              <TextField tone="light" label="Dress code" name="dressCode" defaultValue={e.info.dressCode ?? ""} className="md:col-span-2" />
              <ImageUploadField name="heroImage" label="Hero image" currentUrl={e.heroImageUrl} className="max-w-xl md:col-span-2" disabled={!canConfigure} />
            </fieldset>
          </ActionForm>
        </AdminCard>

        <AdminCard title="Access zones">
          <ul className="mb-6 divide-y divide-black/6 text-sm">
            {e.zones.map((z) => (
              <li key={z.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between gap-3">
                    <span>
                      <span className="font-medium">{z.name}</span> <span className="font-mono text-xs text-black/45">{z.code}</span>
                      {z.requiredEntitlementCode && <span className="ml-2 text-xs text-black/50">requires {z.requiredEntitlementCode}</span>}
                    </span>
                    <StatusBadge status={z.active ? "ACTIVE" : "DISABLED"} label={z.active ? "open" : "closed"} />
                  </summary>
                  {canConfigure && (
                    <ActionForm action={upsertZoneAction} submitLabel="Save zone" className="mt-3 grid gap-3 md:grid-cols-2">
                      <input type="hidden" name="id" value={z.id} />
                      <input type="hidden" name="eventId" value={e.id} />
                      <TextField tone="light" label="Code" name="code" defaultValue={z.code} />
                      <TextField tone="light" label="Name" name="name" defaultValue={z.name} />
                      <TextField tone="light" label="Description" name="description" defaultValue={z.description ?? ""} />
                      <SelectField tone="light" label="Requires entitlement" name="requiredEntitlementCode" defaultValue={z.requiredEntitlementCode ?? ""} placeholder="None" options={entOptions} />
                      <Checkbox tone="light" name="active" defaultChecked={z.active} label="Checkpoint open" />
                    </ActionForm>
                  )}
                </details>
              </li>
            ))}
          </ul>
          {canConfigure && (
            <details>
              <summary className="cursor-pointer text-sm text-ruby">Add zone</summary>
              <ActionForm action={upsertZoneAction} submitLabel="Add zone" className="mt-3 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="eventId" value={e.id} />
                <TextField tone="light" label="Code" name="code" placeholder="e.g. BEACH_CLUB" />
                <TextField tone="light" label="Name" name="name" />
                <TextField tone="light" label="Description" name="description" />
                <SelectField tone="light" label="Requires entitlement" name="requiredEntitlementCode" placeholder="None" options={entOptions} />
                <Checkbox tone="light" name="active" defaultChecked label="Checkpoint open" />
              </ActionForm>
            </details>
          )}
        </AdminCard>
      </div>

      <AdminCard title="Ticket types" className="mt-6 scroll-mt-6" id="ticket-types">
        <p className="mb-4 text-xs text-black/50">Validity times are in {e.timezone}. Entry policy: single = once per zone; daily = once per zone per day; multi = re-entry allowed.</p>
        <div className="space-y-3">
          {[...e.ticketTypes, null].map((tt) => (
            <details key={tt?.id ?? "new"} className="rounded-xl border border-black/8 p-4">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                {tt ? (
                  <>
                    <span>
                      <span className="font-medium">{tt.name}</span> <span className="font-mono text-xs text-black/45">{tt.code}</span>
                      <span className="ml-2 text-xs text-black/50">{tt.zones.map((z) => z.zone.name).join(", ")} · {tt.entryPolicy.toLowerCase().replace("_", " ")}</span>
                    </span>
                    <span className="text-xs text-black/50">{tt._count.tickets} issued</span>
                  </>
                ) : (
                  <span className="text-ruby">{canConfigure ? "Add ticket type" : ""}</span>
                )}
              </summary>
              {canConfigure && (
                <ActionForm action={upsertTicketTypeAction} submitLabel={tt ? "Save ticket type" : "Add ticket type"} className="mt-4 grid gap-3 md:grid-cols-3">
                  {tt && <input type="hidden" name="id" value={tt.id} />}
                  <input type="hidden" name="eventId" value={e.id} />
                  <TextField tone="light" label="Code" name="code" defaultValue={tt?.code} />
                  <TextField tone="light" label="Name" name="name" defaultValue={tt?.name} />
                  <SelectField tone="light" label="Entry policy" name="entryPolicy" defaultValue={tt?.entryPolicy ?? "MULTI_ENTRY"} options={ENTRY_POLICIES.map((p) => ({ value: p, label: p.toLowerCase().replace("_", " ") }))} />
                  <TextField tone="light" label="Valid from" name="validFrom" type="datetime-local" defaultValue={tt ? localInput(tt.validFrom, e.timezone) : `${e.start}T09:00`} />
                  <TextField tone="light" label="Valid until" name="validUntil" type="datetime-local" defaultValue={tt ? localInput(tt.validUntil, e.timezone) : `${e.end}T23:59`} />
                  <TextField tone="light" label="Description" name="description" defaultValue={tt?.description ?? ""} />
                  <fieldset className="md:col-span-3">
                    <legend className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/55">Zones covered</legend>
                    <div className="flex flex-wrap gap-4">
                      {e.zones.map((z) => (
                        <Checkbox key={z.id} tone="light" name="zoneIds[]" value={z.id} defaultChecked={tt?.zones.some((x) => x.zoneId === z.id)} label={z.name} />
                      ))}
                    </div>
                  </fieldset>
                  <Checkbox tone="light" name="active" defaultChecked={tt?.active ?? true} label="Active (can be issued)" />
                </ActionForm>
              )}
            </details>
          ))}
        </div>
      </AdminCard>
    </>
  );
}
