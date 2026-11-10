/** Helpers for reading list-page query strings safely. */
export type SP = Record<string, string | string[] | undefined>;

export function sp(params: SP, key: string): string | undefined {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length <= 200 ? s : undefined;
}

export function spEnum<T extends string>(params: SP, key: string, allowed: readonly T[]): T | undefined {
  const v = sp(params, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function spPage(params: SP): number {
  const n = Number(sp(params, "page"));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Build a URL preserving current filters but changing some keys. */
export function withParams(base: string, params: SP, changes: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) q.set(k, s);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === "") q.delete(k);
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
