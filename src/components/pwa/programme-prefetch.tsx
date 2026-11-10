"use client";

import { useEffect } from "react";

/** Warms the service-worker cache with the event's public programme for offline reading. */
export function ProgrammePrefetch({ slug }: { slug: string }) {
  useEffect(() => {
    if (!navigator.serviceWorker?.controller) return;
    fetch(`/api/events/${encodeURIComponent(slug)}/programme`, { credentials: "same-origin" }).catch(() => {});
  }, [slug]);
  return null;
}
