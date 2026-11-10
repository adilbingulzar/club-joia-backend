/**
 * Feature flags for future phases. All default to OFF in V1.
 * Server code reads these; client code receives resolved booleans as props.
 *
 * A flag only gates a module's *entry points* (routes, nav items, service calls).
 * Turning a flag on before its module is built has no effect other than showing
 * the "Coming soon" placeholder where one exists.
 */
export const FEATURE_FLAGS = {
  MEMBER_NETWORK: "FEATURE_MEMBER_NETWORK",
  MEETING_SCHEDULER: "FEATURE_MEETING_SCHEDULER",
  GLOBAL_CHAPTERS: "FEATURE_GLOBAL_CHAPTERS",
  PARTNER_BENEFITS: "FEATURE_PARTNER_BENEFITS",
  AI_CONCIERGE: "FEATURE_AI_CONCIERGE",
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return process.env[FEATURE_FLAGS[flag]] === "true";
}

export function allFeatureFlags(): Record<FeatureFlag, boolean> {
  return Object.fromEntries(
    (Object.keys(FEATURE_FLAGS) as FeatureFlag[]).map((f) => [f, isFeatureEnabled(f)]),
  ) as Record<FeatureFlag, boolean>;
}
