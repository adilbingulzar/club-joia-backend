"use client";

import { useEffect, useState } from "react";
import { BellRing, BellOff, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "@/app/(member)/actions";

type Status = "checking" | "unsupported" | "needs-install" | "denied" | "off" | "on" | "not-configured";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Enables Web Push for this device. Handles every state honestly: unsupported browser,
 * iOS requiring Home Screen install, permission denied, server keys not configured.
 */
export function PushOptIn({ publicKey, compact }: { publicKey: string | null; compact?: boolean }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!publicKey) return setStatus("not-configured");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setStatus(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      }
      if (Notification.permission === "denied") return setStatus("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    })().catch(() => setStatus("unsupported"));
  }, [publicKey]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey!) });
      const res = await savePushSubscriptionAction(sub.toJSON());
      if (!res.ok) throw new Error(res.error.message);
      setStatus("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking" || (compact && status === "on")) return null;

  const copy: Record<Exclude<Status, "checking">, { icon: React.ReactNode; title: string; body: string }> = {
    off: { icon: <BellRing />, title: "Enable notifications", body: "Programme changes, transport times and concierge replies, the moment they happen." },
    on: { icon: <BellRing />, title: "Notifications are on", body: "This device receives CLUB JOIA notifications." },
    denied: { icon: <BellOff />, title: "Notifications are blocked", body: "Allow notifications for this site in your browser or phone settings, then return here." },
    "needs-install": { icon: <Smartphone />, title: "Add to Home Screen", body: "On iPhone, tap Share → Add to Home Screen, then open CLUB JOIA from your Home Screen to enable notifications." },
    unsupported: { icon: <BellOff />, title: "Not available on this browser", body: "You will still see every update in this notification centre." },
    "not-configured": { icon: <BellOff />, title: "Push not yet configured", body: "Device notifications will be enabled by CLUB JOIA shortly. Updates appear here meanwhile." },
  };
  const c = copy[status];

  return (
    <div className="flex items-start gap-4 rounded-2xl border border-line bg-surface p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-raised text-pearl [&_svg]:size-4" aria-hidden>
        {c.icon}
      </span>
      <div className="flex-1">
        <p className="text-[15px] text-pearl">{c.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-pearl-dim">{c.body}</p>
        {error && <p role="alert" className="mt-2 text-xs text-ruby">{error}</p>}
        {status === "off" && (
          <Button size="sm" className="mt-3" onClick={enable} loading={busy}>
            Turn on
          </Button>
        )}
        {status === "on" && (
          <Button size="sm" variant="secondary" className="mt-3" onClick={disable} loading={busy}>
            Turn off on this device
          </Button>
        )}
      </div>
    </div>
  );
}
