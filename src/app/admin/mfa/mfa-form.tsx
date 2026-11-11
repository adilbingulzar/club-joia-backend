"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { FormMessage, TextField } from "@/components/ui/form";
import type { AuthFormState } from "@/app/(auth)/actions";
import { verifyMfaAction } from "./actions";

export function MfaForm({ next, enrolling }: { next?: string; enrolling: boolean }) {
  const [state, action] = useActionState<AuthFormState, FormData>(verifyMfaAction, undefined);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage error={state?.error} />
      <input type="hidden" name="next" value={next ?? ""} />
      <TextField
        label={enrolling ? "Code from the app" : "Authentication code"}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        placeholder="123456"
        required
        autoFocus
        error={state?.error?.fieldErrors?.code}
      />
      <SubmitButton size="lg" className="w-full" pendingLabel="Checking">
        {enrolling ? "Confirm and continue" : "Continue"}
      </SubmitButton>
    </form>
  );
}
