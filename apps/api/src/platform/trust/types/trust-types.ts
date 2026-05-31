/**
 * Trust infrastructure types — Sprint 3.
 * Shared across verification, scoring, duplicate detection, and graph.
 */

import type { ExplainabilityResult } from '../../ai/types/explainability.js'
import type { EventSeverity } from '../../events/types/platform-event.js'

export type VerificationType = 'pan' | 'aadhaar' | 'bank_account' | 'ifsc' | 'document' | 'phone' | 'email'

export type VerificationStatus =
  | 'verified'      // successfully confirmed by provider
  | 'partial_match' // provider responded, but name/DOB confidence is low
  | 'needs_review'  // flagged for human review
  | 'failed'        // definitively invalid
  | 'pending'       // awaiting verification run
  | 'skipped'       // no data available
  | 'inconclusive'  // ambiguous provider result
  | 'degraded'      // provider unavailable, fell back to local
  | 'expired'       // too old, re-verification recommended

export interface VerificationResult {
  verification_type:       VerificationType
  status:                  VerificationStatus
  entity_id:               string
  entity_type:             string
  org_id:                  string
  verified_at:             string
  score:                   number       // 0–100
  flags:                   string[]     // e.g. ['name_mismatch', 'duplicate_pan']
  raw_response?:           Record<string, unknown>  // provider response (stripped of PII)
  explainability?:         ExplainabilityResult
  provider_reference?:     string
  name_match_confidence?:  'high' | 'medium' | 'low' | null
  dob_match_confidence?:   'high' | 'medium' | 'low' | null
  degraded_reason?:        string
  retry_count?:            number
}

export type DuplicateType =
  | 'pan' | 'bank_account' | 'phone' | 'nominee_name'
  | 'emergency_contact_phone' | 'device_fingerprint' | 'aadhaar'

export interface DuplicateDetectionResult {
  duplicate_type:       DuplicateType
  entity_id:            string         // the employee being checked
  entity_type:          string
  org_id:               string
  matching_entity_ids:  string[]       // other employees sharing the same value
  value_hash:           string         // SHA-256 of the duplicated value (no PII)
  severity:             EventSeverity
  detected_at:          string
  explainability?:      ExplainabilityResult
}

export type TrustScoreType = 'employee' | 'onboarding' | 'payroll' | 'document'

export interface TrustScoreResult {
  score_type:    TrustScoreType
  entity_id:     string
  org_id:        string
  score:         number          // 0–100, higher = more trustworthy
  severity:      'low' | 'medium' | 'high' | 'critical'
  factors:       string[]
  computed_at:   string
  explainability?: ExplainabilityResult
}

export type GraphEdgeType =
  | 'employee_bank' | 'employee_nominee' | 'employee_phone'
  | 'employee_emergency_contact' | 'employee_document' | 'employee_pan'

export interface WorkforceGraphEdge {
  id?:           string
  org_id:        string
  from_entity:   string      // employee UUID
  from_type:     'employee'
  to_entity:     string      // bank account hash / phone hash / etc.
  to_type:       string      // 'bank_account' | 'phone' | 'pan' | 'nominee' | etc.
  edge_type:     GraphEdgeType
  weight:        number      // 1.0 for direct link
  metadata?:     Record<string, unknown>
  created_at?:   string
}

export type ComplianceRevisionType = 'pf' | 'esi' | 'minimum_wage' | 'overtime' | 'jurisdiction_specific'

export interface ComplianceRevisionEvent {
  id?:               string
  org_id?:           string    // NULL = platform-wide
  revision_type:     ComplianceRevisionType
  jurisdiction:      string    // 'IN', 'IN-MH', etc.
  title:             string
  description:       string
  old_value?:        number
  new_value?:        number
  unit?:             string
  effective_from:    string    // ISO date
  source_reference?: string    // e.g. gazette notification number
  status:            'pending_review' | 'approved' | 'rejected' | 'superseded'
  ingested_at:       string
  reviewed_at?:      string
  reviewed_by?:      string
  explainability?:   ExplainabilityResult
}
