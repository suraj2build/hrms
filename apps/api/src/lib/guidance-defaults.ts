/**
 * Guidance framework defaults + deep-merge.
 * Shape MUST stay byte-identical to apps/web/src/lib/guidance/guidance-config.ts
 * (DEFAULT_GUIDANCE_CONFIG). Flags are stored under tenants.settings.guidance.
 */

export interface GuidanceConfig {
  features: {
    enable_help_framework:    boolean
    enable_process_guides:    boolean
    enable_field_guidance:    boolean
    enable_why_explanations:  boolean
    enable_walkthroughs:      boolean
    enable_context_assistant: boolean
  }
  roles: {
    employee_help_enabled: boolean
    manager_help_enabled:  boolean
    hr_help_enabled:       boolean
    admin_help_enabled:    boolean
  }
  modules: {
    employee_master:        boolean
    attendance:             boolean
    leave:                  boolean
    payroll:                boolean
    compensation:           boolean
    assets:                 boolean
    onboarding:             boolean
    separation:             boolean
    executive_intelligence: boolean
  }
}

export const DEFAULT_GUIDANCE_CONFIG: GuidanceConfig = {
  features: {
    enable_help_framework:    true,
    enable_process_guides:    true,
    enable_field_guidance:    true,
    enable_why_explanations:  true,
    enable_walkthroughs:      false,
    enable_context_assistant: false,
  },
  roles: {
    employee_help_enabled: true,
    manager_help_enabled:  true,
    hr_help_enabled:       true,
    admin_help_enabled:    true,
  },
  modules: {
    employee_master:        true,
    attendance:             true,
    leave:                  true,
    payroll:                true,
    compensation:           true,
    assets:                 true,
    onboarding:             true,
    separation:             true,
    executive_intelligence: true,
  },
}

/** Deep-merge a partial guidance config over a base (two levels deep is enough). */
export function mergeGuidance(
  base: GuidanceConfig,
  partial: Partial<{ features: Record<string, boolean>; roles: Record<string, boolean>; modules: Record<string, boolean> }> | null | undefined,
): GuidanceConfig {
  if (!partial) return { ...base, features: { ...base.features }, roles: { ...base.roles }, modules: { ...base.modules } }
  return {
    features: { ...base.features, ...(partial.features ?? {}) } as GuidanceConfig['features'],
    roles:    { ...base.roles,    ...(partial.roles    ?? {}) } as GuidanceConfig['roles'],
    modules:  { ...base.modules,  ...(partial.modules  ?? {}) } as GuidanceConfig['modules'],
  }
}
