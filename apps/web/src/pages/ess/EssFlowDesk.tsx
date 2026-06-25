/**
 * EssFlowDesk — /ess/flowdesk  (ESS 2.0 · FlowDesk pillar)
 *
 * One place to see what's waiting on you and to start any request. A thin shell
 * over existing approval/request APIs — NO new business logic, NO new tables:
 *   · Awaiting Me   → GET /approvals/pending (items I must action as manager/HR)
 *   · My Requests   → reuses <EssApprovals embedded /> (my submitted requests)
 *   · Raise a Request → deep-links into the existing request forms
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Inbox, ClipboardList, PlusCircle, ArrowRight, CheckCircle2, Loader2,
  CalendarCheck, ClipboardEdit, CreditCard, Wallet, Home, CalendarPlus, LifeBuoy,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { EssApprovals } from './EssApprovals'

// ── Types (subset of the /approvals/pending payload we render) ────────────────

interface PendingEmployee { first_name?: string; last_name?: string; employee_code?: string }
interface PendingLeave { id: string; from_date: string; to_date: string; reason?: string; created_at: string; leave_types?: { name?: string }; employees?: PendingEmployee }
interface PendingReg { id: string; date: string; reason?: string; created_at: string; employees?: PendingEmployee }
interface PendingPayload { leave_requests?: PendingLeave[]; regularisations?: PendingReg[] }

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  return isNaN(d.getTime()) ? '—' : `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}
const who = (e?: PendingEmployee) =>
  e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.employee_code || 'Employee' : 'Employee'

// ── "Raise a Request" catalogue (all existing forms) ──────────────────────────

const REQUESTS: { label: string; desc: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: 'Apply for Leave',     desc: 'Casual, sick, earned & comp-off', href: '/ess/leave/balance', icon: CalendarCheck },
  { label: 'Regularize Attendance', desc: 'Fix a missed or wrong punch',    href: '/ess/attendance',    icon: ClipboardEdit },
  { label: 'Reimbursement Claim', desc: 'Submit an expense claim',          href: '/ess/reimbursements', icon: CreditCard },
  { label: 'Loan or Advance',     desc: 'Request a salary advance / loan',  href: '/ess/loans',         icon: Wallet },
  { label: 'Work From Home',      desc: 'Request a remote-work day',        href: '/ess/wfh',           icon: Home },
  { label: 'Comp-Off',            desc: 'Claim credit for working off-day', href: '/ess/leave/balance', icon: CalendarPlus },
  { label: 'Raise a Helpdesk Ticket', desc: 'IT / HR / payroll support',    href: '/ess/issues',        icon: LifeBuoy },
]

// ── Awaiting Me tab ───────────────────────────────────────────────────────────

function AwaitingMe() {
  const { data, isLoading } = useQuery<PendingPayload>({
    queryKey: ['flowdesk-pending'],
    queryFn:  () => api.get('/approvals/pending?limit=20'),
    staleTime: 30_000,
  })

  const leaves = data?.leave_requests ?? []
  const regs   = data?.regularisations ?? []
  const total  = leaves.length + regs.length

  if (isLoading) {
    return <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading approvals…</div>
  }
  if (total === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        <span>Nothing is waiting on your approval.</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">{total}</strong> item{total !== 1 ? 's' : ''} awaiting your action
        </p>
        <Link to="/manager/approvals">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">Open approval inbox <ArrowRight className="h-3 w-3" /></Button>
        </Link>
      </div>

      <SectionCard title={`Leave requests (${leaves.length})`} icon={<CalendarCheck className="h-4 w-4 text-muted-foreground" />}>
        {leaves.length === 0 ? <p className="py-3 text-xs text-muted-foreground">No pending leave to approve.</p> : (
          <div className="space-y-0">
            {leaves.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {who(r.employees)} · {r.leave_types?.name ?? 'Leave'} — {fmtDate(r.from_date)}{r.from_date !== r.to_date ? ` → ${fmtDate(r.to_date)}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{r.reason ? `"${r.reason}" · ` : ''}requested {fmtDate(r.created_at)}</p>
                </div>
                <Badge variant="warning" className="rounded-full text-[10px]">pending</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={`Attendance corrections (${regs.length})`} icon={<ClipboardEdit className="h-4 w-4 text-muted-foreground" />}>
        {regs.length === 0 ? <p className="py-3 text-xs text-muted-foreground">No pending corrections to approve.</p> : (
          <div className="space-y-0">
            {regs.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{who(r.employees)} · {fmtDate(r.date)}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{r.reason ? `${r.reason.slice(0, 60)} · ` : ''}requested {fmtDate(r.created_at)}</p>
                </div>
                <Badge variant="warning" className="rounded-full text-[10px]">pending</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── Raise a Request tab ───────────────────────────────────────────────────────

function RaiseRequest() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {REQUESTS.map((r) => {
        const Icon = r.icon
        return (
          <Link key={r.label} to={r.href}
            className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40">
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-sm font-medium text-foreground">{r.label}<ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" /></p>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.desc}</p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EssFlowDesk() {
  const { profile } = useAuthStore()
  const isManager = ['manager', 'hr_admin', 'super_admin'].includes(profile?.role ?? '')

  return (
    <PageContainer>
      <PageHeader title="FlowDesk" subtitle="Your tasks, approvals and requests — in one place" />

      <Tabs defaultValue={isManager ? 'awaiting' : 'requests'}>
        <TabsList>
          {isManager && <TabsTrigger value="awaiting" className="gap-1.5"><Inbox className="h-3.5 w-3.5" />Awaiting Me</TabsTrigger>}
          <TabsTrigger value="requests" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" />My Requests</TabsTrigger>
          <TabsTrigger value="raise" className="gap-1.5"><PlusCircle className="h-3.5 w-3.5" />Raise a Request</TabsTrigger>
        </TabsList>

        {isManager && <TabsContent value="awaiting" className="mt-4"><AwaitingMe /></TabsContent>}
        <TabsContent value="requests" className="mt-4"><EssApprovals embedded /></TabsContent>
        <TabsContent value="raise" className="mt-4"><RaiseRequest /></TabsContent>
      </Tabs>
    </PageContainer>
  )
}
