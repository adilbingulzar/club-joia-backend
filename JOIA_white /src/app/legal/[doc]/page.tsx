import Link from "next/link";
import { notFound } from "next/navigation";
import { JoiaLogo } from "@/components/joia/joia-logo";

const DOCS = {
  terms: "Membership terms",
  privacy: "Privacy policy",
} as const;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

/**
 * PLACEHOLDER legal pages. The final membership terms and privacy policy must be supplied by
 * CLUB JOIA's legal counsel before launch (see README → Remaining production items).
 */
export default async function LegalPage({ params }: PageProps<"/legal/[doc]">) {
  const { doc } = await params;
  const title = DOCS[doc as keyof typeof DOCS];
  if (!title) notFound();
  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-ink px-6 py-12">
      <Link href="/">
        <JoiaLogo width={140} />
      </Link>
      <h1 className="display mt-10 text-5xl">{title}</h1>
      <div className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-5 text-sm text-pearl">
        <p className="font-medium">Draft — legal copy pending</p>
        <p className="mt-2 text-pearl-muted">
          The final {title.toLowerCase()} will be published here before launch. For questions about how your data is handled, contact CLUB JOIA concierge. You can download or request deletion of your data at any time from your profile.
        </p>
      </div>
    </main>
  );
}
