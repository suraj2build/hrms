export type SignalSource = 'governance' | 'trust' | 'operations' | 'security' | 'sla' | 'drift' | 'fabric'

export interface PlatformSignal {
  signal_id:   string
  tenant_id:      string
  source:      SignalSource
  entity_id:   string
  entity_type: string
  event_type:  string
  severity:    'info' | 'warning' | 'high' | 'critical'
  title:       string
  description: string
  metadata?:   Record<string, unknown>
  timestamp:   string
  // Set by signal intelligence:
  priority?:    number   // 0–100, higher = more urgent
  cluster_id?:  string
  suppressed?:  boolean
  suppression_reason?: string
}

export interface SignalCluster {
  cluster_id:   string
  tenant_id:       string
  label:        string
  signals:      PlatformSignal[]
  severity:     'info' | 'warning' | 'high' | 'critical'
  entity_ids:   string[]
  event_types:  string[]
  created_at:   string
}

export interface SignalDigest {
  tenant_id:        string
  period:        string   // e.g. "last_1h", "last_24h"
  total_signals: number
  by_severity:   Record<string, number>
  by_source:     Record<string, number>
  top_entities:  Array<{ entity_id: string; entity_type: string; signal_count: number }>
  suppressed:    number
  clustered:     number
  computed_at:   string
}
