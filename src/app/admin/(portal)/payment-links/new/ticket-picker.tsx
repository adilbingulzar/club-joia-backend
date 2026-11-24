"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Ticket = { id: string; name: string; price: number; soldOut: boolean };

function money(n: number, currency: string): string {
  return currency + " " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * The tickets of a payment link: − / + per ticket (0 to max), its subtotal, and the order's total.
 * Each quantity goes with the form as qty:<ticket id> (createPaymentLinkAction).
 */
export function TicketPicker({ tickets, currency, max }: { tickets: Ticket[]; currency: string; max: number }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const set = (id: string, n: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, n)) }));
  const chosen = tickets.filter((t) => (qty[t.id] ?? 0) > 0);
  const total = chosen.reduce((s, t) => s + t.price * qty[t.id], 0);
  const count = chosen.reduce((s, t) => s + qty[t.id], 0);

  return (
    <div>
      <ul className="space-y-2">
        {tickets.map((t) => {
          const n = qty[t.id] ?? 0;
          return (
            <li
              key={t.id}
              className={cn(
                "flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors",
                n > 0 ? "border-ink/25 bg-black/[0.03]" : "border-black/8",
                t.soldOut && "opacity-45",
              )}
            >
              <input type="hidden" name={"qty:" + t.id} value={n} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="block text-xs text-black/50">
                  {t.soldOut ? "Not on sale" : money(t.price, currency)}
                  {n > 0 && <span className="text-ink"> · {money(t.price * n, currency)}</span>}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1" role="group" aria-label={"Quantity of " + t.name}>
                <button
                  type="button"
                  onClick={() => set(t.id, n - 1)}
                  disabled={t.soldOut || n === 0}
                  aria-label={"One less " + t.name}
                  className="grid size-9 place-items-center rounded-full border border-black/15 text-ink hover:bg-black/5 disabled:opacity-30"
                >
                  <Minus className="size-4" aria-hidden />
                </button>
                <span className="w-8 text-center text-base font-medium tabular-nums" aria-live="polite">
                  {n}
                </span>
                <button
                  type="button"
                  onClick={() => set(t.id, n + 1)}
                  disabled={t.soldOut || n >= max}
                  aria-label={"One more " + t.name}
                  className="grid size-9 place-items-center rounded-full bg-ink text-pearl hover:bg-black/80 disabled:opacity-30"
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-ink px-4 py-3 text-pearl">
        <span className="text-xs uppercase tracking-[0.16em] text-pearl/70">{count ? `${count} ticket${count > 1 ? "s" : ""}` : "No tickets yet"}</span>
        <span className="text-lg font-medium tabular-nums">{money(total, currency)}</span>
      </div>
    </div>
  );
}
