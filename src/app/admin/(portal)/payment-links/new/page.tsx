import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { toActionError } from "@/lib/errors";
import { LINK_DAYS, linkCatalog } from "@/services/payment-links.service";
import {
  AdminCard,
  AdminPageHeader,
} from "@/components/admin/admin-data-table";
import { ActionForm } from "@/components/admin/action-controls";
import { LoadingSkeleton } from "@/components/joia/states";
import {
  Checkbox,
  FormMessage,
  SelectField,
  TextField,
} from "@/components/ui/form";
import { createPaymentLinkAction } from "../../actions";
import { TicketPicker } from "./ticket-picker";

export const metadata: Metadata = { title: "New payment link" };

export default function NewPaymentLinkPage() {
  return (
    <Suspense fallback={<LoadingSkeleton lines={10} />}>
      <NewPaymentLink />
    </Suspense>
  );
}

/** The website's checkout form, filled in by staff for a buyer (same fields, same checks, website prices). */
async function NewPaymentLink() {
  const actor = await requirePermissionPage("sales:links");
  let catalog: Awaited<ReturnType<typeof linkCatalog>>;
  try {
    catalog = await linkCatalog(actor);
  } catch (e) {
    return (
      <>
        <AdminPageHeader eyebrow="Sales" title="New payment link" />
        <FormMessage tone="light" error={toActionError(e)} />
      </>
    );
  }
  const countries = catalog.countries.map((c) => ({
    value: c.code,
    label: c.name,
  }));
  const phoneCodes = catalog.countries.map((c) => ({
    value: c.code,
    label: "+" + c.dial + " " + c.name,
  }));

  return (
    <>
      <AdminPageHeader
        eyebrow="Sales"
        title="New payment link"
        description="Fill in the buyer's details as on the website's checkout and choose the tickets. Website prices apply. You get a link to copy, and it can be emailed to the buyer."
        actions={
          <Link
            href="/admin/payment-links"
            className="text-xs text-black/50 hover:text-ink"
          >
            Back to payment links
          </Link>
        }
      />
      <ActionForm
        action={createPaymentLinkAction}
        submitLabel="Create payment link"
        className="space-y-6"
      >
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <AdminCard title="Tickets">
              <TicketPicker
                tickets={catalog.tickets}
                currency={catalog.currency}
                max={catalog.maxPerTicket}
              />
            </AdminCard>
          </div>
          <div className="space-y-6">
            <AdminCard title="Buyer">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  tone="light"
                  label="First name"
                  name="firstName"
                  required
                  maxLength={100}
                />
                <TextField
                  tone="light"
                  label="Last name"
                  name="lastName"
                  required
                  maxLength={100}
                />
                <TextField
                  tone="light"
                  label="Email"
                  name="email"
                  type="email"
                  required
                  maxLength={150}
                  className="sm:col-span-2"
                  hint="The confirmation and the tickets go to this address."
                />
                <TextField
                  tone="light"
                  label="Address"
                  name="address"
                  required
                  maxLength={200}
                  className="sm:col-span-2"
                />
                <TextField
                  tone="light"
                  label="Zip code"
                  name="zipcode"
                  required
                  maxLength={20}
                />
                <TextField
                  tone="light"
                  label="City"
                  name="city"
                  required
                  maxLength={100}
                />
                <SelectField
                  tone="light"
                  label="Country"
                  name="country"
                  required
                  options={countries}
                  placeholder="Select country"
                />
                <SelectField
                  tone="light"
                  label="Gender"
                  name="gender"
                  options={[
                    { value: "male", label: "Male" },
                    { value: "female", label: "Female" },
                    { value: "nogender", label: "Prefer not to say" },
                  ]}
                  placeholder="Select gender"
                />
                <TextField
                  tone="light"
                  label="Date of birth"
                  name="birthday"
                  type="date"
                />
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 sm:col-span-2">
                  <SelectField
                    tone="light"
                    label="Code"
                    name="phoneCode"
                    required
                    options={phoneCodes}
                    placeholder="Code"
                  />
                  <TextField
                    tone="light"
                    label="Mobile"
                    name="phone"
                    type="tel"
                    required
                    maxLength={20}
                  />
                </div>
              </div>
              <div className="mt-5 space-y-2">
                <Checkbox
                  tone="light"
                  name="over21"
                  required
                  label="The buyer confirms they are older than 21."
                />
                <Checkbox
                  tone="light"
                  name="terms"
                  required
                  label="The buyer agrees to the terms and conditions."
                />
              </div>
            </AdminCard>
            <AdminCard title="Payment link">
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-black/60">
                  Valid for
                </legend>
                <div className="grid grid-cols-5 gap-2">
                  {LINK_DAYS.map((d) => (
                    <label
                      key={d}
                      className="cursor-pointer rounded-xl border border-black/15 px-2 py-2.5 text-center text-sm transition-colors hover:bg-black/5 has-checked:border-ink has-checked:bg-ink has-checked:text-pearl has-focus-visible:ring-2 has-focus-visible:ring-ink/40"
                    >
                      <input
                        type="radio"
                        name="linkDays"
                        value={d}
                        defaultChecked={d === 1}
                        className="sr-only"
                      />
                      {d} {d === 1 ? "day" : "days"}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-4">
                <Checkbox
                  tone="light"
                  name="sendEmail"
                  defaultChecked
                  label="Email the payment link to the buyer"
                />
              </div>
            </AdminCard>
          </div>
        </div>
      </ActionForm>
    </>
  );
}
