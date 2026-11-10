import "server-only";
import { after } from "next/server";

/**
 * Runs side-effect work (emails, WhatsApp alerts) after the response has been sent when called
 * inside a Next.js request; outside one (scripts, tests) it simply runs and is awaited.
 */
export async function runAfterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}
