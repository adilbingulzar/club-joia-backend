import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listPaymentLinks, paymentLinksConfigured } from "@/services/payment-links.service";
import { AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionButton } from "@/components/admin/action-controls";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { buttonClasses } from "@/components/ui/button-styles";
import { money } from "@/lib/sales/format";
import { formatDateTime } from "@/lib/utils";
import { sp, type SP } from "@/lib/search-params";
import { cancelPaymentLinkAction } from "../actions";

export const metadata: Metadata = { title: "Payment links" };

const PER_PAGE = 25;

export default function PaymentLinksPage({ searchParams }: PageProps<"/admin/payment-links">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <PaymentLinks searchParams={searchParams} />
    </Suspense>
  );
}

const STATE = {
  paid: { label: "Paid", tone: "success" },
  unpaid: { label: "Not paid yet", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
} as const;

async function PaymentLinks({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("sales:links");
  const params = await searchParams;
  const page = Number(sp(params, "page") ?? 1) || 1;
  const made = sp(params, "made");
  const emailed = sp(params, "emailed");
  const data = await listPaymentLinks(actor, page, PER_PAGE);
  const fresh = made ? data.links.find((l) => l.ref === made) : undefined;
  const on = paymentLinksConfigured();

  return (
    <>
      <AdminPageHeader
        eyebrow="Sales"
        title="Payment links"
        description={
          (data.all ? "Every payment link made in the admin." : "The payment links you made.") +
          " Fill in the buyer's details and tickets; the link can be emailed to them and copied for WhatsApp. It can be paid for 1, 2 or 4 days; after payment the buyer gets their tickets and confirmation email as with a website order."
        }
        actions={
          on && (
            <Link href="/admin/payment-links/new" className={buttonClasses("primary", "sm")}>
              <Plus className="size-4" aria-hidden /> New payment link
            </Link>
          )
        }
      />
      {!on && (
        <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Payment links aren&rsquo;t set up yet: the server needs SHOP_API_URL (the website&rsquo;s address) and SHOP_ADMIN_KEY (the same as the website&rsquo;s).
        </p>
      )}
      {!data.available && (
        <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          The website&rsquo;s orders table doesn&rsquo;t have payment links yet. It gets them when the updated website first runs on this database.
        </p>
      )}
      {fresh && fresh.url && fresh.state === "unpaid" && (
        <div className="mb-6 rounded-xl border border-success/40 bg-success/10 p-4 text-sm">
          <p className="font-medium">
            Payment link for {fresh.buyerName || fresh.email} is ready ({money(fresh.amount, fresh.currency)}).{" "}
            {emailed === "1" ? `Emailed to ${fresh.email}. You can also copy it for WhatsApp.` : emailed === "0" ? "The email couldn't be sent: copy the link and send it to them." : "Copy it and send it to them."}
          </p>
          {fresh.expiresAt && <p className="mt-1 text-xs text-black/60">Valid until {formatDateTime(fresh.expiresAt)} (UAE time).</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="min-w-0 break-all rounded bg-white px-2 py-1 text-xs">{fresh.url}</code>
            <CopyButton text={fresh.url} />
          </div>
        </div>
      )}
      <AdminDataTable
        caption="Payment links"
        rows={data.links}
        rowKey={(l) => l.ref}
        empty="No payment links yet."
        pagination={{ page: data.page, pageSize: PER_PAGE, total: data.total, href: (p) => "/admin/payment-links?page=" + p }}
        columns={[
          { header: "Made", cell: (l) => <span className="text-xs text-black/60">{formatDateTime(l.createdAt)}</span> },
          {
            header: "Buyer",
            cell: (l) => (
              <span>
                <span className="font-medium">{l.buyerName || "—"}</span>
                <span className="block text-xs text-black/50">{l.email}</span>
              </span>
            ),
          },
          {
            header: "Tickets",
            cell: (l) => <span className="text-xs text-black/70">{l.items.map((i) => i.quantity + " × " + i.name).join(", ")}</span>,
          },
          { header: "Amount", cell: (l) => <span className="tabular-nums">{money(l.amount, l.currency)}</span> },
          {
            header: "Status",
            cell: (l) => (
              <span className="flex flex-col items-start gap-1">
                <StatusBadge status={l.state} label={STATE[l.state].label} tone={STATE[l.state].tone} />
                {l.state === "unpaid" && l.expiresAt && <span className="text-[11px] text-black/50">until {formatDateTime(l.expiresAt)}</span>}
              </span>
            ),
          },
          ...(data.all ? [{ header: "Made by", cell: (l: (typeof data.links)[number]) => <span className="text-xs">{l.createdBy}</span> }] : []),
          {
            header: "",
            cell: (l) => (
              <span className="flex items-center justify-end gap-1">
                {l.state === "unpaid" && l.url && <CopyButton text={l.url} />}
                {l.state === "paid" && l.paidRef && (
                  <Link href={"/admin/sales/orders/" + encodeURIComponent(l.paidRef)} className="rounded-full px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 hover:text-ink">
                    Order
                  </Link>
                )}
                {l.state === "unpaid" && (
                  <ActionButton
                    label="Cancel"
                    variant="ghost"
                    run={cancelPaymentLinkAction.bind(null, l.ref)}
                    confirm={{ title: "Cancel this payment link?", description: `${l.buyerName || l.email} can no longer pay with it.`, confirmLabel: "Cancel link", cancelLabel: "Keep link", destructive: true }}
                  />
                )}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
