import type {
  EntryPolicy,
  MembershipStatus,
  ScanResult,
  TicketStatus,
  UserStatus,
} from "@/generated/prisma/enums";
import { hasEntitlement, type EntitlementMap } from "./entitlements";

/**
 * Access decision engine (pure, no I/O). Given the live state of a ticket, its member and
 * the checkpoint being scanned, decide whether to admit. The order of checks is deliberate:
 * hard denials (revoked / suspended) win over timing, timing over zone, zone over re-use.
 */
export type AccessInput = {
  now: Date;
  /** "YYYY-MM-DD" in the event timezone */
  localDate: string;
  credential: { revokedAt: Date | null; revokeReason: string | null } | null;
  ticket: {
    status: TicketStatus;
    validFrom: Date;
    validUntil: Date;
    entryPolicy: EntryPolicy;
    zoneIds: string[];
  };
  userStatus: UserStatus;
  membershipStatus: MembershipStatus | null;
  zone: { id: string; active: boolean; requiredEntitlementCode: string | null };
  entitlements: EntitlementMap;
  checkIns: { zoneId: string; localDate: string }[];
};

export type AccessReason =
  | "OK"
  | "CREDENTIAL_REPLACED"
  | "TICKET_REVOKED"
  | "TICKET_SUSPENDED"
  | "ACCOUNT_DISABLED"
  | "NO_MEMBERSHIP"
  | "MEMBERSHIP_INACTIVE"
  | "NOT_VALID_YET"
  | "TICKET_EXPIRED"
  | "ZONE_INACTIVE"
  | "ZONE_NOT_ON_TICKET"
  | "ENTITLEMENT_MISSING"
  | "ALREADY_USED";

export type AccessDecision = {
  result: ScanResult;
  reason: AccessReason;
  /** Uniqueness key for TicketCheckIn when admitted; null = generate a unique one (re-entry). */
  entryKey: string | null;
};

const deny = (result: ScanResult, reason: AccessReason): AccessDecision => ({ result, reason, entryKey: null });

export function entryKeyFor(policy: EntryPolicy, localDate: string): string | null {
  if (policy === "SINGLE_ENTRY") return "once";
  if (policy === "DAILY_ENTRY") return `day:${localDate}`;
  return null;
}

export function evaluateAccess(i: AccessInput): AccessDecision {
  if (i.credential?.revokedAt) return deny("REVOKED", "CREDENTIAL_REPLACED");
  if (i.ticket.status === "REVOKED") return deny("REVOKED", "TICKET_REVOKED");
  if (i.ticket.status === "SUSPENDED") return deny("SUSPENDED", "TICKET_SUSPENDED");
  if (i.userStatus === "DISABLED") return deny("SUSPENDED", "ACCOUNT_DISABLED");
  if (!i.membershipStatus) return deny("INVALID", "NO_MEMBERSHIP");
  if (i.membershipStatus !== "ACTIVE") return deny("SUSPENDED", "MEMBERSHIP_INACTIVE");

  if (i.now < i.ticket.validFrom) return deny("NOT_VALID_YET", "NOT_VALID_YET");
  if (i.ticket.status === "EXPIRED" || i.now > i.ticket.validUntil) return deny("EXPIRED", "TICKET_EXPIRED");

  if (!i.zone.active) return deny("WRONG_ACCESS_ZONE", "ZONE_INACTIVE");
  if (!i.ticket.zoneIds.includes(i.zone.id)) return deny("WRONG_ACCESS_ZONE", "ZONE_NOT_ON_TICKET");
  if (i.zone.requiredEntitlementCode && !hasEntitlement(i.entitlements, i.zone.requiredEntitlementCode)) {
    return deny("WRONG_ACCESS_ZONE", "ENTITLEMENT_MISSING");
  }

  const zoneCheckIns = i.checkIns.filter((c) => c.zoneId === i.zone.id);
  if (i.ticket.status === "USED") return deny("ALREADY_USED", "ALREADY_USED");
  if (i.ticket.entryPolicy === "SINGLE_ENTRY" && zoneCheckIns.length > 0) {
    return deny("ALREADY_USED", "ALREADY_USED");
  }
  if (i.ticket.entryPolicy === "DAILY_ENTRY" && zoneCheckIns.some((c) => c.localDate === i.localDate)) {
    return deny("ALREADY_USED", "ALREADY_USED");
  }

  return { result: "VALID", reason: "OK", entryKey: entryKeyFor(i.ticket.entryPolicy, i.localDate) };
}

/** After admitting a SINGLE_ENTRY ticket: is every zone on it now consumed? */
export function isTicketFullyUsed(policy: EntryPolicy, zoneIds: string[], checkedInZoneIds: string[]): boolean {
  if (policy !== "SINGLE_ENTRY" || zoneIds.length === 0) return false;
  return zoneIds.every((z) => checkedInZoneIds.includes(z));
}

export type ScanSeverity = "success" | "warning" | "danger";

export function scanSeverity(result: ScanResult, reason?: string): ScanSeverity {
  switch (result) {
    case "VALID":
      return "success";
    case "ALREADY_USED":
    case "NOT_VALID_YET":
    case "WRONG_ACCESS_ZONE":
      return "warning";
    case "EXPIRED":
      return reason === "QR_EXPIRED" ? "warning" : "danger";
    default:
      return "danger";
  }
}

export const SCAN_RESULT_LABELS: Record<ScanResult, string> = {
  VALID: "Valid",
  ALREADY_USED: "Already used",
  NOT_VALID_YET: "Not valid yet",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
  INVALID: "Invalid",
  WRONG_ACCESS_ZONE: "Wrong access zone",
  SUSPENDED: "Suspended",
};

export const ACCESS_REASON_MESSAGES: Record<AccessReason | "QR_EXPIRED" | "QR_FORGED" | "QR_MALFORMED" | "UNKNOWN_CREDENTIAL" | "UNKNOWN_TICKET", string> = {
  OK: "Access granted.",
  CREDENTIAL_REPLACED: "This QR code has been replaced by a newer credential.",
  TICKET_REVOKED: "This ticket has been revoked.",
  TICKET_SUSPENDED: "This ticket is suspended.",
  ACCOUNT_DISABLED: "The member account is disabled.",
  NO_MEMBERSHIP: "No membership on record for this member.",
  MEMBERSHIP_INACTIVE: "The membership is not active.",
  NOT_VALID_YET: "This ticket is not valid yet.",
  TICKET_EXPIRED: "This ticket has expired.",
  ZONE_INACTIVE: "This checkpoint is closed.",
  ZONE_NOT_ON_TICKET: "This ticket does not include this area.",
  ENTITLEMENT_MISSING: "The membership tier does not include this area.",
  ALREADY_USED: "This ticket has already been used here.",
  QR_EXPIRED: "QR code timed out. Ask the member to reopen their ticket to refresh it.",
  QR_FORGED: "QR code signature is not valid.",
  QR_MALFORMED: "This is not a CLUB JOIA credential.",
  UNKNOWN_CREDENTIAL: "Credential not recognised.",
  UNKNOWN_TICKET: "No ticket found with that number.",
};
