"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/generated/prisma/enums";
import { changeRoleAction } from "../actions";

const ROLES: Role[] = ["CONCIERGE", "CHECK_IN_STAFF", "ADMIN", "SUPER_ADMIN"];

export function RoleSelect({ userId, role }: { userId: string; role: Role }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div>
      <label className="sr-only" htmlFor={`role-${userId}`}>Role</label>
      <select
        id={`role-${userId}`}
        defaultValue={role}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          if (!window.confirm(`Change role to ${ROLE_LABELS[next as Role]}? They will be signed out.`)) {
            e.target.value = role;
            return;
          }
          start(async () => {
            const r = await changeRoleAction(userId, next);
            setError(r.ok ? null : r.error.message);
            router.refresh();
          });
        }}
        className="h-8 rounded-lg border border-black/12 bg-white px-2 text-xs"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
      {error && <p className="mt-1 text-[11px] text-ruby">{error}</p>}
    </div>
  );
}
