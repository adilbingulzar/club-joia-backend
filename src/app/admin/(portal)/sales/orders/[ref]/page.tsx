import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { getSalesOrder } from "@/services/sales.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { Empty, OrderStatusBadge } from "@/components/admin/sales-parts";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { count, dateTime, money, PAYMENT_STATUS } from "@/lib/sales/format";

export const metadata: Metadata = { title: "Order" };

export default function SalesOrderPage({ params }: PageProps<"/admin/sales/orders/[ref]">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Order params={params} />
    </Suspense>
  );
}

function Fields({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-black/50">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

async function Order({ params }: Pick<PageProps<"/admin/sales/orders/[ref]">, "params">) {
  const actor = await requirePermissionPage("sales:view");
  const ref = decodeURIComponent((await params).ref);
  const o = await getSalesOrder(actor, ref);
  if (!o) notFound();
  const b = o.buyer;
  const buyerRows: [string, React.ReactNode][] = [
    ["Name", b.name || "—"],
    ["Email", <a key="e" href={"mailto:" + b.email} className="hover:text-ruby">{b.email}</a>],
    ["Phone", b.mobile || "—"],
    ["Address", [b.address, b.zipcode, b.city].filter(Boolean).join(", ") || "—"],
    ["Country", <span key="c" className="capitalize">{b.country || "—"}</span>],
  ];
  if (b.birthday) buyerRows.push(["Birthday", b.birthday]);
  if (b.gender) buyerRows.push(["Gender", <span key="g" className="capitalize">{b.gender === "nogender" ? "Not given" : b.gender}</span>]);

  return (
    <>
      <Link href="/admin/sales" className="mb-4 inline-flex items-center gap-1.5 text-xs text-black/55 hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> All orders
      </Link>
      <AdminPageHeader eyebrow="Website order" title={o.ref} description={dateTime(o.createdAt) + " (Dubai time) · read only"} actions={<OrderStatusBadge status={o.status} />} />
      {o.error && <p className="mb-6 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm">⚠ Needs a look: {o.error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <AdminCard title="Buyer">
          <Fields rows={buyerRows} />
        </AdminCard>

        <AdminCard title="Payment">
          <Fields
            rows={[
              ["Amount", <span key="a" className="tabular-nums">{money(o.amount, o.currency)}</span>],
              ["Status", <OrderStatusBadge key="s" status={o.status} />],
              ["Payment (IFZA)", o.payment.id ? o.payment.id + (o.payment.status ? " · " + (PAYMENT_STATUS[o.payment.status] ?? o.payment.status) : "") : "Not started"],
              ["Ordered", dateTime(o.createdAt)],
              ["Paid", o.paidAt ? dateTime(o.paidAt) : "—"],
              ["Tickets issued", o.fulfilledAt ? dateTime(o.fulfilledAt) : "—"],
            ]}
          />
        </AdminCard>

        <AdminCard title="Tickets bought" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/8">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-black/50">
                  <th className="py-2 font-medium">Ticket</th>
                  <th className="py-2 text-right font-medium">Price</th>
                  <th className="py-2 text-right font-medium">Quantity</th>
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/6">
                {o.items.map((i) => (
                  <tr key={i.productId}>
                    <td className="py-2">{i.name}</td>
                    <td className="py-2 text-right tabular-nums">{money(i.price, o.currency)}</td>
                    <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{money(i.price * i.quantity, o.currency)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2" colSpan={3}>Total</td>
                  <td className="py-2 text-right tabular-nums">{money(o.amount, o.currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </AdminCard>

        <AdminCard title="Member">
          {o.member ? (
            <Fields
              rows={[
                [
                  "Membership no.",
                  can(actor.role, "members:view") ? (
                    <Link key="m" href={`/admin/members/${o.member.id}`} className="font-mono text-xs hover:text-ruby">{o.member.number}</Link>
                  ) : (
                    <span key="m" className="font-mono text-xs">{o.member.number}</span>
                  ),
                ],
                ["Tier", o.member.tier ?? "—"],
                ["Membership", o.member.membership ? <StatusBadge key="ms" status={o.member.membership} /> : "—"],
                ["Account", o.member.account === "PENDING_ACTIVATION" ? "Not activated yet" : o.member.account === "ACTIVE" ? "Active" : "Disabled"],
              ]}
            />
          ) : (
            <Empty>{o.status === "paid" ? "Not made yet." : "Made once the order is paid."}</Empty>
          )}
        </AdminCard>

        <AdminCard title={`Tickets issued · ${count(o.ticketList.length)}`}>
          {o.ticketList.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-black/8">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-black/50">
                    <th className="py-2 font-medium">Ticket number</th>
                    <th className="py-2 font-medium">Admission</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/6">
                  {o.ticketList.map((t) => (
                    <tr key={t.number}>
                      <td className="py-2 font-mono text-xs">{t.number}</td>
                      <td className="py-2">{t.name}</td>
                      <td className="py-2"><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{o.status === "paid" ? "None issued yet." : "Issued once the order is paid."}</Empty>
          )}
        </AdminCard>
      </div>
    </>
  );
}
