/**
 * useGuidance — resolves whether a guidance type is enabled for the current
 * tenant + role + module. Reads the tenant guidance config (cached query).
 * Non-blocking: defaults to DEFAULT_GUIDANCE_CONFIG until/if the query resolves.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import {
  DEFAULT_GUIDANCE_CONFIG,
  type GuidanceConfig, type GuidanceModule, type GuidanceType, type GuidanceFeature,
} from './guidance-config'

const FEATURE_FOR: Record<GuidanceType, GuidanceFeature> = {
  help:    'enable_help_framework',
  process: 'enable_process_guides',
  why:     'enable_why_explanations',
  field:   'enable_field_guidance',
}

export function useGuidanceConfig(): GuidanceConfig {
  const { data } = useQuery({
    queryKey: ['guidance-config'],
    queryFn: () => api.get<{ data: GuidanceConfig }>('/workspace/guidance/config').then(r => r.data),
    staleTime: 60_000,
    placeholderData: DEFAULT_GUIDANCE_CONFIG,
  })
  return data ?? DEFAULT_GUIDANCE_CONFIG
}

export function useGuidance(module: GuidanceModule) {
  const role = useAuthStore(s => s.profile?.role) ?? 'employee'
  const cfg  = useGuidanceConfig()

  const roleEnabled =
    role === 'employee' ? cfg.roles.employee_help_enabled
    : role === 'manager' ? cfg.roles.manager_help_enabled
    : role === 'hr_admin' ? cfg.roles.hr_help_enabled
    : cfg.roles.admin_help_enabled // super_admin

  function isEnabled(type: GuidanceType): boolean {
    return !!cfg.features.enable_help_framework
        && roleEnabled
        && !!cfg.modules[module]
        && !!cfg.features[FEATURE_FOR[type]]
  }

  return { role, isEnabled }
}
