import type { EntitlementValueType } from "@/generated/prisma/enums";

/**
 * Entitlement engine (pure). A member's effective entitlements are:
 *   tier entitlements (only while the membership is ACTIVE)
 *   overlaid with unexpired per-member overrides.
 * Values: BOOLEAN → true/false, INTEGER → number, TEXT → string.
 */
export type EntitlementValue = boolean | number | string;

export type EntitlementGrant = {
  code: string;
  valueType: EntitlementValueType;
  value: unknown;
};

export type EntitlementOverride = EntitlementGrant & { expiresAt: Date | null };

export type EntitlementMap = Record<string, EntitlementValue>;

export function coerceEntitlementValue(valueType: EntitlementValueType, raw: unknown): EntitlementValue | null {
  switch (valueType) {
    case "BOOLEAN":
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      return null;
    case "INTEGER": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      return Number.isInteger(n) ? n : null;
    }
    case "TEXT":
      return typeof raw === "string" ? raw : raw == null ? null : String(raw);
  }
}

export function resolveEntitlements(
  tierGrants: EntitlementGrant[],
  overrides: EntitlementOverride[],
  now: Date,
): EntitlementMap {
  const map: EntitlementMap = {};
  for (const g of tierGrants) {
    const v = coerceEntitlementValue(g.valueType, g.value);
    if (v !== null) map[g.code] = v;
  }
  for (const o of overrides) {
    if (o.expiresAt && o.expiresAt <= now) continue;
    const v = coerceEntitlementValue(o.valueType, o.value);
    if (v !== null) map[o.code] = v;
  }
  return map;
}

/** Truthy test used for gating: true, a positive number, or a non-empty string. */
export function hasEntitlement(map: EntitlementMap, code: string): boolean {
  const v = map[code];
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return v.length > 0 && v !== "none";
  return false;
}

/** Well-known entitlement codes referenced by V1 business logic (catalogue lives in DB). */
export const ENTITLEMENT_CODES = {
  EVENT_ACCESS: "event_access",
  VIP_DECK_ACCESS: "vip_deck_access",
  PRIORITY_CHECKIN: "priority_checkin",
  PREMIUM_PARKING: "premium_parking",
  CONCIERGE_LEVEL: "concierge_level",
  GUEST_PASSES: "guest_passes",
  AFTERPARTY_ACCESS: "afterparty_access",
} as const;
