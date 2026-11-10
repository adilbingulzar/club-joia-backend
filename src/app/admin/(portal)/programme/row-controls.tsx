"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/joia/confirm-dialog";
import { deleteProgrammeItemAction, moveProgrammeItemAction, setProgrammeVisibilityAction } from "../actions";

export function ProgrammeRowControls({ id, visibility, restricted, first, last }: { id: string; visibility: string; restricted: boolean; first: boolean; last: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error?.message ?? "Failed"));
      router.refresh();
    });
  const btn = "grid size-7 place-items-center rounded-md text-black/50 hover:bg-black/5 hover:text-ink disabled:opacity-25";
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex" aria-busy={pending}>
        <button className={btn} disabled={first || pending} onClick={() => run(() => moveProgrammeItemAction(id, "up"))} aria-label="Move up"><ArrowUp className="size-3.5" /></button>
        <button className={btn} disabled={last || pending} onClick={() => run(() => moveProgrammeItemAction(id, "down"))} aria-label="Move down"><ArrowDown className="size-3.5" /></button>
        <button
          className={btn}
          disabled={pending}
          onClick={() => run(() => setProgrammeVisibilityAction(id, visibility !== "DRAFT" ? "DRAFT" : restricted ? "RESTRICTED" : "MEMBERS"))}
          aria-label={visibility === "DRAFT" ? "Publish" : "Unpublish"}
          title={visibility === "DRAFT" ? "Publish" : "Unpublish"}
        >
          {visibility === "DRAFT" ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
        <button className={btn} disabled={pending} onClick={() => setConfirm(true)} aria-label="Delete"><Trash2 className="size-3.5" /></button>
      </div>
      {error && <p className="max-w-40 text-right text-[10px] text-ruby">{error}</p>}
      <ConfirmDialog
        tone="light"
        open={confirm}
        title="Delete programme item?"
        description="Members will no longer see it, and their saved favourites for it are removed."
        confirmLabel="Delete"
        destructive
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          run(() => deleteProgrammeItemAction(id));
        }}
      />
    </div>
  );
}
