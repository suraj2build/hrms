/**
 * AuditDetailsPanel — read-only audit trail Sheet panel.
 * Replaces GovernanceMatrix execution for contextual audit viewing.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ── Props ──────────────────────────────────────────────────────────────────

export interface AuditDetailsPanelProps {
  open:        boolean
  onClose:     () => void
  entityId:    string | null
  entityType:  'employee' | 'attendance' | 'payroll' | 'roster' | 'leave'
  entityLabel: string
}

// ── Types ──────────────────────────────────────────────────────────────────

type ActionFilter = 'All' | 'Create' | 'Update' | 'Delete' | 'Approve' | 'Reject'

const ACTION_FILTERS: ActionFilter[] = ['All', 'Create', 'Update', 'Delete', 'Approve', 'Reject']

interface AuditEntry {
  id:             string
  timestamp:      string
  actor_name:     string
  action:         string
  field_changed?: string
  old_value?:     string
  new_value?:     string
}

// ── Safe cast helper ───────────────────────────────────────────────────────

function toAuditEntry(raw: unknown): AuditEntry {
  const r = raw as Record<string, unknown>
  return {
    id:            String(r['id'] ?? ''),
    timestamp:     String(r['timestamp'] ?? r['created_at'] ?? ''),
    actor_name:    String(r['actor_name'] ?? r['user_name'] ?? 'System'),
    action:        String(r['action'] ?? r['action_type'] ?? ''),
    field_changed: r['field_changed'] ? String(r['field_changed']) : undefined,
    old_value:     r['old_value']     ? String(r['old_value'])     : undefined,
    new_value:     r['new_value']     ? String(r['new_value'])     : undefined,
  }
}

// ── Time helper ────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

// ── Main component ─────────────────────────────────────────────────────────

export function AuditDetailsPanel({
  open,
  onClose,
  entityId,
  entityType,
  entityLabel,
}: AuditDetailsPanelProps) {
  const [activeFilter, setActiveFilter] = useState<ActionFilter>('All')

  const { data: auditRaw, isLoading } = useQuery({
    queryKey: ['audit-trail', entityType, entityId],
    queryFn:  () =>
      api
        .get<unknown>(`/audit/entries?entity_type=${entityType}&entity_id=${entityId}&limit=50`),
    enabled:   !!entityId && open,
    staleTime: 30_000,
  })

  const auditRawRecord = auditRaw as Record<string, unknown> | null | undefined
  const allEntries: AuditEntry[] = Array.isArray(auditRaw)
    ? (auditRaw as unknown[]).map(toAuditEntry)
    : Array.isArray(auditRawRecord?.['data'])
      ? (auditRawRecord!['data'] as unknown[]).map(toAuditEntry)
      : []

  const filteredEntries = activeFilter === 'All'
    ? allEntries
    : allEntries.filter(e =>
        e.action.toLowerCase().includes(activeFilter.toLowerCase()),
      )

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent className="w-[440px]">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>Audit Trail — {entityLabel}</SheetTitle>
            <Badge variant="secondary" className="text-[10px] capitalize shrink-0">
              {entityType}
            </Badge>
          </div>
        </SheetHeader>

        <SheetBody>
          {/* Filter bar */}
          <div className="flex items-center gap-1 flex-wrap mb-4">
            {ACTION_FILTERS.map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFilter(f)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  activeFilter === f
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="h-4 bg-muted animate-pulse rounded" />
              ))}
            </div>
          )}

          {/* Empty / 404 state */}
          {!isLoading && filteredEntries.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No audit trail available for this record.
            </p>
          )}

          {/* Timeline */}
          {!isLoading && filteredEntries.length > 0 && (
            <ol className="relative flex flex-col gap-0">
              {filteredEntries.map((entry, idx) => (
                <li key={entry.id || idx} className="relative flex gap-3 pb-5">
                  {/* Vertical line */}
                  {idx < filteredEntries.length - 1 && (
                    <div className="absolute left-[7px] top-4 bottom-0 w-px bg-border" />
                  )}

                  {/* Dot */}
                  <div className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary bg-card" />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-foreground leading-snug">
                        <span className="font-medium">{entry.actor_name}</span>
                        {' '}performed{' '}
                        <span className="font-medium text-primary">{entry.action}</span>
                        {entry.field_changed && (
                          <span className="text-muted-foreground"> on {entry.field_changed}</span>
                        )}
                      </p>
                      <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                    </div>

                    {/* Value diff */}
                    {(entry.old_value !== undefined || entry.new_value !== undefined) && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {entry.old_value !== undefined && (
                          <span>
                            old value:{' '}
                            <span className="text-foreground line-through">{entry.old_value}</span>
                          </span>
                        )}
                        {entry.old_value !== undefined && entry.new_value !== undefined && (
                          <span className="mx-1">→</span>
                        )}
                        {entry.new_value !== undefined && (
                          <span>
                            new value:{' '}
                            <span className="text-foreground font-medium">{entry.new_value}</span>
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
