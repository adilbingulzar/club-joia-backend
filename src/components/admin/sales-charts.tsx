"use client";

/**
 * The sales page's charts: columns over time, ranked bars and a segmented bar.
 * Every mark shows its figures on hover and keyboard focus; each chart's card also has a table
 * view (SalesTable), so no value is only in a tooltip.
 */
import { useEffect, useRef, useState } from "react";
import { compact, count, money } from "@/lib/sales/format";

export type Point = { key: string; label: string; value: number; detail?: string };

function fmt(v: number, as: "money" | "count", currency: string): string {
  return as === "money" ? money(v, currency) : count(v);
}

/** A round top for the axis and 4 steps to it. */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return { top: step * 4, ticks: [0, step, step * 2, step * 3, step * 4] };
}

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(240, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function Tip({ value, text, style }: { value: string; text: string; style: React.CSSProperties }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-xs text-pearl shadow-lg"
      style={{ ...style, marginTop: -8 }}
    >
      <b className="block tabular-nums">{value}</b>
      <span className="text-pearl-muted">{text}</span>
    </div>
  );
}

/** Columns, one per day (or week): a single series, the peak labelled. */
export function ColumnChart({ points, as, currency, height = 220, label }: { points: Point[]; as: "money" | "count"; currency: string; height?: number; label: string }) {
  const { ref, width } = useWidth(640);
  const [on, setOn] = useState<number | null>(null);
  const left = 52;
  const right = 8;
  const top = 18;
  const bottom = 26;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const { top: max, ticks } = niceScale(Math.max(0, ...points.map((p) => p.value)));
  const band = plotW / Math.max(points.length, 1);
  const barW = Math.max(1, Math.min(24, band - 2, band * 0.7));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const peak = points.reduce((b, p, i) => (p.value > (b < 0 ? -1 : points[b].value) ? i : b), -1);
  // about six dates along the axis
  const every = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="relative" ref={ref}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ maxHeight: height }} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.07)"} />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-black/45 text-[11px] tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = left + band * i + band / 2;
          const h = Math.max(0, y(0) - y(p.value));
          const x = cx - barW / 2;
          const r = Math.min(4, barW / 2, h);
          const yTop = y(0) - h;
          // 4px round data-end, square on the baseline
          const d = h > 0 ? `M${x},${y(0)} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${y(0)} Z` : "";
          return (
            <g key={p.key}>
              {d && <path d={d} className={on === i ? "fill-ruby" : "fill-ink"} />}
              {i % every === 0 && (
                <text x={cx} y={height - 6} textAnchor="middle" className="fill-black/45 text-[11px]">
                  {p.label}
                </text>
              )}
              {i === peak && p.value > 0 && points.length > 1 && (
                <text x={cx} y={yTop - 6} textAnchor="middle" className="fill-ink text-[11px] font-medium tabular-nums">
                  {compact(p.value)}
                </text>
              )}
              <rect
                x={left + band * i}
                y={top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                className="outline-none focus-visible:stroke-ruby"
                aria-label={p.label + ": " + fmt(p.value, as, currency) + (p.detail ? ", " + p.detail : "")}
                onPointerEnter={() => setOn(i)}
                onPointerLeave={() => setOn(null)}
                onFocus={() => setOn(i)}
                onBlur={() => setOn(null)}
              />
            </g>
          );
        })}
      </svg>
      {on !== null && points[on] && (
        <Tip
          value={fmt(points[on].value, as, currency)}
          text={points[on].label + (points[on].detail ? " · " + points[on].detail : "")}
          style={{ left: Math.min(Math.max(left + band * on + band / 2, 80), width - 80), top: y(points[on].value) }}
        />
      )}
    </div>
  );
}

/** Ranked horizontal bars, largest first, one color, the value at each bar's tip. */
export function BarList({ rows, as, currency, label }: { rows: Point[]; as: "money" | "count"; currency: string; label: string }) {
  const [on, setOn] = useState<number | null>(null);
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5" role="list" aria-label={label}>
      {rows.map((r, i) => (
        <div
          key={r.key}
          role="listitem"
          tabIndex={0}
          className="group relative grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-ruby/40"
          aria-label={r.label + ": " + fmt(r.value, as, currency) + (r.detail ? ", " + r.detail : "")}
          onPointerEnter={() => setOn(i)}
          onPointerLeave={() => setOn(null)}
          onFocus={() => setOn(i)}
          onBlur={() => setOn(null)}
        >
          <span className="truncate text-sm text-black/70" title={r.label}>
            {r.label}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-3 min-w-[2px] rounded-r bg-ink transition-colors group-hover:bg-ruby group-focus-visible:bg-ruby"
              style={{ width: max ? Math.max(0.5, (r.value / max) * 70) + "%" : "0.5%" }}
            />
            <span className="whitespace-nowrap text-xs tabular-nums text-ink">
              {fmt(r.value, as, currency)}
              {r.detail && <small className="ml-1.5 text-black/45">{r.detail}</small>}
            </span>
          </span>
          {on === i && r.detail && <Tip value={fmt(r.value, as, currency)} text={r.label + " · " + r.detail} style={{ left: "60%", top: 0 }} />}
        </div>
      ))}
    </div>
  );
}

/** One whole split into parts: tall blocks with their share printed where it fits, legend below. */
export function SegmentedBar({ parts, as, currency, label }: { parts: (Point & { color: string; text: string })[]; as: "money" | "count"; currency: string; label: string }) {
  const [on, setOn] = useState<number | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="py-6 text-center text-sm text-black/45">No paid tickets yet.</p>;
  return (
    <div>
      <div className="relative flex h-12 gap-0.5 overflow-visible" role="list" aria-label={label}>
        {parts.map((p, i) => {
          if (!p.value) return null;
          const share = p.value / total;
          const pct = Math.round(share * 100) + "%";
          return (
            <div
              key={p.key}
              role="listitem"
              tabIndex={0}
              className="grid place-items-center overflow-hidden text-xs font-medium tabular-nums ring-1 ring-inset ring-black/10 outline-none first:rounded-l-md last:rounded-r-md focus-visible:ring-2 focus-visible:ring-ruby"
              style={{ flex: share, background: p.color, color: p.text }}
              aria-label={p.label + ": " + fmt(p.value, as, currency) + ", " + pct}
              onPointerEnter={() => setOn(i)}
              onPointerLeave={() => setOn(null)}
              onFocus={() => setOn(i)}
              onBlur={() => setOn(null)}
            >
              {share >= 0.1 ? pct : ""}
            </div>
          );
        })}
        {on !== null && parts[on] && (
          <Tip
            value={fmt(parts[on].value, as, currency)}
            text={parts[on].label + " · " + Math.round((parts[on].value / total) * 100) + "%" + (parts[on].detail ? " · " + parts[on].detail : "")}
            style={{ left: ((parts.slice(0, on).reduce((s, p) => s + p.value, 0) + parts[on].value / 2) / total) * 100 + "%", top: 0 }}
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-black/60">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <i className="inline-block size-2.5 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
