/**
 * Compliance rules barrel — importing this module registers all compliance
 * rules onto the governanceRuleRegistry as side-effects.
 *
 * Sprint 2: Governance Intelligence Layer.
 */

// Side-effect imports — each file calls governanceRuleRegistry.register(...)
import './payroll-rules.js'
import './attendance-rules.js'
import './leave-rules.js'
import './compensation-rules.js'

export {}
