import "server-only";
import { AppError } from "@/lib/errors";
import { issueActivation } from "./auth.service";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";
import { shopApi } from "./payment-links.service";

/**
 * Admin > Sales "Make member": the buyer of a paid website order becomes a member, with the order's
 * tier and tickets. The website does it (club-joia-300-next app/api/staff make-member, lib/shop/fulfil.ts
 * makeMember: the member of that email if there is one, so no duplicates), with who pressed it in the
 * audit log; then a new account gets its invitation (activation link to the website) from here.
 */
export type MadeMember = {
  memberId: string;
  membershipNumber: string;
  newMember: boolean;
  tickets: number;
  notes: string[];
  invitation: { link: string; delivered: boolean } | null;
};

export async function makeMemberFromOrder(actor: Actor, ref: string): Promise<MadeMember> {
  requirePermission(actor, "members:manage");
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(ref)) throw new AppError("VALIDATION", "Unknown order.");
  const made = await shopApi<{ memberId: string; userId: string; membershipNumber: string; newMember: boolean; pendingActivation: boolean; tickets: number; notes: string[] }>(
    "make-member",
    { ref, createdBy: actor.userId },
  );
  // the invitation goes to accounts not activated yet (an existing active member just gets the tickets)
  const invitation = made.pendingActivation ? await issueActivation(made.userId) : null;
  await recordAudit(actor, {
    action: "sales.make_member",
    entityType: "order",
    entityId: ref,
    after: { memberId: made.memberId, membershipNumber: made.membershipNumber, newMember: made.newMember, tickets: made.tickets, invited: Boolean(invitation), notes: made.notes },
  });
  return { memberId: made.memberId, membershipNumber: made.membershipNumber, newMember: made.newMember, tickets: made.tickets, notes: made.notes, invitation };
}
