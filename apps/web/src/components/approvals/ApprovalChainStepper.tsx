/**
 * ApprovalChainStepper — visualises a request's position in its multi-level
 * approval chain. Backed by GET /approvals/chain/:entityType/:entityId (P1.5).
 *
 * Renders nothing when the workflow type has no configured chain (the request
 * follows the legacy single-step path) — so it only appears where it adds signal.
 *
 * Drop it into any request row/detail:
 *   <ApprovalChainStepper entityType="leave_request" entityId={req.id} />
 */
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Clock, Zap } from 'lucide-react'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

export type ChainEntityType =
  | 'leave_request' | 'attendance_correction' | 'attendance_regularisation'
  | 'overtime_request' | 'comp_off_request'

interface ChainLevel {
  level: number; approver_type: string; specific_role: string | null; label: string
}
interface ChainAction {
  level: number; action: string; actor_id: string; actor_name: string | null
  comments: string | null; acted_at: string
}
interface ChainState {
  configured: boolean
  workflow_type: string
  current_level: number | null
  total_levels: number | null
  final_approved: boolean | null
  levels: ChainLevel[]
  actions: ChainAction[]
}

const APPROVER_LABEL: Record<string, string> = {
  direct_manager: 'Manager',
  hr_admin:       'HR',
  super_admin:    'Admin',
  specific_role:  'Role',
}

function levelTitle(l: ChainLevel): string {
  return l.label?.trim() || (l.approver_type === 'specific_role'
    ? (l.specific_role ?? 'Role')
    : APPROVER_LABEL[l.approver_type] ?? l.approver_type)
}

export function ApprovalChainStepper({
  entityType, entityId, className,
}: {
  entityType: ChainEntityType
  entityId:   string
  className?: string
}) {
  const { data } = useQuery<{ data: ChainState }>({
    queryKey: ['approval-chain', entityType, entityId],
    queryFn:  () => api.get(`/approvals/chain/${entityType}/${entityId}`),
    staleTime: 30_000,
  })

  const chain = data?.data
  if (!chain || !chain.configured || chain.levels.length === 0) return null

  const rejected   = chain.final_approved === false
  const rejLevel   = chain.actions.find(a => a.action === 'rejected')?.level ?? null
  const current    = chain.current_level ?? 1

  // Latest action per level (for actor name + approved/auto state).
  const actionByLevel = new Map<number, ChainAction>()
  for (const a of chain.actions) actionByLevel.set(a.level, a)

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chain.levels.map((lvl, idx) => {
        const act      = actionByLevel.get(lvl.level)
        const approved = !!act && (act.action === 'approved' || act.action === 'auto_approved')
        const auto     = act?.action === 'auto_approved'
        const isRej    = rejected && rejLevel === lvl.level
        const isCurr   = !rejected && chain.final_approved === null && lvl.level === current

        const state: 'done' | 'auto' | 'rejected' | 'current' | 'upcoming' =
          isRej ? 'rejected' : auto ? 'auto' : approved ? 'done' : isCurr ? 'current' : 'upcoming'

        const title = act?.actor_name
          ? `${levelTitle(lvl)} — ${state === 'rejected' ? 'rejected by' : state === 'auto' ? 'auto-approved' : 'approved by'} ${act.actor_name}`
          : `${levelTitle(lvl)}${isCurr ? ' — awaiting action' : ''}`

        return (
          <div key={lvl.level} className="flex items-center gap-1" title={title}>
            {idx > 0 && (
              <div className={cn('h-px w-3 flex-shrink-0',
                (approved || auto || (rejected && (rejLevel ?? 0) >= lvl.level)) ? 'bg-primary' : 'bg-border')} />
            )}
            <div className={cn(
              'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
              state === 'done'     && 'border-primary/30 bg-primary/10 text-primary',
              state === 'auto'     && 'border-info/30 bg-info/10 text-info',
              state === 'rejected' && 'border-destructive/30 bg-destructive/10 text-destructive',
              state === 'current'  && 'border-primary bg-primary text-primary-foreground',
              state === 'upcoming' && 'border-border bg-muted text-muted-foreground',
            )}>
              {state === 'done'     && <CheckCircle2 className="h-2 w-2" />}
              {state === 'auto'     && <Zap className="h-2 w-2" />}
              {state === 'rejected' && <XCircle className="h-2 w-2" />}
              {state === 'current'  && <Clock className="h-2 w-2" />}
              <span>L{lvl.level} {levelTitle(lvl)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
