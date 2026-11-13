/** Numbers, dates and order statuses as the sales pages show them. */
import { SALES_TIMEZONE } from "./filters";

export function money(n: number, currency: string): string {
  return currency + " " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** Axis ticks: in full under 10,000, compact from there (10K, 1.5M). */
export function compact(n: number): string {
  if (Math.abs(n) < 10000) return n.toLocaleString("en-US");
  if (Math.abs(n) < 1e6) return (n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  return (n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "M";
}

export function dateTime(at: Date | string | null): string {
  if (!at) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SALES_TIMEZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(at));
}

/** "9 Nov" for a YYYY-MM-DD day. */
export function dayLabel(day: string, withYear = false): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(
    new Date(day + "T00:00:00Z"),
  );
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return (p > 0 && p < 1 ? "<1" : Math.round(p)) + "%";
}

/** Change against the period before: "+12%", null when there's nothing to compare with. */
export function change(now: number, before: number): { text: string; up: boolean } | null {
  if (!before) return null;
  const p = Math.round(((now - before) / before) * 100);
  return { text: (p > 0 ? "+" : p < 0 ? "−" : "±") + Math.abs(p) + "%", up: p >= 0 };
}

type Tone = "success" | "warning" | "neutral" | "danger";

/** Order statuses: a label and a tone (StatusBadge) go with every status. */
export const ORDER_STATUS: Record<string, { label: string; tone: Tone; color: string }> = {
  paid: { label: "Paid", tone: "success", color: "#22a06b" },
  pending: { label: "Pending", tone: "warning", color: "#e8a23a" },
  cancelled: { label: "Cancelled", tone: "neutral", color: "#8f8b82" },
  declined: { label: "Declined", tone: "danger", color: "#e5383b" },
  failed: { label: "Failed", tone: "danger", color: "#a3101f" },
};

export function orderStatus(s: string) {
  return ORDER_STATUS[s] || { label: s, tone: "neutral" as Tone, color: "#8f8b82" };
}

/** IFZA's payment status (the website's lib/shop/ifza.ts), and the website's own while the card is with the bank. */
export const PAYMENT_STATUS: Record<string, string> = {
  PAID: "Paid", CREATED: "Waiting for the card", PENDING: "Processing", ON_HOLD: "On hold (review)", DECLINED: "Declined",
  CANCELLED: "Cancelled", EXPIRED: "Expired", CHECKED_OUT: "With the bank (3-D Secure)", REFUSED: "Card refused",
};

/** The order's tickets in one line: "2 × Ruby Red, 3 days; 1 × Pearly White, Friday & Saturday". */
export function itemsText(items: { name: string; quantity: number }[]): string {
  return items.map((i) => i.quantity + " × " + i.name).join("; ");
}
