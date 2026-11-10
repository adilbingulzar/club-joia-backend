import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
};

/** Server-rendered data table with empty state and query-string pagination. */
export function AdminDataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing to show.",
  pagination,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  pagination?: { page: number; pageSize: number; total: number; href: (page: number) => string };
  caption?: string;
}) {
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  return (
    <div className="overflow-hidden rounded-2xl border border-black/8 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-black/8 bg-black/[0.02]">
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={cn("whitespace-nowrap px-4 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-black/50", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/6">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center text-sm text-black/50">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-black/[0.015]">
                  {columns.map((c) => (
                    <td key={c.header} className={cn("px-4 py-3 align-middle", c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between border-t border-black/8 px-4 py-3 text-xs text-black/55">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>
          <div className="flex gap-1">
            <PageLink disabled={pagination.page <= 1} href={pagination.href(pagination.page - 1)} label="Previous page">
              <ChevronLeft className="size-4" />
            </PageLink>
            <PageLink disabled={pagination.page >= pages} href={pagination.href(pagination.page + 1)} label="Next page">
              <ChevronRight className="size-4" />
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ disabled, href, label, children }: { disabled: boolean; href: string; label: string; children: React.ReactNode }) {
  if (disabled) return <span className="grid size-8 place-items-center rounded-lg text-black/25" aria-hidden>{children}</span>;
  return (
    <Link href={href} aria-label={label} className="grid size-8 place-items-center rounded-lg hover:bg-black/5">
      {children}
    </Link>
  );
}

export function AdminPageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-black/45">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-4xl font-medium tracking-tight">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-black/55">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function AdminCard({ title, children, className, actions, id }: { title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("rounded-2xl border border-black/8 bg-white p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-black/55">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** GET filter form (search params) for list pages. */
export function FilterBar({ children, action }: { children: React.ReactNode; action: string }) {
  return (
    <form action={action} method="get" className="mb-5 flex flex-wrap items-end gap-3">
      {children}
      <button className="h-10 rounded-full bg-ink px-5 text-xs font-medium uppercase tracking-[0.14em] text-pearl hover:bg-black">Apply</button>
    </form>
  );
}

export function FilterInput({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue?: string; placeholder?: string }) {
  return (
    <label className="text-[10px] uppercase tracking-[0.16em] text-black/50">
      {label}
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} className="mt-1 block h-10 w-64 rounded-lg border border-black/12 bg-white px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-ruby" />
    </label>
  );
}

export function FilterSelect({ label, name, defaultValue, options }: { label: string; name: string; defaultValue?: string; options: { value: string; label: string }[] }) {
  return (
    <label className="text-[10px] uppercase tracking-[0.16em] text-black/50">
      {label}
      <select name={name} defaultValue={defaultValue ?? ""} className="mt-1 block h-10 min-w-40 rounded-lg border border-black/12 bg-white px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-ruby">
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatCard({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: string; accent?: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-black/8 bg-white p-5">
      {accent && <span className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} aria-hidden />}
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-black/50">{label}</p>
      <p className="mt-3 font-display text-4xl tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-black/45">{hint}</p>}
    </div>
  );
}
