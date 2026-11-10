import Link from "next/link";
import { Bell } from "lucide-react";
import { JoiaLogo } from "@/components/joia/joia-logo";
import { MemberAvatar } from "@/components/joia/member-avatar";
import { getActor } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { unreadCount } from "@/services/notification.service";

/** Static shell of the header; personalised parts stream in via <MemberHeaderActions />. */
export function MemberHeaderShell({ children }: { children: React.ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line/60 bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between px-5">
        <Link href="/" aria-label="CLUB JOIA 300 home">
          <JoiaLogo variant="color" width={112} priority />
        </Link>
        <div className="flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}

export async function MemberHeaderActions() {
  const actor = await getActor();
  if (!actor?.memberId) return null;
  const [count, member] = await Promise.all([
    unreadCount(actor),
    db.member.findUnique({ where: { id: actor.memberId }, select: { firstName: true, lastName: true, profilePhotoKey: true } }),
  ]);
  return (
    <>
      <Link href="/notifications" className="relative grid size-10 place-items-center rounded-full text-pearl-muted hover:text-pearl" aria-label={count ? `Notifications, ${count} unread` : "Notifications"}>
        <Bell className="size-5" strokeWidth={1.6} aria-hidden />
        {count > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-ruby px-1 text-[9px] font-semibold leading-4 text-white" aria-hidden>
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Link>
      <Link href="/profile" aria-label="Your profile">
        <MemberAvatar
          firstName={member?.firstName}
          lastName={member?.lastName}
          photoUrl={member?.profilePhotoKey ? `/api/files/${member.profilePhotoKey}` : null}
          size={34}
        />
      </Link>
    </>
  );
}
