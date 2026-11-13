/** Small server pieces of the sales pages: tabs, order status, change figure, a chart's table view. */
import Link from "next/link";
import { StatusBadge } from "@/components/joia/badges";
import { change, orderStatus } from "@/lib/sales/format";
import { cn } from "@/lib/utils";

export function SalesTabs({ active }: { active: "sales" | "registrations" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn("rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-[0.14em]", on ? "bg-ink text-pearl" : "text-black/55 hover:bg-black/5 hover:text-ink")}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Sales" className="mb-6 flex gap-2">
      {tab("/admin/sales", "Ticket sales", active === "sales")}
      {tab("/admin/sales/registrations", "Pre-registrations", active === "registrations")}
    </nav>
  );
}

/** An order status always shows its label with its color. */
export function OrderStatusBadge({ status }: { status: string }) {
  const s = orderStatus(status);
  return <StatusBadge status={status} label={s.label} tone={s.tone} />;
}

export function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return null;
  const c = change(now, before);
  if (!c) return <span className="mt-1 block text-xs text-black/45">no sales the period before</span>;
  return (
    <span className="mt-1 block text-xs text-black/55">
      <span className={c.up ? "text-success" : "text-danger"} aria-hidden>
        {c.up ? "▲" : "▼"}
      </span>{" "}
      {c.text} vs the period before
    </span>
  );
}

/** The table view of a chart, folded away. */
export function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-xs text-black/50 hover:text-ink">Show as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-black/8">
            <tr>
              {head.map((h, i) => (
                <th key={h} scope="col" className={cn("px-2 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-black/50", i && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/6">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={cn("px-2 py-1.5", j && "text-right tabular-nums")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-black/45">{children}</p>;
}
