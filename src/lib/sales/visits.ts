/**
 * The website's visit report (/admin/visits): names for its pages and sources, the days of
 * the chart, and the CSV for the daily report sheet. The figures come from src/services/visits.service.ts.
 */
import { addDays, daysBetween, today } from "./filters";
import { dayLabel } from "./format";

// the website's page names (club-joia-300-next lib/visits.ts pageOf)
const PAGES: Record<string, string> = {
  "/": "Home",
  "/tickets": "Tickets",
  "/summary": "Order summary",
  "/pay": "Payment",
  "/payment": "Payment result",
  "/thank-you": "Thank you",
  "/ruby-red": "Ruby Red",
  "/pearly-white": "Pearly White",
  "/ultra-black": "Ultra Black",
  "/terms": "Terms",
  "/privacy": "Privacy notice",
  "/preregister": "Pre-registration",
  other: "Other address",
};

export function pageLabel(path: string): string {
  return PAGES[path] ?? path;
}

const SOURCES: Record<string, string> = {
  direct: "Direct (typed in, bookmark or app)",
  internal: "Inside the site",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  google: "Google",
  bing: "Bing",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X (Twitter)",
  whatsapp: "WhatsApp",
  snapchat: "Snapchat",
  // Meta ads fill utm_source with where the ad was shown ({{site_source_name}})
  ig: "Instagram (paid ad)",
  fb: "Facebook (paid ad)",
  an: "Meta paid ad in other apps and sites",
  msg: "Messenger (paid ad)",
  th: "Threads (paid ad)",
};

export function sourceLabel(source: string): string {
  return SOURCES[source] ?? source;
}

export type VisitDay = { day: string; visitors: number; pageViews: number };
export type VisitBucket = VisitDay & { key: string; label: string; from: string; to: string };

const MAX_DAYS = 92;

/** Every day of the range (weeks past 92 days); without a range, from the first visit to today. */
export function visitSeries(days: VisitDay[], from: string, to: string, now = new Date()): VisitBucket[] {
  const sorted = days.slice().sort((a, b) => (a.day < b.day ? -1 : 1));
  const start = from || (sorted[0] && sorted[0].day) || today(now);
  const end = to || today(now);
  if (start > end) return [];
  const byDay = new Map(sorted.map((d) => [d.day, d]));
  const step = daysBetween(start, end) > MAX_DAYS ? 7 : 1;
  const out: VisitBucket[] = [];
  for (let d = start; d <= end; d = addDays(d, step)) {
    const last = step === 1 ? d : addDays(d, step - 1) < end ? addDays(d, step - 1) : end;
    const b: VisitBucket = { key: d, label: dayLabel(d), day: d, from: d, to: last, visitors: 0, pageViews: 0 };
    for (let x = d; x <= last; x = addDays(x, 1)) {
      const f = byDay.get(x);
      if (f) {
        b.visitors += f.visitors;
        b.pageViews += f.pageViews;
      }
    }
    out.push(b);
  }
  return out;
}

/** A cell Excel won't run as a formula (as src/lib/sales/csv.ts). */
function cell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export type VisitReportDay = VisitDay & { sources: Record<string, number>; pages: Record<string, number> };

/**
 * One row per day: visitors, page views, visitors from each source, views of each page.
 * Columns only for the sources and pages that had any.
 */
export function visitsCsv(days: VisitReportDay[]): string {
  const sources = [...new Set(days.flatMap((d) => Object.keys(d.sources)))].sort((a, b) => total(days, "sources", b) - total(days, "sources", a));
  const pages = [...new Set(days.flatMap((d) => Object.keys(d.pages)))].sort((a, b) => total(days, "pages", b) - total(days, "pages", a));
  const head = ["Day (Dubai)", "Visitors", "Page views", ...sources.map((s) => "Visitors from " + sourceLabel(s)), ...pages.map((p) => "Views of " + pageLabel(p))];
  const rows = days.map((d) => [d.day, d.visitors, d.pageViews, ...sources.map((s) => d.sources[s] ?? 0), ...pages.map((p) => d.pages[p] ?? 0)]);
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

function total(days: VisitReportDay[], k: "sources" | "pages", name: string): number {
  return days.reduce((s, d) => s + (d[k][name] ?? 0), 0);
}
