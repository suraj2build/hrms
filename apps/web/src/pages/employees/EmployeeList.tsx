/**
 * EmployeeList — People Operations Surface
 *
 * Clean enterprise table matching design spec exactly:
 *   Header + WORKFORCE SURFACE badge
 *   5-card stats strip (Workforce · Operational · Onboarding · No-Login · Sites)
 *   Search + filter toolbar (Status · Access · Dept · Location) + Table/Grid toggle
 *   Sortable table: Employee · Status · Department · Location · Tenure · Access · Actions
 *
 * Data wired to GET /employees (enriched with job_history joins)
 */

import { useState, useMemo, memo } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { SignedImage } from '@/components/SignedImage'
import { Button } from '@/components/ui/button'
import { useQuery }          from '@tanstack/react-query'
import {
  Search, Download, UserPlus, Building2, MapPin,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Check, Mail, X, Lock, Filter, LayoutGrid, Table2,
  Bookmark, TrendingUp,
} from 'lucide-react'
import { api }            from '@/lib/api/client'
import { useBasePath }    from '@/lib/routing'
import { useAuthStore }   from '@/stores/authStore'
// import { cn }          from '@/lib/utils'
import type { EmployeeListItem } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Site { id: string; name: string; city?: string | null }

// ── Avatar palette ─────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  { bg: '#fde68a', color: '#92400e' },   // amber
  { bg: '#bbf7d0', color: '#14532d' },   // green
  { bg: '#bfdbfe', color: '#1e3a8a' },   // blue
  { bg: '#fecaca', color: '#7f1d1d' },   // red
  { bg: '#e9d5ff', color: '#581c87' },   // purple
  { bg: '#a7f3d0', color: '#064e3b' },   // teal
  { bg: '#fed7aa', color: '#7c2d12' },   // orange
  { bg: '#ddd6fe', color: '#3730a3' },   // indigo
  { bg: '#fce7f3', color: '#831843' },   // pink
  { bg: '#d1fae5', color: '#065f46' },   // emerald
]
function avatarPalette(code: string) {
  const idx = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return AVATAR_PALETTE[idx % AVATAR_PALETTE.length]
}

// ── Department color dots ──────────────────────────────────────────────────────

const DEPT_COLORS = [
  '#8b5cf6', '#3b82f6', '#14b8a6', '#f59e0b',
  '#ec4899', '#ef4444', '#10b981', '#0ea5e9',
  '#f97316', '#6366f1', '#84cc16', '#06b6d4',
]
function deptColor(name: string): string {
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return DEPT_COLORS[idx % DEPT_COLORS.length]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getInitials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

function tenureDisplay(joining: string): { short: string; full: string; months: number } {
  const ms = Date.now() - new Date(joining).getTime()
  const totalMonths = Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44))
  const yrs = Math.floor(totalMonths / 12)
  const mos = totalMonths % 12

  let short = ''
  if (yrs === 0 && mos === 0) short = '< 1m'
  else if (yrs === 0) short = `${mos}m`
  else if (mos === 0) short = `${yrs}y`
  else short = `${yrs}y ${mos}m`

  const d = new Date(joining)
  const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const full = isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2,'0')}-${_M[d.getMonth()]}-${d.getFullYear()}`
  return { short, full, months: totalMonths }
}

function deriveOpState(emp: EmployeeListItem): { label: string; bg: string; color: string; dot: string } {
  const totalMs   = Date.now() - new Date(emp.joining_date).getTime()
  const totalDays = totalMs / 86_400_000
  const totalMo   = totalDays / 30.44

  if (emp.status === 'separated')  return { label: 'Separated',   bg: 'var(--muted)', color: 'var(--muted-foreground)', dot: 'var(--muted-foreground)' }
  if (emp.status === 'inactive')   return { label: 'Inactive',    bg: '#fef2f2', color: '#dc2626', dot: '#ef4444' }
  if (emp.status === 'on_notice')  return { label: 'On Notice',   bg: '#fff7ed', color: '#c2410c', dot: '#f97316' }
  if (totalDays <= 30)             return { label: 'Onboarding',  bg: '#fff7ed', color: '#c2410c', dot: '#fb923c' }
  if (totalMo < 6)                 return { label: 'Probation',   bg: '#fefce8', color: '#a16207', dot: '#facc15' }
  if (emp.current_job?.employment_type === 'contract')
                                   return { label: 'Contract',    bg: '#f5f3ff', color: '#7c3aed', dot: '#a78bfa' }
  if (emp.current_job?.employment_type === 'intern')
                                   return { label: 'Intern',      bg: '#f0fdf4', color: '#15803d', dot: '#4ade80' }
  return                                  { label: 'Operational', bg: '#f0fdf4', color: '#16a34a', dot: '#4ade80' }
}

function deriveAccessDisplay(emp: EmployeeListItem): {
  label:    string
  sub:      string
  iconBg:   string
  iconColor: string
  Icon:     React.ComponentType<{ className?: string }>
} {
  const s = emp.user_account?.status
  if (!s || s === 'no_account')
    return { label: 'No Account',  sub: 'Setup required',       iconBg: 'var(--muted)', iconColor: 'var(--muted-foreground)', Icon: Lock   }
  if (s === 'suspended')
    return { label: 'Locked',      sub: 'Access suspended',     iconBg: '#fef2f2', iconColor: '#ef4444', Icon: X      }
  if (s === 'pending_verification')
    return { label: 'Invited',     sub: 'Awaiting first login',  iconBg: '#fffbeb', iconColor: '#f59e0b', Icon: Mail   }
  return   { label: 'Active',      sub: 'Account active',       iconBg: '#f0fdf4', iconColor: '#16a34a', Icon: Check  }
}

// ── Stats strip ───────────────────────────────────────────────────────────────

function StatsStrip({
  employees,
  sitesCount,
  cities,
}: {
  employees:  EmployeeListItem[]
  sitesCount: number
  cities:     number
}) {
  const stats = useMemo(() => {
    const now = Date.now()
    let operational = 0, onboarding = 0, noLogin = 0, newThisMonth = 0

    for (const e of employees) {
      const days = (now - new Date(e.joining_date).getTime()) / 86_400_000
      const mo   = days / 30.44

      if (e.status === 'active') {
        if (days <= 30)          onboarding++
        else if (mo >= 6)        operational++
      }
      if (days <= 30 && e.status === 'active') newThisMonth++
      if (!e.user_account || e.user_account.status === 'no_account') noLogin++
    }

    return { total: employees.length, operational, onboarding, noLogin, newThisMonth }
  }, [employees])

  const opPct = stats.total > 0 ? Math.round((stats.operational / stats.total) * 100) : 0

  const cards = [
    {
      label: 'WORKFORCE',
      value: stats.total.toString(),
      sub:   stats.newThisMonth > 0 ? `↑ ${stats.newThisMonth} joined this month` : 'Active roster',
      subColor: stats.newThisMonth > 0 ? '#16a34a' : 'var(--muted-foreground)',
      accent: '#10b981',
    },
    {
      label: 'OPERATIONAL',
      value: `${stats.operational} / ${stats.total}`,
      sub:   `${opPct}% active workforce`,
      subColor: opPct >= 80 ? '#16a34a' : opPct >= 60 ? '#f59e0b' : '#ef4444',
      accent: '#6366f1',
    },
    {
      label: 'ONBOARDING',
      value: stats.onboarding.toString(),
      sub:   stats.onboarding > 0 ? 'Settling in' : 'None this month',
      subColor: stats.onboarding > 0 ? '#f59e0b' : 'var(--muted-foreground)',
      accent: '#f97316',
    },
    {
      label: 'NO-LOGIN ACCOUNTS',
      value: stats.noLogin.toString(),
      sub:   stats.noLogin > 0 ? 'Need attention' : 'All accounts set up',
      subColor: stats.noLogin > 0 ? '#ef4444' : '#16a34a',
      accent: '#ef4444',
    },
    {
      label: 'SITES',
      value: sitesCount.toString(),
      sub:   cities > 0 ? `${cities} cit${cities === 1 ? 'y' : 'ies'} covered` : 'Work locations',
      subColor: 'var(--muted-foreground)',
      accent: '#0ea5e9',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      {cards.map((c, i) => (
        <div key={i} className="surface-premium lift-hover relative overflow-hidden px-3.5 py-2.5">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: c.accent }} />
          <span className="block text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{c.label}</span>
          <div className="mt-0.5 text-xl font-extrabold leading-tight tabular-nums tracking-tight text-foreground">{c.value}</div>
          <div className="mt-0.5 text-[10.5px] font-medium" style={{ color: c.subColor }}>{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ── EmployeeList ──────────────────────────────────────────────────────────────

type SortKey = 'name' | 'code' | 'department' | 'status' | 'joining_date'
type SortDir = 'asc' | 'desc'

export function EmployeeList() {
  const navigate    = useNavigate()
  const basePath    = useBasePath()
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [accessFilter, setAccessFilter] = useState('all')
  const [deptFilter,   setDeptFilter]   = useState('all')
  const [locFilter,    setLocFilter]    = useState('all')
  const [sortKey,      setSortKey]      = useState<SortKey>('name')
  const [sortDir,      setSortDir]      = useState<SortDir>('asc')
  const [page,         setPage]         = useState(1)
  const [selected,     setSelected]     = useState<Set<string>>(new Set())

  const PAGE_SIZE = 20

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery<{ data: EmployeeListItem[]; total: number }>({
    queryKey: ['employees', 'list'],
    queryFn:  () => api.get('/employees?limit=200'),
    staleTime: 30_000,
    enabled:  isAdmin,   // don't fire for non-admins (backend rejects 403 anyway)
  })

  const { data: sitesData } = useQuery<{ data: Site[] }>({
    queryKey: ['sites'],
    queryFn:  () => api.get('/masters/sites'),
    staleTime: 120_000,
  })

  const allEmployees = data?.data ?? []
  const sites        = sitesData?.data ?? []

  // Unique departments + locations for filter dropdowns
  const { departments, locations, cities } = useMemo(() => {
    const depts = new Map<string, string>()
    const locs  = new Map<string, string>()
    const citySet = new Set<string>()
    for (const e of allEmployees) {
      if (e.department?.id) depts.set(e.department.id, e.department.name)
      if (e.work_location?.id) {
        locs.set(e.work_location.id, e.work_location.name)
        if (e.work_location.city) citySet.add(e.work_location.city)
      }
    }
    return {
      departments: [...depts.entries()].map(([id, name]) => ({ id, name })),
      locations:   [...locs.entries()].map(([id, name]) => ({ id, name })),
      cities:      citySet.size,
    }
  }, [allEmployees])

  // ── Filter + sort + paginate ───────────────────────────────────────────────

  const filtered = useMemo(() => {
    let arr = allEmployees

    if (statusFilter !== 'all') {
      // Map filter value to operational state label
      arr = arr.filter(e => {
        const op = deriveOpState(e)
        return op.label.toLowerCase() === statusFilter.toLowerCase()
      })
    }

    if (accessFilter !== 'all') {
      arr = arr.filter(e => (e.user_account?.status ?? 'no_account') === accessFilter)
    }

    if (deptFilter !== 'all') {
      arr = arr.filter(e => e.department?.id === deptFilter)
    }

    if (locFilter !== 'all') {
      arr = arr.filter(e => e.work_location?.id === locFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(e =>
        `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.department?.name.toLowerCase().includes(q) ?? false) ||
        (e.designation?.name.toLowerCase().includes(q) ?? false) ||
        (e.work_location?.name.toLowerCase().includes(q) ?? false),
      )
    }

    return arr
  }, [allEmployees, statusFilter, accessFilter, deptFilter, locFilter, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
        case 'code':
          return dir * a.employee_code.localeCompare(b.employee_code)
        case 'department':
          return dir * (a.department?.name ?? '').localeCompare(b.department?.name ?? '')
        case 'status':
          return dir * deriveOpState(a).label.localeCompare(deriveOpState(b).label)
        case 'joining_date':
          return dir * (new Date(a.joining_date).getTime() - new Date(b.joining_date).getTime())
        default: return 0
      }
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const selectedEmails = useMemo(
    () => allEmployees.filter(e => selected.has(e.id)).map(e => e.email),
    [allEmployees, selected],
  )

  const totalPages   = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageItems    = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allPageIds   = pageItems.map(e => e.id)
  const allSelected  = allPageIds.length > 0 && allPageIds.every(id => selected.has(id))
  const someSelected = allPageIds.some(id => selected.has(id)) && !allSelected

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); allPageIds.forEach(id => n.delete(id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); allPageIds.forEach(id => n.add(id)); return n })
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // ── Column header helper ──────────────────────────────────────────────────

  function ColHead({ label, field, width }: { label: string; field?: SortKey; width: string }) {
    const active = field && sortKey === field
    return (
      <th
        style={{ width, padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: active ? 'var(--primary)' : 'var(--muted-foreground)', whiteSpace: 'nowrap', cursor: field ? 'pointer' : 'default', userSelect: 'none', background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}
        onClick={() => field && toggleSort(field)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {label}
          {field && (
            active
              ? sortDir === 'asc'
                ? <ChevronUp   className="w-3 h-3" />
                : <ChevronDown className="w-3 h-3" />
              : <ChevronDown className="w-3 h-3 opacity-30" />
          )}
        </span>
      </th>
    )
  }

  // ── Role guard — after all hooks ──────────────────────────────────────────
  // Backend enforces this too; this prevents a confusing empty state for non-admins.
  if (profile && !isAdmin) {
    return <Navigate to="/" replace />
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: 'var(--muted)', minHeight: '100vh', padding: '20px 24px 32px' }}>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-.02em', margin: 0 }}>
                People Operations
              </h1>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
                background: '#1f2937', color: '#fff', padding: '3px 9px', borderRadius: 999,
              }}>
                WORKFORCE SURFACE
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--muted-foreground)', margin: 0, fontWeight: 500 }}>
              Live workforce operational stream — {allEmployees.length} people across {sites.length} site{sites.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Bookmark className="h-3.5 w-3.5" />
              Saved Views
            </Button>
            {isAdmin && (
              <>
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
                <Button size="sm" onClick={() => navigate(`${basePath}/employees/new`)}>
                  <UserPlus className="h-3.5 w-3.5" />
                  Add Employee
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Stats strip ──────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <StatsStrip employees={allEmployees} sitesCount={sites.length} cities={cities} />
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div style={{ background: 'var(--card)', borderRadius: 10, border: '1px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--muted-foreground)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Search name, code, email, department..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              style={{ width: '100%', paddingLeft: 32, paddingRight: 44, height: 34, border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, outline: 'none', color: 'var(--foreground)', fontFamily: 'inherit', background: 'var(--card)' }}
            />
            <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--border)', fontFamily: '"Geist Mono",ui-monospace,monospace', fontWeight: 600, background: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 5px', borderRadius: 5 }}>
              ⌘K
            </span>
          </div>

          {/* Filters */}
          {[
            {
              label: 'Status', value: statusFilter,
              options: [
                { v: 'all', l: 'Status' },
                { v: 'Operational', l: 'Operational' },
                { v: 'Probation',   l: 'Probation'   },
                { v: 'Onboarding',  l: 'Onboarding'  },
                { v: 'On Notice',   l: 'On Notice'    },
                { v: 'Inactive',    l: 'Inactive'     },
                { v: 'Separated',   l: 'Separated'    },
              ],
              onChange: (v: string) => { setStatusFilter(v); setPage(1) },
            },
            {
              label: 'Access', value: accessFilter,
              options: [
                { v: 'all',                   l: 'Access'       },
                { v: 'active',                l: 'Active'       },
                { v: 'suspended',             l: 'Locked'       },
                { v: 'pending_verification',  l: 'Invited'      },
                { v: 'no_account',            l: 'No Account'   },
              ],
              onChange: (v: string) => { setAccessFilter(v); setPage(1) },
            },
            {
              label: 'Dept', value: deptFilter,
              options: [
                { v: 'all', l: 'Dept' },
                ...departments.map(d => ({ v: d.id, l: d.name })),
              ],
              onChange: (v: string) => { setDeptFilter(v); setPage(1) },
            },
            {
              label: 'Location', value: locFilter,
              options: [
                { v: 'all', l: 'Location' },
                ...locations.map(l => ({ v: l.id, l: l.name })),
              ],
              onChange: (v: string) => { setLocFilter(v); setPage(1) },
            },
          ].map(f => (
            <div key={f.label} style={{ position: 'relative' }}>
              <select
                value={f.value}
                onChange={e => f.onChange(e.target.value)}
                style={{ height: 34, paddingLeft: 12, paddingRight: 28, border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, fontWeight: 500, color: f.value !== 'all' ? 'var(--primary)' : 'var(--muted-foreground)', background: f.value !== 'all' ? 'var(--accent)' : 'var(--card)', cursor: 'pointer', outline: 'none', appearance: 'none', fontFamily: 'inherit' }}
              >
                {f.options.map(o => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
              <ChevronDown style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, color: 'var(--muted-foreground)', pointerEvents: 'none' }} />
            </div>
          ))}

          {/* Right: count + view toggle */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, color: 'var(--muted-foreground)', fontWeight: 500, whiteSpace: 'nowrap' }}>
              {sorted.length} of {allEmployees.length} people
            </span>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {[
                { icon: Table2,      label: 'Table', active: true },
                { icon: LayoutGrid,  label: 'Grid',  active: false },
              ].map(v => (
                <button
                  key={v.label}
                  style={{ height: 32, padding: '0 12px', background: v.active ? 'var(--muted)' : 'var(--card)', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: v.active ? 600 : 500, color: v.active ? 'var(--foreground)' : 'var(--muted-foreground)', fontFamily: 'inherit' }}
                >
                  <v.icon className="w-3.5 h-3.5" />
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 800 }}>
            <colgroup>
              <col style={{ width: '3%'  }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '9%'  }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr>
                {/* Checkbox col */}
                <th style={{ width: '3%', padding: '8px 0 8px 12px', background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleSelectAll}
                    style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                </th>
                <ColHead label="Employee"   field="name"         width="20%" />
                <ColHead label="Status"     field="status"       width="9%"  />
                <ColHead label="Department" field="department"   width="12%" />
                <ColHead label="Location"                        width="11%" />
                <ColHead label="Tenure"     field="joining_date" width="16%" />
                <ColHead label="Access"                          width="15%" />
                <ColHead label="Actions"                         width="14%" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Filter style={{ width: 28, height: 28, opacity: .4 }} />
                      <span>No employees match your filters.</span>
                      <button onClick={() => { setSearch(''); setStatusFilter('all'); setAccessFilter('all'); setDeptFilter('all'); setLocFilter('all') }} style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
                        Clear all filters
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                pageItems.map(emp => (
                  <MemoizedEmployeeRow
                    key={emp.id}
                    emp={emp}
                    basePath={basePath}
                    navigate={navigate}
                    selected={selected.has(emp.id)}
                    onSelect={() => toggleSelect(emp.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ───────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              Page {page} of {totalPages} · {sorted.length} results
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PageBtn disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </PageBtn>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const n = Math.min(Math.max(page - 2, 1) + i, totalPages)
                return (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${n === page ? 'var(--primary)' : 'var(--border)'}`, background: n === page ? 'var(--primary)' : 'var(--card)', color: n === page ? '#fff' : 'var(--muted-foreground)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {n}
                  </button>
                )
              })}
              <PageBtn disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight className="w-3.5 h-3.5" />
              </PageBtn>
            </div>
          </div>
        )}

        <BulkBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          selectedEmails={selectedEmails}
        />

      </div>
    </div>
  )
}

// ── PageBtn ───────────────────────────────────────────────────────────────────

function PageBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted-foreground)', fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, opacity: disabled ? .4 : 1, fontFamily: 'inherit' }}
    >
      {children}
    </button>
  )
}

// ── EmployeeRow ───────────────────────────────────────────────────────────────

function EmployeeRow({
  emp,
  basePath,
  navigate,
  selected,
  onSelect,
}: {
  emp:      EmployeeListItem
  basePath: string
  navigate: ReturnType<typeof useNavigate>
  selected: boolean
  onSelect: () => void
}) {
  const opState  = deriveOpState(emp)
  const access   = deriveAccessDisplay(emp)
  const tenure   = tenureDisplay(emp.joining_date)
  const initials = getInitials(emp.first_name, emp.last_name)
  const avatar   = avatarPalette(emp.employee_code)
  const dept     = emp.department
  const loc      = emp.work_location
  const AccessIcon = access.Icon

  // Tenure bar: capped at 120 months (10 years) = 100%
  const barPct = Math.min((tenure.months / 120) * 100, 100)
  const barColor =
    tenure.months < 3  ? '#fb923c' :
    tenure.months < 12 ? '#facc15' :
    tenure.months < 48 ? '#60a5fa' : '#34d399'

  // Location: derive short city label and short office code
  const locCity  = loc?.city ?? loc?.name ?? null
  const locCode  = loc && loc.city && loc.name !== loc.city
    ? loc.name.replace(/\s+/g, '').substring(0, 8).toUpperCase()
    : null

  return (
    <tr
      style={{ background: selected ? 'var(--accent)' : 'var(--card)', transition: 'background .08s', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--muted)' }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--card)' }}
      onClick={() => navigate(`${basePath}/employees/${emp.id}`)}
    >
      {/* Checkbox */}
      <td style={{ padding: '0 0 0 12px', width: 38 }} onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
        />
      </td>

      {/* Employee */}
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatar.bg, color: avatar.color, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            <SignedImage
              path={emp.personal_info?.profile_photo}
              alt={initials}
              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
              fallback={<>{initials}</>}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {emp.first_name} {emp.last_name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1.5 }}>
              <span style={{ fontSize: 10.5, fontFamily: '"Geist Mono",ui-monospace,monospace', color: 'var(--muted-foreground)', fontWeight: 500, flexShrink: 0 }}>
                {emp.employee_code}
              </span>
              {emp.designation?.name && (
                <>
                  <span style={{ color: 'var(--border)', fontSize: 9 }}>·</span>
                  <span style={{ fontSize: 11, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.designation.name}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Status */}
      <td style={{ padding: '8px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: opState.bg, color: opState.color, whiteSpace: 'nowrap' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: opState.dot, flexShrink: 0 }} />
          {opState.label}
        </span>
      </td>

      {/* Department */}
      <td style={{ padding: '8px 10px' }}>
        {dept ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: deptColor(dept.name), flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dept.name}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--border)' }}>—</span>
        )}
      </td>

      {/* Location — single line: City · Code */}
      <td style={{ padding: '8px 10px' }}>
        {locCity ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Building2 style={{ width: 11, height: 11, color: 'var(--muted-foreground)', flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {locCity}
              </span>
            </div>
            {locCode && (
              <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', marginTop: 1, paddingLeft: 15 }}>{locCode}</div>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 11.5, color: 'var(--border)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin style={{ width: 10, height: 10 }} />
            No location
          </span>
        )}
      </td>

      {/* Tenure — inline: "3y 11m · joined Jun 15, 22" + bar */}
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted-foreground)', fontFamily: '"Geist Mono",ui-monospace,monospace', flexShrink: 0 }}>
            {tenure.short}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            · joined {tenure.full}
          </span>
        </div>
        <div style={{ height: 3, background: 'var(--muted)', borderRadius: 999, width: '85%' }}>
          <div style={{ height: '100%', borderRadius: 999, background: barColor, width: `${barPct}%` }} />
        </div>
      </td>

      {/* Access — icon dot + label + sub */}
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: access.iconBg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <span style={{ color: access.iconColor, display: 'flex' }}><AccessIcon className="w-3 h-3" /></span>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{access.label}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted-foreground)', marginTop: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{access.sub}</div>
          </div>
        </div>
      </td>

      {/* Actions */}
      <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            title="Send email"
            onClick={() => window.open(`mailto:${emp.email}`)}
          >
            <Mail className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" title="More options">
            <TrendingUp className="h-3 w-3 rotate-90" />
          </Button>
          <Button
            size="sm"
            className="h-7 px-2.5 text-[11px]"
            onClick={() => navigate(`${basePath}/employees/${emp.id}`)}
          >
            Open Profile
          </Button>
        </div>
      </td>
    </tr>
  )
}

const MemoizedEmployeeRow = memo(EmployeeRow)

// ── BulkBar ───────────────────────────────────────────────────────────────────

function BulkBar({
  count,
  onClear,
  selectedEmails,
}: {
  count:          number
  onClear:        () => void
  selectedEmails: string[]
}) {
  if (count === 0) return null
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: '#111827', borderRadius: 12, padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,.22)',
      zIndex: 50, minWidth: 360,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }}>
        {count} employee{count !== 1 ? 's' : ''} selected
      </span>
      <div style={{ height: 16, width: 1, background: '#374151' }} />
      <button
        onClick={() => window.open(`mailto:${selectedEmails.join(',')}`)}
        style={{ fontSize: 12, fontWeight: 600, color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
      >
        Send Email
      </button>
      <button
        onClick={() => { /* export — toast placeholder */ }}
        style={{ fontSize: 12, fontWeight: 600, color: '#86efac', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
      >
        Export
      </button>
      <button
        onClick={onClear}
        style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
      >
        ✕ Clear
      </button>
    </div>
  )
}

// ── SkeletonRow ───────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 0 8px 12px', width: 38 }}>
        <div style={{ width: 13, height: 13, borderRadius: 3, background: 'var(--muted)' }} />
      </td>
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--muted)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 11, background: 'var(--muted)', borderRadius: 4, width: '65%', marginBottom: 5 }} />
            <div style={{ height: 9, background: 'var(--muted)', borderRadius: 4, width: '45%' }} />
          </div>
        </div>
      </td>
      {[90, 100, 110, 120, 110, 130].map((w, i) => (
        <td key={i} style={{ padding: '8px 10px' }}>
          <div style={{ height: 11, background: 'var(--muted)', borderRadius: 4, width: w }} />
        </td>
      ))}
    </tr>
  )
}
