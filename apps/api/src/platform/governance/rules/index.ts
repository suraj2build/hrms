export * from './types/index.js'
export * from './registry/index.js'

// Side-effect import — registers all 4 statutory compliance rules onto
// governanceRuleRegistry. Without this, the registry stays permanently
// empty and ComplianceEvaluator.evaluate() reports { compliant: true,
// violations: [] } for every event regardless of actual content.
import './compliance/index.js'
