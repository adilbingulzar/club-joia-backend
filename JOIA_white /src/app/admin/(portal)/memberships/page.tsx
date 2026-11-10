import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listTiers } from "@/services/membership.service";
import { listEntitlementCatalogue } from "@/services/entitlement.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { TierBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { Checkbox, TextField } from "@/components/ui/form";
import { updateTierAction } from "../actions";

export const metadata: Metadata = { title: "Memberships" };

export default function MembershipsPage() {
  return (
    <>
      <AdminPageHeader
        eyebrow="Configuration"
        title="Membership tiers"
        description="Privileges come from the entitlement engine — change them here and every screen, scanner and programme gate follows. Seeded values are sample configuration."
      />
      <Suspense fallback={<LoadingSkeleton variant="list" lines={3} />}>
        <Tiers />
      </Suspense>
    </>
  );
}

async function Tiers() {
  await requirePermissionPage("tiers:manage");
  const [tiers, catalogue] = await Promise.all([listTiers({ includeInactive: true }), listEntitlementCatalogue()]);
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      {tiers.map((t) => {
        const grants = new Map(t.entitlements.map((g) => [g.entitlement.code, g.value]));
        return (
          <AdminCard key={t.id} title={`${t._count.memberships} active`} actions={<TierBadge name={t.displayName} theme={t.cardTheme} />}>
            <ActionForm action={updateTierAction} submitLabel="Save tier">
              <input type="hidden" name="tierId" value={t.id} />
              <TextField tone="light" label="Display name" name="displayName" defaultValue={t.displayName} required />
              <TextField tone="light" label="Description" name="description" defaultValue={t.description ?? ""} />
              <div className="grid grid-cols-2 gap-3">
                <TextField tone="light" label="Accent colour" name="color" defaultValue={t.color} />
                <TextField tone="light" label="Sort order" name="sortOrder" type="number" defaultValue={t.sortOrder} />
              </div>
              <Checkbox tone="light" name="active" defaultChecked={t.active} label="Active (available for new memberships)" />
              <fieldset className="space-y-3 border-t border-black/8 pt-4">
                <legend className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/55">Entitlements</legend>
                {catalogue.map((e) =>
                  e.valueType === "BOOLEAN" ? (
                    <Checkbox key={e.code} tone="light" name={`ent_${e.code}`} defaultChecked={grants.get(e.code) === true} label={e.name} description={e.description ?? undefined} />
                  ) : (
                    <TextField
                      key={e.code}
                      tone="light"
                      label={e.name}
                      name={`ent_${e.code}`}
                      type={e.valueType === "INTEGER" ? "number" : "text"}
                      defaultValue={grants.has(e.code) ? String(grants.get(e.code)) : ""}
                      hint={e.description ?? undefined}
                    />
                  ),
                )}
              </fieldset>
            </ActionForm>
          </AdminCard>
        );
      })}
    </div>
  );
}
