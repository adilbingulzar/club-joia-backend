import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listChapters } from "@/services/member.service";
import { listTiers } from "@/services/membership.service";
import { AdminCard, AdminPageHeader } from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { Checkbox, SelectField, TextField } from "@/components/ui/form";
import { LoadingSkeleton } from "@/components/joia/states";
import { createMemberAction } from "../../actions";

export const metadata: Metadata = { title: "New member" };

export default function NewMemberPage() {
  return (
    <>
      <AdminPageHeader eyebrow="Members" title="New member" description="Creates the account, profile and an invited membership. The member activates their own account and sets their password." />
      <Suspense fallback={<LoadingSkeleton lines={8} />}>
        <Form />
      </Suspense>
    </>
  );
}

async function Form() {
  await requirePermissionPage("members:manage");
  const [tiers, chapters] = await Promise.all([listTiers(), listChapters()]);
  return (
    <AdminCard className="max-w-3xl">
      <ActionForm action={createMemberAction} submitLabel="Create member">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField tone="light" label="First name" name="firstName" required />
          <TextField tone="light" label="Last name" name="lastName" required />
          <TextField tone="light" label="Email" name="email" type="email" required />
          <TextField tone="light" label="Mobile" name="mobile" type="tel" />
          <SelectField tone="light" label="Membership tier" name="tierId" required placeholder="Choose…" options={tiers.map((t) => ({ value: t.id, label: t.displayName }))} />
          <SelectField tone="light" label="Home chapter" name="homeChapterId" placeholder="—" options={chapters.map((c) => ({ value: c.id, label: c.name }))} />
          <TextField tone="light" label="City" name="city" />
          <TextField tone="light" label="Country" name="country" />
          <TextField tone="light" label="Company" name="company" />
          <TextField tone="light" label="Job title" name="jobTitle" />
          <TextField tone="light" label="Dietary requirements" name="dietaryRequirements" />
          <TextField tone="light" label="Allergies" name="allergies" />
        </div>
        <Checkbox tone="light" name="sendInvitation" defaultChecked label="Send activation invitation now" description="Without an email provider configured, you'll get a one-time link to share securely." />
      </ActionForm>
    </AdminCard>
  );
}
