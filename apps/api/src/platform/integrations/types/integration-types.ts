export type IntegrationProvider =
  | 'surepass_pan'      // PAN external verification
  | 'razorpay_ifsc'     // IFSC bank verification (free public API)
  | 'tally_export'      // Tally accounting XML
  | 'quickbooks_export' // QuickBooks IIF export
  | 'regulatory_feed'   // Government regulatory update feed
  | 'decentro_pan'      // fallback PAN provider
  | 'signzy_pan'        // fallback PAN provider
  | 'penny_drop'        // optional bank account penny-drop
  | 'aadhaar_okyc'      // Aadhaar Offline e-KYC / licensed AUA aggregator (Phase 2)

export type IntegrationStatus = 'active' | 'degraded' | 'not_configured' | 'error'

export interface IntegrationAdapterResult<T = unknown> {
  provider:    IntegrationProvider
  status:      IntegrationStatus
  data?:       T
  error?:      string
  source:      'external' | 'local'  // which verification source was used
  latency_ms?: number
}

export interface IntegrationConfig {
  provider:   IntegrationProvider
  enabled:    boolean
  api_key?:   string
  base_url?:  string
  timeout_ms: number
}
