/**
 * Runbooks registry.
 *
 * Runbooks are the single how-to system (they replace the old Help drawer).
 * Content is repo-authored in lib/help/help-content.ts; this module groups those
 * entries into browsable categories and resolves each one's deep-link actions.
 */
import { HELP_CONTENT, type HelpEntry, type HelpAction } from '@/lib/help/help-content'

export interface Runbook extends HelpEntry {
  id:              string
  category:        string
  /** Effective top-of-page actions (explicit actions, else a derived "Open page"). */
  resolvedActions: HelpAction[]
}

export interface RunbookCategory {
  label:    string
  runbooks: Runbook[]
}

const CATEGORY_ORDER = [
  'Getting Started',
  'People & Workforce',
  'Master Data & Org',
  'Attendance & Roster',
  'Leave',
  'Payroll',
  'Recruitment',
  'Reports & Analytics',
  'Administration',
  'Intelligence',
  'Other',
]

function categorize(p: string): string {
  if (p.startsWith('/admin/masters') || p.startsWith('/admin/organization') || p.startsWith('/admin/positions') || p.startsWith('/admin/import')) return 'Master Data & Org'
  if (p.startsWith('/admin/employees') || p.startsWith('/admin/onboarding') || p.startsWith('/admin/workforce') || p.startsWith('/admin/documents') || p.startsWith('/admin/letters') || p.startsWith('/admin/assets') || p.startsWith('/admin/benefits') || p.startsWith('/admin/separation')) return 'People & Workforce'
  if (p.startsWith('/admin/attendance') || p.startsWith('/admin/roster') || p.startsWith('/admin/employee-shifts')) return 'Attendance & Roster'
  if (p.startsWith('/admin/leave') || p.startsWith('/admin/comp-off') || p.startsWith('/admin/overtime')) return 'Leave'
  if (p.startsWith('/admin/payroll')) return 'Payroll'
  if (p.startsWith('/admin/recruitment')) return 'Recruitment'
  if (p.startsWith('/admin/reports') || p.startsWith('/admin/explorer') || p.startsWith('/admin/audit-trail')) return 'Reports & Analytics'
  if (p.startsWith('/admin/settings') || p.startsWith('/admin/security') || p.startsWith('/admin/governance') || p.startsWith('/admin/system') || p.startsWith('/admin/approvals')) return 'Administration'
  if (p.startsWith('/admin/intelligence') || p.startsWith('/admin/insights') || p.startsWith('/admin/trust') || p.startsWith('/admin/fabric') || p.startsWith('/admin/enterprise')) return 'Intelligence'
  if (p === '/admin/dashboard' || p.startsWith('/admin/control-center') || p.startsWith('/admin/readiness') || p.startsWith('/admin/daily-ops') || p.startsWith('/admin/my-work-queue') || p.startsWith('/admin/operational-health') || p.startsWith('/admin/notifications')) return 'Getting Started'
  return 'Other'
}

function slug(match: string): string {
  return match.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '') || 'home'
}

/** Only treat a match key as navigable if it points at a concrete route. */
function navigableRoute(match: string): string | null {
  const trimmed = match.endsWith('/') ? match.slice(0, -1) : match
  return trimmed || null
}

function toRunbook(entry: HelpEntry): Runbook {
  const category = entry.category ?? categorize(entry.match)
  const explicit = entry.actions ?? []
  const navTo    = navigableRoute(entry.match)
  const resolvedActions: HelpAction[] = explicit.length > 0
    ? explicit
    : navTo ? [{ label: 'Open page', to: navTo }] : []
  return { ...entry, id: slug(entry.match), category, resolvedActions }
}

// Build the flat list, de-duplicating ids (e.g. '/admin/employees' vs '/admin/employees/').
const seen = new Set<string>()
export const RUNBOOKS: Runbook[] = HELP_CONTENT.map(entry => {
  const rb = toRunbook(entry)
  let id = rb.id
  let n = 2
  while (seen.has(id)) id = `${rb.id}-${n++}`
  seen.add(id)
  return { ...rb, id }
})

export function getRunbookCategories(): RunbookCategory[] {
  const byCat = new Map<string, Runbook[]>()
  for (const rb of RUNBOOKS) {
    const arr = byCat.get(rb.category) ?? []
    arr.push(rb)
    byCat.set(rb.category, arr)
  }
  const ordered: RunbookCategory[] = []
  const emit = (label: string) => {
    const runbooks = byCat.get(label)
    if (runbooks?.length) {
      runbooks.sort((a, b) => a.title.localeCompare(b.title))
      ordered.push({ label, runbooks })
      byCat.delete(label)
    }
  }
  CATEGORY_ORDER.forEach(emit)
  for (const label of [...byCat.keys()]) emit(label)  // anything not in the fixed order
  return ordered
}

export function getRunbookById(id: string): Runbook | undefined {
  return RUNBOOKS.find(r => r.id === id)
}

export function searchRunbooks(q: string): Runbook[] {
  const t = q.trim().toLowerCase()
  if (!t) return RUNBOOKS
  return RUNBOOKS.filter(r =>
    r.title.toLowerCase().includes(t) ||
    r.summary.toLowerCase().includes(t) ||
    r.steps.some(s => s.title.toLowerCase().includes(t) || s.detail.toLowerCase().includes(t)),
  )
}
