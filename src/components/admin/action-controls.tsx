"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { Button, SubmitButton } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/joia/confirm-dialog";
import type { ActionError, ActionResult } from "@/lib/errors";

export type AdminFormState = ActionResult<{ message?: string; link?: string; redirect?: string; href?: { url: string; label: string } } | undefined> | undefined;

/** Admin form bound to a Server Action; shows success / error and optional hand-off links. */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  className,
  resetOnSuccess,
  submitVariant = "primary",
}: {
  action: (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
  children: React.ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitVariant?: "primary" | "secondary" | "danger";
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<AdminFormState, FormData>(async (prev, form) => {
    const res = await action(prev, form);
    if (res?.ok && res.data?.redirect) router.push(res.data.redirect);
    return res;
  }, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-4"} noValidate key={resetOnSuccess && state?.ok ? JSON.stringify(state) : undefined}>
      {state && !state.ok && <FormMessage tone="light" error={state.error} />}
      {state?.ok && state.data?.message && <FormMessage tone="light" success={state.data.message} />}
      {state?.ok && state.data?.link && <HandoffLink link={state.data.link} />}
      {state?.ok && state.data?.href && (
        <Link href={state.data.href.url} className="inline-block text-sm text-ruby underline-offset-4 hover:underline">
          {state.data.href.label} →
        </Link>
      )}
      {children}
      <SubmitButton variant={submitVariant} size="sm" pendingLabel="Saving">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

/** Shows a one-time link (activation / reset) for manual hand-off while email isn't configured. */
export function HandoffLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-ink">
      <p className="font-medium">Email delivery is not configured — share this one-time link securely with the recipient:</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1">{link}</code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
          className="grid size-7 place-items-center rounded hover:bg-black/5"
          aria-label="Copy link"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

/** A button that runs an action, optionally after confirmation, then refreshes the page. */
export function ActionButton({
  run,
  label,
  confirm,
  variant = "secondary",
  size = "sm",
}: {
  run: () => Promise<ActionResult<unknown>>;
  label: string;
  confirm?: { title: string; description?: string; confirmLabel?: string; destructive?: boolean };
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const exec = () =>
    start(async () => {
      const res = await run();
      setOpen(false);
      if (!res.ok) return setError(res.error);
      setError(null);
      const data = res.data as { link?: string } | undefined;
      if (data?.link) setLink(data.link);
      router.refresh();
    });
  return (
    <div className="inline-flex flex-col gap-2">
      <Button variant={variant} size={size} loading={pending && !confirm} onClick={() => (confirm ? setOpen(true) : exec())}>
        {label}
      </Button>
      {error && <FormMessage tone="light" error={error} />}
      {link && <HandoffLink link={link} />}
      {confirm && (
        <ConfirmDialog
          tone="light"
          open={open}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel ?? label}
          destructive={confirm.destructive}
          pending={pending}
          onCancel={() => setOpen(false)}
          onConfirm={exec}
        />
      )}
    </div>
  );
}
