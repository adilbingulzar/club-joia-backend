import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { emailDeliveryConfigured } from "@/services/email.service";
import { listNotificationsAdmin } from "@/services/notification.service";
import { listTiers } from "@/services/membership.service";
import { env } from "@/lib/config/env";
import { AdminCard, AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionButton } from "@/components/admin/action-controls";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { formatDateTime } from "@/lib/utils";
import { spPage, withParams, type SP } from "@/lib/search-params";
import { cancelNotificationAction } from "../actions";
import { ComposeForm } from "./compose-form";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsAdminPage({ searchParams }: PageProps<"/admin/notifications">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Notifications searchParams={searchParams} />
    </Suspense>
  );
}

async function Notifications({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("notifications:send");
  const params = await searchParams;
  const [data, tiers, events, members] = await Promise.all([
    listNotificationsAdmin(actor, { page: spPage(params) }),
    listTiers(),
    db.event.findMany({ where: { status: { in: ["PUBLISHED", "LIVE"] } }, select: { id: true, name: true } }),
    db.member.findMany({ where: { anonymizedAt: null }, orderBy: [{ lastName: "asc" }], select: { id: true, firstName: true, lastName: true, membershipNumber: true } }),
  ]);
  const pushConfigured = Boolean(env().WEB_PUSH_PUBLIC_KEY && env().WEB_PUSH_PRIVATE_KEY);

  return (
    <>
      <AdminPageHeader eyebrow="Communication" title="Notifications" description="In-app notifications always reach the member's notification centre. Push reaches devices where the member enabled notifications." />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <AdminCard title="Compose" className="h-fit">
          <ComposeForm
            tiers={tiers.map((t) => ({ value: t.id, label: t.displayName }))}
            events={events.map((e) => ({ value: e.id, label: e.name }))}
            members={members.map((m) => ({ value: m.id, label: `${m.lastName}, ${m.firstName} · ${m.membershipNumber}` }))}
            pushConfigured={pushConfigured}
          />
          <ul className="mt-5 space-y-1 border-t border-black/8 pt-4 text-xs text-black/50">
            <li>Web push: {pushConfigured ? "configured" : "not configured (VAPID keys missing)"}</li>
            <li>Email: {emailDeliveryConfigured() ? "configured" : "not available in V1"}</li>
            <li>SMS / WhatsApp / native push: planned channels (not available in V1)</li>
            <li>Scheduled sends are delivered by the cron endpoint — see README.</li>
          </ul>
        </AdminCard>
        <AdminDataTable
          caption="Sent and scheduled notifications"
          rows={data.rows}
          rowKey={(n) => n.id}
          empty="Nothing sent yet."
          pagination={{ page: data.page, pageSize: 30, total: data.total, href: (p) => withParams("/admin/notifications", params, { page: p }) }}
          columns={[
            {
              header: "Notification",
              cell: (n) => (
                <span className="block max-w-sm">
                  <span className="font-medium">{n.title}</span>
                  <span className="block truncate text-xs text-black/50">{n.body}</span>
                </span>
              ),
            },
            { header: "Audience", cell: (n) => <span className="text-xs">{n.targetType.toLowerCase().replace("_", " ")}{(n.metadata as { system?: boolean })?.system ? " · automatic" : ""}</span> },
            { header: "Status", cell: (n) => <StatusBadge status={n.status} /> },
            {
              header: "Delivery",
              cell: (n) => {
                const sum = (ch: string, st?: string) => n.stats.filter((s) => s.deliveryChannel === ch && (!st || s.deliveryStatus === st)).reduce((a, s) => a + s._count, 0);
                return (
                  <span className="text-xs text-black/60">
                    in-app {sum("IN_APP")} · read {n.reads}
                    {n.channels.includes("WEB_PUSH") && ` · push ${sum("WEB_PUSH", "SENT")}/${sum("WEB_PUSH")}`}
                  </span>
                );
              },
            },
            { header: "When", cell: (n) => <span className="whitespace-nowrap text-xs text-black/55">{formatDateTime(n.sentAt ?? n.scheduledAt ?? n.createdAt)}</span> },
            { header: "", cell: (n) => (n.status === "SCHEDULED" ? <ActionButton label="Cancel" variant="ghost" run={cancelNotificationAction.bind(null, n.id)} /> : null) },
          ]}
        />
      </div>
    </>
  );
}
