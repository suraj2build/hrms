/**
 * ExplainabilityResult — standardized AI/governance explanation contract.
 *
 * MANDATORY USAGE: All future AI outputs, governance alerts,
 * compliance failures and anomaly detection must implement this interface.
 *
 * AI RULES:
 *   MAY:  summarize, explain, classify, recommend, prioritize
 *   MUST NOT: approve payroll, change compliance rules, mutate records, override governance
 */

export interface ExplainabilityResult {
  /** Plain-English summary of the finding or decision */
  summary: string

  /** 0.0–1.0 confidence in the result */
  confidence_score?: number

  /** Key factors that contributed to this result */
  contributing_factors?: string[]

  /** Suggested human actions */
  recommended_actions?: string[]
}
