/**
 * EssTeam — /ess/team
 *
 * Employee view of their team — immediate colleagues (same department),
 * reporting manager, and direct reports if any.
 *
 * Read-only directory snapshot. Uses the full-profile & team endpoints.
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useMemo, useState } from 'react'
import { useQuery }          from '@tanstack/react-query'
import {
  Users, AlertTriangle, Loader2, Search,
  Building2, Mail, Phone, ChevronRight,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMember {
  id:              string
  employee_code:   string
  first_name:      string
  last_name:       string
  email:           string
  phone?:          string
  status:          string
  designation?:    { name: string }
  department?:     { name: string }
  work_location?:  { name: string; city?: string }
}

interface FullProfileResp {
  employee: {
    id: string; first_name: string; last_name: string;
    email: string; employee_code: string; status: string
  }
  job_info?: {
    department?: { id: string; name: string }
    designation?: { name: string }
    manager?: { id: string; first_name: string; last_name: string; email: string; employee_code: string }
  } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(firstName: string, lastName: string) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase()
}

const AVATAR_COLORS = [
  'bg-info/20 text-info',
  'bg-success/20 text-success',
  'bg-warning/20 text-warning',
  'bg-accent/20 text-accent-foreground',
  'bg-primary/20 text-primary',
]

function avatarColor(code: string) {
  let n = 0
  for (let i = 0; i < code.length; i++) n += code.charCodeAt(i)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

// ── Member card ───────────────────────────────────────────────────────────────

function MemberCard({ m, highlight }: { m: TeamMember; highlight?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2 transition-colors',
      highlight ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:bg-muted/20',
    )}>
      <div className="flex items-center gap-2.5">
        <div className={cn(
          'h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
          avatarColor(m.employee_code),
        )}>
          {initials(m.first_name, m.last_name)}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">
            {m.first_name} {m.last_name}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">
            {m.designation?.name ?? 'Employee'}
          </p>
        </div>
        {highlight && (
          <Badge variant="secondary" className="ml-auto text-[10px] rounded-full flex-shrink-0">You</Badge>
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-border/40">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Mail className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{m.email}</span>
        </div>
        {m.department?.name && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Building2 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{m.department.name}</span>
          </div>
        )}
        {m.phone && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Phone className="h-3 w-3 flex-shrink-0" />
            <span>{m.phone}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EssTeam() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null
  const [search, setSearch] = useState('')

  // Load my own full profile to get department + manager
  const { data: myProfile, isLoading: profileLoading } = useQuery<FullProfileResp>({
    queryKey: ['ess-team-my-profile', employeeId],
    queryFn:  () => api.get<FullProfileResp>(`/employees/${employeeId}/full-profile`),
    enabled:  !!employeeId,
    staleTime: 120_000,
  })

  const deptId = myProfile?.job_info?.department?.id ?? null

  // Load all active employees in same department
  const { data: deptEmps, isLoading: deptLoading } = useQuery<{ data: TeamMember[] }>({
    queryKey: ['ess-team-dept', deptId],
    queryFn:  () => api.get(`/employees?department_id=${deptId}&status=active&limit=100`),
    enabled:  !!deptId,
    staleTime: 120_000,
  })

  const me        = myProfile?.employee
  const manager   = myProfile?.job_info?.manager
  const deptName  = myProfile?.job_info?.department?.name ?? ''
  const allMembers = useMemo(() => deptEmps?.data ?? [], [deptEmps])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allMembers
    return allMembers.filter(m =>
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      (m.designation?.name ?? '').toLowerCase().includes(q) ||
      m.employee_code.toLowerCase().includes(q)
    )
  }, [allMembers, search])

  const isLoading = profileLoading || deptLoading

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="My Team" subtitle="Colleagues and organizational context" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="My Team"
        subtitle={deptName ? `${deptName} · ${allMembers.length} member${allMembers.length !== 1 ? 's' : ''}` : 'Colleagues and organizational context'}
      />

      {isLoading ? (
        <SectionCard>
          <div className="flex items-center gap-2 py-8 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading team…
          </div>
        </SectionCard>
      ) : (
        <>
          {/* ── Reporting manager ──────────────────────────────────────────── */}
          {manager && (
            <SectionCard
              title="Reporting Manager"
              icon={<ChevronRight className="h-4 w-4 text-muted-foreground" />}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0',
                  avatarColor(manager.employee_code),
                )}>
                  {initials(manager.first_name, manager.last_name)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {manager.first_name} {manager.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground">{manager.email}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">#{manager.employee_code}</p>
                </div>
                <Badge variant="secondary" className="ml-auto rounded-full text-[10px]">Manager</Badge>
              </div>
            </SectionCard>
          )}

          {/* ── Team directory ─────────────────────────────────────────────── */}
          <SectionCard
            title={`${deptName || 'Department'} Team`}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
            action={
              allMembers.length > 5 ? (
                <div className="relative w-44">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              ) : undefined
            }
          >
            {filtered.length === 0 && search ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
                <Search className="h-3.5 w-3.5" />
                No members matching "{search}"
              </div>
            ) : !deptId ? (
              <div className="flex flex-col items-center gap-2 py-10">
                <Users className="h-8 w-8 text-muted-foreground opacity-40" />
                <p className="text-sm font-medium text-foreground">Department not assigned</p>
                <p className="text-xs text-muted-foreground">Contact HR to assign your department.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map(m => (
                  <MemberCard
                    key={m.id}
                    m={m}
                    highlight={me?.id === m.id}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </PageContainer>
  )
}
