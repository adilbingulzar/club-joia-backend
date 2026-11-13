/** Orders and pre-registrations as CSV for Excel: UTF-8 with a BOM so Excel reads the names right. */
import type { PreRegistration, SalesOrderRow } from "@/services/sales.service";
import { dateTime, itemsText, orderStatus } from "./format";

/** A cell Excel won't run as a formula (a value starting with = + - @ gets a leading '). */
function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(head: string[], rows: (string | number | null | undefined)[][]): string {
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const ORDER_COLUMNS = ["Date (Dubai)", "Order", "Status", "Name", "Email", "Phone", "Country", "Tickets", "Quantity", "Amount", "Currency", "Paid at (Dubai)", "Tickets issued", "Note"];

export function ordersCsv(orders: SalesOrderRow[]): string {
  return csv(
    ORDER_COLUMNS,
    orders.map((o) => [
      dateTime(o.createdAt), o.ref, orderStatus(o.status).label, o.buyer.name, o.buyer.email, o.buyer.mobile, o.buyer.country,
      itemsText(o.items), o.items.reduce((s, i) => s + i.quantity, 0), o.amount, o.currency, dateTime(o.paidAt), o.tickets, o.error,
    ]),
  );
}

export const REGISTRATION_COLUMNS = ["Registered (Dubai)", "Updated (Dubai)", "First name", "Last name", "Email", "Mobile", "Country", "Membership interest", "Heard about us", "Message", "Marketing emails"];

export function registrationsCsv(list: PreRegistration[]): string {
  return csv(
    REGISTRATION_COLUMNS,
    list.map((r) => [
      dateTime(r.createdAt), dateTime(r.updatedAt), r.firstName, r.lastName, r.email, r.phone, r.country, r.tier, r.source, r.message, r.marketing ? "yes" : "no",
    ]),
  );
}
