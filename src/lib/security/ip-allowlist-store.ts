/*
 * The IP allowlist as the proxy applies it (src/proxy.ts): the addresses super admins keep at
 * /admin/ip-allowlist (table ip_allowlist) together with IP_ALLOWLIST in .env.
 *
 *  Only those addresses get in, to everything on this site (pages, APIs, files, the member app, the
 *  door scanner); any other gets 403. Both empty: nobody gets in. While the table can't be read
 *  (database down, or before its migration), the last list read counts; before any, only
 *  IP_ALLOWLIST's addresses get in.
 *
 * IP_ALLOWLIST is the owner's way back in: it can't be changed from the admin, so a mistake in the
 * panel can't lock out the addresses listed there.
 *
 * The table is read at most every 30 seconds per server process. A change in the admin clears this
 * process's copy at once (the copy lives on globalThis, shared with the admin's code).
 */
import { db } from "@/lib/db";
import { allowed, clientIp, parseAllowlist } from "./ip-allowlist";

type Ranges = ReturnType<typeof parseAllowlist>;

const TTL_MS = 30_000;

type Store = { at: number; ranges: Ranges; loading: Promise<Ranges> | null };
const g = globalThis as unknown as { __joiaIpAllowlist?: Store };
const store = (g.__joiaIpAllowlist ??= { at: 0, ranges: [], loading: null });

let envCache: { text: string; ranges: Ranges } | null = null;
function envRanges(text: string | undefined = process.env.IP_ALLOWLIST): Ranges {
  const t = String(text || "").trim();
  if (!envCache || envCache.text !== t) envCache = { text: t, ranges: parseAllowlist(t) };
  return envCache.ranges;
}

/** The panel's addresses as ranges; on a database error, the last ones read. */
async function tableRanges(): Promise<Ranges> {
  if (Date.now() - store.at < TTL_MS) return store.ranges;
  store.loading ??= db.ipAllowlistEntry
    .findMany({ select: { address: true } })
    .then((rows) => {
      store.ranges = parseAllowlist(rows.map((r) => r.address).join(" "));
      store.at = Date.now();
      return store.ranges;
    })
    .catch((e) => {
      console.error("[ip-allowlist] could not read the list, using the last one:", e instanceof Error ? e.message : e);
      store.at = Date.now() - TTL_MS + 5_000; // try again in 5 seconds
      return store.ranges;
    })
    .finally(() => {
      store.loading = null;
    });
  return store.loading;
}

/** Makes the next request read the table again (after a change in the admin). */
export function forgetIpAllowlist() {
  store.at = 0;
}

/** Whether an address gets in with these panel entries (and IP_ALLOWLIST). */
export function addressAllowed(ip: string, panel: Ranges, env: Ranges = envRanges()): boolean {
  return allowed(ip, env) || allowed(ip, panel);
}

/** Whether this request gets in. */
export async function requestAllowed(headers: Headers): Promise<boolean> {
  return addressAllowed(clientIp(headers), await tableRanges());
}

/** One entry as typed: an IP address or a CIDR range; null when it isn't one. */
export function parseEntry(text: string): Ranges[number] | null {
  const t = text.trim();
  if (!/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(t)) return null;
  const r = parseAllowlist(t);
  return r.length === 1 ? r[0] : null;
}
