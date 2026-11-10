import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { checkInsToday, listScannerCheckpoints } from "@/services/qr.service";
import { EmptyState, PageLoading } from "@/components/joia/states";
import { Scanner } from "@/components/staff/scanner";

export const metadata: Metadata = { title: "Scanner" };

export default function ScannerPage() {
  return (
    <Suspense fallback={<PageLoading label="Preparing scanner" variant="card" />}>
      <ScannerLoader />
    </Suspense>
  );
}

async function ScannerLoader() {
  const actor = await requirePermissionPage("scan:validate");
  const [checkpoints, today] = await Promise.all([listScannerCheckpoints(actor), checkInsToday(actor)]);
  const zones = checkpoints.flatMap((e) => e.zones.map((z) => ({ id: z.id, name: z.name, eventName: e.eventName })));
  if (zones.length === 0) {
    return <EmptyState title="No checkpoints" description="There is no published event with active access zones. Ask an administrator to configure one." />;
  }
  return <Scanner zones={zones} checkedInToday={today} />;
}
