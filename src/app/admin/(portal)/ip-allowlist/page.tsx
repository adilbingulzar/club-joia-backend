import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listIpAllowlist } from "@/services/ip-allowlist.service";
import { AdminCard, AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionButton, ActionForm } from "@/components/admin/action-controls";
import { LoadingSkeleton } from "@/components/joia/states";
import { TextField } from "@/components/ui/form";
import { addIpAllowlistAction, removeIpAllowlistAction } from "../actions";

export const metadata: Metadata = { title: "IP allowlist" };

export default function IpAllowlistPage() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={5} />}>
      <IpAllowlist />
    </Suspense>
  );
}

async function IpAllowlist() {
  const actor = await requirePermissionPage("settings:manage");
  const { entries } = await listIpAllowlist(actor);
  return (
    <>
      <AdminPageHeader eyebrow="Security" title="IP allowlist" description="Only the IPs on this list can open this site. Nobody else can." />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <AdminDataTable
            caption="Allowed IPs"
            rows={entries}
            rowKey={(e) => e.id}
            empty="No IPs yet."
            columns={[
              { header: "IP", cell: (e) => <span className="font-mono text-sm">{e.address}</span> },
              { header: "Name", cell: (e) => (e.label ? <span>{e.label}</span> : <span className="text-black/35">—</span>) },
              {
                header: "",
                cell: (e) => (
                  <ActionButton
                    label="Remove"
                    variant="ghost"
                    run={removeIpAllowlistAction.bind(null, e.id)}
                    confirm={{ title: `Remove ${e.address}?`, description: "This IP won't be able to open the site any more.", destructive: true }}
                  />
                ),
              },
            ]}
          />
          <p className="text-xs text-black/50">Before the event, add the venue Wi-Fi IP, or the door scanner won&apos;t open.</p>
        </div>
        <AdminCard title="Add an IP" className="h-fit">
          <ActionForm action={addIpAllowlistAction} submitLabel="Add" resetOnSuccess>
            <TextField tone="light" label="IP" name="address" required placeholder="203.0.113.7" />
            <TextField tone="light" label="Name (optional)" name="label" placeholder="Office" />
          </ActionForm>
        </AdminCard>
      </div>
    </>
  );
}
