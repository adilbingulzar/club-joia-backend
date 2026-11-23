"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/generated/prisma/enums";
import { STAFF_ROLE_VALUES } from "@/validators/admin";
import { changeRoleAction } from "../actions";

export function RoleSelect({ userId, role }: { userId: string; role: Role }) {
  // Older accounts may hold a role that is no longer offered: keep it listed so the select shows it.
  const roles: Role[] = (STAFF_ROLE_VALUES as readonly Role[]).includes(role) ? [...STAFF_ROLE_VALUES] : [role, ...STAFF_ROLE_VALUES];
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
        {roles.map((r) => (
          <option key={r} value={r} disabled={!(STAFF_ROLE_VALUES as readonly Role[]).includes(r)}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
      {error && <p className="mt-1 text-[11px] text-ruby">{error}</p>}
    </div>
  );
}
