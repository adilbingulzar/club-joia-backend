/**
 * Images are uploaded (never linked by URL): columns such as `events.hero_image` and
 * `event_program_items.image` hold a storage key, served through /api/files after an auth check.
 * Values starting with "/" are bundled assets under /public (e.g. seeded artwork).
 * Anything else (external URLs) is ignored.
 */
export function storedImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^[a-z_]+\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(value)) return `/api/files/${value}`;
  return null;
}
