"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { JoiaLogo } from "@/components/joia/joia-logo";

/**
 * Root error boundary. Never shows stack traces — only a polite message and the
 * diagnostic digest (which maps to the server log entry) for support / admins.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-6 text-center">
      <div className="max-w-sm">
        <JoiaLogo width={130} className="mx-auto" />
        <h1 className="display mt-10 text-4xl">A moment, please</h1>
        <p className="mt-3 text-sm text-pearl-muted">Something didn’t load as it should. Please try again — if it persists, our concierge team can help.</p>
        <button onClick={reset} className="mt-8 inline-flex items-center gap-2 rounded-full bg-pearl px-5 py-3 text-xs font-medium uppercase tracking-[0.16em] text-ink">
          <RefreshCw className="size-4" aria-hidden /> Try again
        </button>
        {error.digest && <p className="mt-6 font-mono text-[11px] text-pearl-dim">Reference {error.digest}</p>}
      </div>
    </main>
  );
}
