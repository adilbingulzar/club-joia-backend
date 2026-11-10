import type { ConciergeCategory, ConciergeStatus, Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";

/** Pure concierge access rules, shared by the service layer and (future) AI concierge agent. */

export type ConciergeViewer = { role: Role; memberId: string | null };

export function canViewConciergeRequest(viewer: ConciergeViewer, request: { memberId: string }): boolean {
  if (can(viewer.role, "concierge:view_all")) return true;
  return viewer.role === "MEMBER" && viewer.memberId !== null && viewer.memberId === request.memberId;
}

export function canSeeInternalNotes(role: Role): boolean {
  return can(role, "concierge:internal_notes");
}

export function canManageConcierge(role: Role): boolean {
  return can(role, "concierge:manage");
}

export const OPEN_CONCIERGE_STATUSES: ConciergeStatus[] = ["NEW", "IN_PROGRESS", "WAITING_FOR_MEMBER", "CONFIRMED"];
export const CLOSED_CONCIERGE_STATUSES: ConciergeStatus[] = ["COMPLETED", "CANCELLED"];

/** Members may only cancel their own request while it is still open, and may reply to open requests. */
export function memberCanCancel(status: ConciergeStatus): boolean {
  return status === "NEW" || status === "IN_PROGRESS" || status === "WAITING_FOR_MEMBER";
}

export function memberCanReply(status: ConciergeStatus): boolean {
  return OPEN_CONCIERGE_STATUSES.includes(status);
}

export const CONCIERGE_STATUS_LABELS: Record<ConciergeStatus, string> = {
  NEW: "Received",
  IN_PROGRESS: "In progress",
  WAITING_FOR_MEMBER: "Awaiting your reply",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Staff-facing labels (members see the softer wording above). */
export const CONCIERGE_STATUS_STAFF_LABELS: Record<ConciergeStatus, string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  WAITING_FOR_MEMBER: "Waiting for member",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const CONCIERGE_CATEGORY_LABELS = {
  TRANSPORT: "Transport",
  DINING: "Dining",
  HOTEL: "Hotel",
  YACHT: "Yacht",
  NIGHTLIFE: "Nightlife",
  TICKET_SUPPORT: "Ticket support",
  SPECIAL_REQUEST: "Special request",
  OTHER: "Other",
} as const;

// ─── Staff alert routing ────────────────────────────────────────────────────

export type AlertCandidate = { id: string; role: Role; status: string; conciergeCategories: ConciergeCategory[] };

/**
 * Who is alerted about a NEW concierge request, by position and request category:
 *   1. active concierge-team members responsible for the category (their categories include it),
 *      plus CONCIERGE-role generalists (no categories set);
 *   2. if nobody matches, escalate to active admins / super admins so no request goes unseen.
 * Check-in staff never receive concierge alerts.
 */
export function selectNewRequestRecipients<T extends AlertCandidate>(candidates: T[], category: ConciergeCategory): T[] {
  const team = candidates.filter((c) => c.status === "ACTIVE" && canManageConcierge(c.role));
  const responsible = team.filter(
    (c) => c.conciergeCategories.includes(category) || (c.role === "CONCIERGE" && c.conciergeCategories.length === 0),
  );
  if (responsible.length > 0) return responsible;
  return team.filter((c) => c.role === "ADMIN" || c.role === "SUPER_ADMIN");
}
