"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, SelectField } from "@/components/ui/form";
import { HandoffLink } from "@/components/admin/action-controls";
import type { ActionError } from "@/lib/errors";
import { makeMemberAction } from "../../actions";

export type SaleOption = { ref: string; label: string };

/**
 * New member from a website sale: the paid orders whose buyer isn't a member yet (the ones with
 * "Make member" in Admin > Sales). Picking one does the same: the member with the order's tier and
 * tickets (or the member of that email gets them), and the invitation.
 */
export function MakeMemberFromSale({ sales }: { sales: SaleOption[] }) {
  const router = useRouter();
  const [ref, setRef] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);
  const [done, setDone] = useState<{ message: string; link?: string; href?: { url: string; label: string } } | null>(null);

  if (!sales.length && !done) return <p className="text-sm text-black/55">Every paid sale already has its member.</p>;

  const make = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const res = await makeMemberAction(ref);
      if (!res.ok) return setError(res.error);
      setDone(res.data as { message: string; link?: string; href?: { url: string; label: string } });
      setRef("");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {error && <FormMessage tone="light" error={error} />}
      {done && <FormMessage tone="light" success={done.message} />}
      {done?.link && <HandoffLink link={done.link} />}
      {done?.href && (
        <Link href={done.href.url} className="inline-block text-sm text-ruby underline-offset-4 hover:underline">
          {done.href.label} →
        </Link>
      )}
      {sales.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <SelectField
            tone="light"
            label="Paid sale without a member"
            name="saleRef"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Choose a buyer…"
            options={sales.map((s) => ({ value: s.ref, label: s.label }))}
          />
          <Button type="button" size="md" loading={pending} disabled={!ref || pending} onClick={make}>
            Make member
          </Button>
        </div>
      )}
    </div>
  );
}
