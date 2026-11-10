import Link from "next/link";
import { JoiaLogo } from "@/components/joia/joia-logo";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-6 text-center">
      <div>
        <JoiaLogo width={130} className="mx-auto" />
        <h1 className="display mt-10 text-4xl">Not found</h1>
        <p className="mt-3 text-sm text-pearl-muted">This page doesn’t exist or is no longer available.</p>
        <Link href="/" className="mt-8 inline-block text-[11px] uppercase tracking-[0.2em] text-ruby">
          Return home
        </Link>
      </div>
    </main>
  );
}
