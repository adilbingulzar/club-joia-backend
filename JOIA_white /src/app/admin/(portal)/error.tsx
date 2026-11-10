"use client";

/** Admin error boundary: shows the diagnostic reference so staff can quote it to engineering. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-2xl border border-ruby/30 bg-white p-8">
      <h1 className="font-display text-3xl">This page failed to load</h1>
      <p className="mt-2 text-sm text-black/60">The error has been logged on the server.</p>
      <dl className="mt-4 space-y-1 font-mono text-xs text-black/60">
        {error.digest && <div>Digest: {error.digest}</div>}
        <div>Time: {new Date().toISOString()}</div>
      </dl>
      <button onClick={reset} className="mt-6 rounded-full bg-ink px-5 py-2.5 text-xs uppercase tracking-[0.14em] text-pearl">
        Retry
      </button>
    </div>
  );
}
