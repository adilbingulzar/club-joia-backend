import type { Prisma } from "@/generated/prisma/client";
import { ConciergeCategory, DeliveryChannel } from "@/generated/prisma/enums";

/**
 * MySQL has no array columns, so list fields (users.concierge_categories, notifications.channels,
 * members' dormant networking lists) are stored as JSON arrays. Prisma types them as JsonValue;
 * these helpers narrow them back to typed lists at the service boundary.
 *
 * Only values from `allowed` are kept (when given), so a hand-edited row can never smuggle an
 * unknown enum value into the app. Anything that is not an array reads as an empty list.
 */
export function jsonList<T extends string>(value: Prisma.JsonValue | null | undefined, allowed?: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const strings = value.filter((v): v is string => typeof v === "string");
  return (allowed ? strings.filter((v) => (allowed as readonly string[]).includes(v)) : strings) as T[];
}

const CONCIERGE_CATEGORIES = Object.values(ConciergeCategory);
const DELIVERY_CHANNELS = Object.values(DeliveryChannel);

export const conciergeCategoryList = (value: Prisma.JsonValue | null | undefined): ConciergeCategory[] =>
  jsonList(value, CONCIERGE_CATEGORIES);

export const deliveryChannelList = (value: Prisma.JsonValue | null | undefined): DeliveryChannel[] =>
  jsonList(value, DELIVERY_CHANNELS);
