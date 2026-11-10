import Link from "next/link";
import { JoiaLogo } from "@/components/joia/joia-logo";

export const metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-6 text-center">
      <div>
        <JoiaLogo width={140} className="mx-auto" />
        <h1 className="display mt-10 text-4xl">This area is restricted</h1>
        <p className="mt-3 text-sm text-pearl-muted">Your account does not have permission to view this page.</p>
        <Link href="/login" className="mt-8 inline-block text-[11px] uppercase tracking-[0.2em] text-ruby">
          Switch account
        </Link>
      </div>
    </main>
  );
}
