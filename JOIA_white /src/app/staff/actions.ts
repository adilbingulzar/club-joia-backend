"use server";

import { z } from "zod";
import { authedAction } from "@/lib/actions";
import { checkIn, deny, scan } from "@/services/qr.service";

const scanSchema = z
  .object({
    token: z.string().max(512).optional(),
    ticketNumber: z.string().trim().max(40).optional(),
    zoneId: z.string().min(1, "Choose a checkpoint.").max(64),
    deviceInfo: z.string().max(300).optional(),
  })
  .refine((v) => v.token || v.ticketNumber, { message: "Scan a QR code or enter a ticket number." });

export async function scanAction(input: unknown) {
  return authedAction(scanSchema, input, (actor, d) => scan(actor, d));
}

export async function checkInAction(scanLogId: string) {
  return authedAction(z.string().min(1).max(64), scanLogId, (actor, id) => checkIn(actor, id));
}

export async function denyAction(input: unknown) {
  return authedAction(z.object({ scanLogId: z.string().min(1).max(64), note: z.string().max(200).optional() }), input, (actor, d) =>
    deny(actor, d.scanLogId, d.note),
  );
}
