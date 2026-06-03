/**
 * Workforce Guidance Framework — config types + tenant defaults.
 * Flags are sourced from tenants.settings.guidance (see API /workspace/guidance/config).
 * Shape MUST stay identical to apps/api/src/lib/guidance-defaults.ts.
 */

export type GuidanceModule =
  | 'employee_master' | 'attendance' | 'leave' | 'payroll' | 'compensation'
  | 'assets' | 'onboarding' | 'separation' | 'executive_intelligence'

export type GuidanceFeature =
  | 'enable_help_framework' | 'enable_process_guides' | 'enable_field_guidance'
  | 'enable_why_explanations' | 'enable_walkthroughs' | 'enable_context_assistant'

export type GuidanceType = 'help' | 'process' | 'why' | 'field'

export interface GuidanceConfig {
  features: Record<GuidanceFeature, boolean>
  roles: {
    employee_help_enabled: boolean
    manager_help_enabled:  boolean
    hr_help_enabled:       boolean
    admin_help_enabled:    boolean
  }
  modules: Record<GuidanceModule, boolean>
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

/** Body shape for a guidance entry — structurally compatible with ExplainabilityDrawer's prop. */
export interface GuidanceBody {
  summary?:              string
  contributing_factors?: string[]
  recommended_actions?:  string[]
  steps?:                string[]
}

export interface GuidanceEntry {
  title: string
  body:  GuidanceBody
}

export interface GuidanceContentRow {
  content_type: GuidanceType
  role:         string
  field_key:    string
  title:        string | null
  body:         GuidanceBody
}
