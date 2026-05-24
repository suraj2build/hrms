/**
 * StatutoryDashboard — Compliance Operations Cockpit
 *
 * Unified India Compliance View combining EPF / ESI / PTAX / TDS.
 * Evolved into a COMPLIANCE OPERATIONS COCKPIT:
 *
 *   Compliance Summary Header → EPF/ESI/PTAX/TDS readiness, filing gaps,
 *                               coverage gaps, mismatches, deadline pressure
 *
 *   Severity Visualization   → module-level readiness chips with drilldowns
 *
 *   Sub-tabs → EPF · ESI · PTAX · TDS
 */

import React, { lazy, Suspense, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Building2, ShieldCheck, MapPin, FileText,
  AlertTriangle, Clock, Users, FileWarning,
  CheckCircle2, XCircle, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'

// ── Lazy load each statutory module ───────────────────────────────────────────
const EPFManagement  = lazy(() => import('@/pages/payroll/statutory/EPFManagement').then(m => ({ default: m.EPFManagement })))
const ESIManagement  = lazy(() => import('@/pages/payroll/statutory/ESIManagement').then(m => ({ default: m.ESIManagement })))
const PTAXManagement = lazy(() => import('@/pages/payroll/statutory/PTAXManagement').then(m => ({ default: m.PTAXManagement })))
const TDSManagement  = lazy(() => import('@/pages/payroll/statutory/TDSManagement').then(m => ({ default: m.TDSManagement })))

// ── Operational data types ─────────────────────────────────────────────────────

interface ComplianceModuleStatus {
  employees_covered:    number
  employees_missing:    number   // not registered / exempt gaps
  filing_gaps:          number   // months with unfiled returns
  computation_errors:   number   // amount mismatches vs actuals
  next_deadline:        string | null  // ISO date of next statutory deadline
  days_to_deadline:     number | null
  is_ready:             boolean  // true if no gaps + no errors
}

interface ComplianceStats {
  epf:   ComplianceModuleStatus
  esi:   ComplianceModuleStatus
  ptax:  ComplianceModuleStatus
  tds:   ComplianceModuleStatus
  total_filing_gaps:       number
  total_coverage_gaps:     number
  total_computation_errors: number
  critical_deadline_days:  number | null  // soonest deadline across all modules
}

// ── Tab config ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'epf',  label: 'EPF',  icon: Building2,  description: 'Provident Fund contributions and challan' },
  { key: 'esi',  label: 'ESI',  icon: ShieldCheck, description: 'Employee State Insurance management' },
  { key: 'ptax', label: 'PTAX', icon: MapPin,       description: 'Professional Tax by state' },
  { key: 'tds',  label: 'TDS',  icon: FileText,     description: 'Tax Deducted at Source and Form 16' },
] as const

type TabKey = typeof TABS[number]['key']

function TabLoader() {
  return (
    <div className="flex h-48 items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

// ── Severity helpers ───────────────────────────────────────────────────────────

function moduleReadinessSeverity(mod: ComplianceModuleStatus | undefined): 'critical' | 'warning' | 'success' | 'neutral' {
  if (!mod) return 'neutral'
  if (!mod.is_ready && (mod.filing_gaps > 0 || mod.computation_errors > 0)) return 'critical'
  if (mod.employees_missing > 0 || mod.filing_gaps > 0) return 'warning'
  if (mod.is_ready) return 'success'
  return 'neutral'
}

const SEVERITY_CLASSES = {
  critical: { bg: 'bg-destructive/10', text: 'text-destructive', ring: 'ring-destructive/30', dot: 'bg-destructive' },
  warning:  { bg: 'bg-warning/10',     text: 'text-warning',     ring: 'ring-warning/30',     dot: 'bg-warning' },
  success:  { bg: 'bg-success/10',     text: 'text-success',     ring: 'ring-success/30',     dot: 'bg-success' },
  neutral:  { bg: 'bg-muted/40',       text: 'text-muted-foreground', ring: 'ring-border', dot: 'bg-muted-foreground/40' },
} as const

// ── Compliance Summary Header ──────────────────────────────────────────────────

interface ComplianceSummaryHeaderProps {
  stats: ComplianceStats | undefined
  isLoading: boolean
  onDrilldown: (tab: TabKey) => void
}

function ComplianceSummaryHeader({ stats, isLoading, onDrilldown }: ComplianceSummaryHeaderProps) {
  const modules: Array<{ key: TabKey; label: string; icon: React.ElementType; mod: ComplianceModuleStatus | undefined }> = [
    { key: 'epf',  label: 'EPF',  icon: Building2,  mod: stats?.epf },
    { key: 'esi',  label: 'ESI',  icon: ShieldCheck, mod: stats?.esi },
    { key: 'ptax', label: 'PTAX', icon: MapPin,       mod: stats?.ptax },
    { key: 'tds',  label: 'TDS',  icon: FileText,     mod: stats?.tds },
  ]

  const hasCriticalDeadline = (stats?.critical_deadline_days ?? null) !== null && (stats!.critical_deadline_days! <= 7)

  return (
    <div className="border-b border-border/60 bg-sidebar/30">
      {/* Deadline alert */}
      {!isLoading && hasCriticalDeadline && (
        <div className="flex items-center gap-2 px-6 py-1.5 text-[12px] font-medium bg-destructive/10 text-destructive border-b border-destructive/15">
          <Clock className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1">
            Statutory filing deadline in {stats!.critical_deadline_days} day{stats!.critical_deadline_days === 1 ? '' : 's'} — ensure all filings are submitted.
          </span>
        </div>
      )}

      {/* Module readiness chips */}
      <div className={cn(
        'flex items-center gap-3 px-6 py-3 overflow-x-auto scrollbar-none',
        isLoading && 'opacity-60 pointer-events-none',
      )}>
        {modules.map(({ key, label, icon: Icon, mod }) => {
          const severity = moduleReadinessSeverity(mod)
          const cls = SEVERITY_CLASSES[severity]
          const SeverityIcon = severity === 'success' ? CheckCircle2 : severity === 'critical' ? XCircle : AlertTriangle
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDrilldown(key)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all',
                'ring-1 hover:opacity-80 flex-shrink-0',
                cls.bg, cls.ring,
              )}
            >
              <div className={cn('flex items-center gap-1.5', cls.text)}>
                <Icon className="h-3.5 w-3.5" />
                <span className="text-[12px] font-semibold">{label}</span>
              </div>
              <SeverityIcon className={cn('h-3 w-3', cls.text)} />
              {mod && (
                <div className="text-[10px] text-muted-foreground ml-1">
                  {mod.employees_missing > 0 && <span>{mod.employees_missing} uncovered</span>}
                  {mod.employees_missing === 0 && mod.filing_gaps === 0 && mod.computation_errors === 0 && <span>Ready</span>}
                  {mod.filing_gaps > 0 && <span> · {mod.filing_gaps} gaps</span>}
                </div>
              )}
              {!mod && isLoading && <span className="text-[10px] text-muted-foreground">—</span>}
              <ChevronRight className="h-3 w-3 text-muted-foreground/40 ml-auto" />
            </button>
          )
        })}

        {/* Divider */}
        <div className="w-px h-8 bg-border/50 flex-shrink-0 mx-1" />

        {/* Aggregate stats */}
        <div className="flex items-center gap-2 px-2 flex-shrink-0">
          <div className="flex items-center gap-1 text-[11px]">
            <FileWarning className="h-3 w-3 text-warning" />
            <span className="text-muted-foreground">Filing Gaps:</span>
            <span className={cn('font-semibold', (stats?.total_filing_gaps ?? 0) > 0 ? 'text-warning' : 'text-success')}>
              {isLoading ? '—' : (stats?.total_filing_gaps ?? 0)}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <Users className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Coverage Gaps:</span>
            <span className={cn('font-semibold', (stats?.total_coverage_gaps ?? 0) > 0 ? 'text-warning' : 'text-success')}>
              {isLoading ? '—' : (stats?.total_coverage_gaps ?? 0)}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <AlertTriangle className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Errors:</span>
            <span className={cn('font-semibold', (stats?.total_computation_errors ?? 0) > 0 ? 'text-destructive' : 'text-success')}>
              {isLoading ? '—' : (stats?.total_computation_errors ?? 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StatutoryDashboard() {
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()

  const activeTab = (searchParams.get('compliance') ?? 'epf') as TabKey
  const validTab  = TABS.some(t => t.key === activeTab) ? activeTab : 'epf'

  const { data: stats, isLoading } = useQuery<ComplianceStats>({
    queryKey:  ['compliance-stats'],
    queryFn:   () => api.get('/payroll/compliance/stats'),
    staleTime: 60_000,
    retry:     false,
  })

  function setTab(key: TabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('compliance', key)
    navigate({ search: next.toString() }, { replace: true })
  }

  // Module-level severity for tab indicator badges
  const tabBadges = useMemo(() => {
    if (!stats) return {}
    const map: Record<string, number> = {}
    const fields = { epf: stats.epf, esi: stats.esi, ptax: stats.ptax, tds: stats.tds }
    for (const [key, mod] of Object.entries(fields)) {
      const issues = (mod?.filing_gaps ?? 0) + (mod?.computation_errors ?? 0) + (mod?.employees_missing ?? 0)
      if (issues > 0) map[key] = issues
    }
    return map
  }, [stats])

  return (
    <div className="flex flex-col gap-0 -mx-6 -mt-6">
      {/* Compliance summary header */}
      <ComplianceSummaryHeader
        stats={stats}
        isLoading={isLoading}
        onDrilldown={setTab}
      />

      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 border-b border-border px-4 pt-2 overflow-x-auto scrollbar-none">
        {TABS.map(tab => {
          const Icon     = tab.icon
          const isActive = validTab === tab.key
          const badge    = tabBadges[tab.key]
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTab(tab.key)}
              title={tab.description}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-medium whitespace-nowrap',
                'border-b-2 transition-all duration-150 flex-shrink-0',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', isActive ? 'text-primary' : 'text-muted-foreground/60')} />
              {tab.label}
              {badge && (
                <span className={cn(
                  'text-[10px] rounded-full px-1.5 py-0 font-semibold tabular-nums leading-[1.6]',
                  isActive ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="pt-4 px-6">
        <Suspense fallback={<TabLoader />}>
          {validTab === 'epf'  && <EPFManagement />}
          {validTab === 'esi'  && <ESIManagement />}
          {validTab === 'ptax' && <PTAXManagement />}
          {validTab === 'tds'  && <TDSManagement />}
        </Suspense>
      </div>
    </div>
  )
}
