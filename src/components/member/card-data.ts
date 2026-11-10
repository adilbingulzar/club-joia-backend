import type { MembershipCardData } from "@/components/joia/metal-membership-card";
import { MEMBERSHIP_STATUS_LABELS } from "@/domain/membership";
import { formatDateOnly } from "@/lib/time";
import type { getMyMembership } from "@/services/membership.service";
import type { getSettings } from "@/services/settings.service";

/** Shapes service data into the props the membership card renders (non-sensitive only). */
export function membershipCardData(
  m: Awaited<ReturnType<typeof getMyMembership>>,
  settings: Awaited<ReturnType<typeof getSettings>>,
): MembershipCardData {
  const ms = m.membership;
  const memberSince = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(m.member.memberSince);
  const validity =
    ms?.startDate && ms?.endDate
      ? `${formatDateOnly(ms.startDate, { month: "short", year: "numeric" })} – ${formatDateOnly(ms.endDate, { month: "short", year: "numeric" })}`
      : ms?.endDate
        ? `Until ${formatDateOnly(ms.endDate, { day: "numeric", month: "short", year: "numeric" })}`
        : null;
  return {
    name: `${m.member.firstName} ${m.member.lastName}`,
    membershipNumber: ms?.membershipNumber ?? m.member.membershipNumber,
    tierName: ms?.tier.displayName ?? "Member",
    theme: ms?.tier.cardTheme ?? "ruby",
    memberSince,
    status: ms ? MEMBERSHIP_STATUS_LABELS[ms.status] : "Pending",
    statusOk: ms?.status === "ACTIVE",
    validity,
    chapter: ms?.homeChapter?.name ?? null,
    supportContact: settings["support.email"],
    termsUrl: settings["legal.termsUrl"],
  };
}
