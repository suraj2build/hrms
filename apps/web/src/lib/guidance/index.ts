/**
 * Workforce Guidance Framework — public surface.
 * Reuses the existing ExplainabilityDrawer; no standalone Help Center.
 */
export { GuidanceHeaderActions } from './GuidanceHeaderActions'
export { FieldGuidance } from './FieldGuidance'
export { HelpDrawer, ProcessGuideDrawer, WhyExplanationDrawer } from './drawers'
export { useGuidance, useGuidanceConfig } from './useGuidance'
export { useGuidanceContent } from './useGuidanceContent'
export { resolveGuidance, resolveField } from './guidance-content'
export {
  DEFAULT_GUIDANCE_CONFIG,
  type GuidanceConfig, type GuidanceModule, type GuidanceType,
  type GuidanceFeature, type GuidanceEntry, type GuidanceBody, type GuidanceContentRow,
} from './guidance-config'
