import type { Metadata } from "next";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth/dal";
import { env } from "@/lib/config/env";
import { listMyNotifications } from "@/services/notification.service";
import { PageLoading } from "@/components/joia/states";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Messages from the club</p>
        <h1 className="display mt-2 text-5xl">Notifications</h1>
      </header>
      <Suspense fallback={<PageLoading label="Loading notifications" />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  const actor = await requireMember();
  const items = await listMyNotifications(actor);
  return (
    <div className="space-y-6">
      <PushOptIn publicKey={env().WEB_PUSH_PUBLIC_KEY ?? null} compact />
      <NotificationList items={items} />
    </div>
  );
}
