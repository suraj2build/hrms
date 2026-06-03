/**
 * Static guidance content — shipped in code, overridable per-tenant by guidance_content rows.
 * Rule-based, role-aware, no LLM. Keyed by `${module}:${pageKey}:${type}` (+ optional :role).
 *
 * Resolution precedence (resolveGuidance):
 *   1. tenant DB row for exact role
 *   2. tenant DB row for role='all'
 *   3. static entry for exact role
 *   4. static entry for 'all'
 */
import type {
  GuidanceModule, GuidanceType, GuidanceEntry, GuidanceContentRow,
} from './guidance-config'

type StaticKey = string // `${module}:${pageKey}:${type}` or with `:${role}` suffix

const STATIC: Record<StaticKey, GuidanceEntry> = {
  // ── Leave ────────────────────────────────────────────────────────────────
  'leave:leave-apply:help': {
    title: 'Applying for Leave',
    body: {
      summary: 'Submit a leave request for approval. Your available balance and the approval route are shown before you confirm.',
      contributing_factors: [
        'Leave is deducted from the matching leave-type balance once approved.',
        'Requests route to your reporting manager for action.',
        'Half-day options are available where the policy permits.',
      ],
    },
  },
  'leave:leave-apply:process': {
    title: 'Leave Request Process',
    body: {
      summary: 'How a leave request flows from submission to approval.',
      steps: [
        'Select the leave type and date range.',
        'Review the computed number of days and remaining balance.',
        'Add a reason and submit.',
        'Your manager receives the request for approval or rejection.',
        'Approved leave is reflected in your balance and attendance.',
      ],
    },
  },
  'leave:leave-apply:why': {
    title: 'Why this matters',
    body: {
      summary: 'Accurate leave records keep attendance, payroll, and statutory compliance correct.',
      contributing_factors: [
        'Approved leave adjusts payable days in payroll.',
        'Leave balances follow your tenant leave policy.',
      ],
    },
  },
  'leave:leave-apply:field': {
    title: 'Reason',
    body: { summary: 'A short reason helps your manager action the request quickly.' },
  },

  // ── Attendance ─────────────────────────────────────────────────────────────
  'attendance:attendance:help': {
    title: 'Attendance Overview',
    body: {
      summary: 'View and manage daily attendance, corrections, and approvals. Records are read from punches and roster rules.',
      contributing_factors: [
        'Attendance is computed from punch data against the assigned shift/roster.',
        'Regularisation requests correct missed or wrong punches.',
      ],
    },
  },
  'attendance:attendance:why': {
    title: 'Why this matters',
    body: { summary: 'Attendance drives payable days, overtime, and leave-without-pay in payroll.' },
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  'payroll:payroll:help': {
    title: 'Payroll',
    body: {
      summary: 'Process payroll for a pay group and cycle. Figures derive from attendance, leave, and compensation.',
      contributing_factors: [
        'Payroll uses the cycle and cutoff configured for each pay group.',
        'Net pay = earnings − statutory and other deductions.',
      ],
    },
  },
  'payroll:payroll:why': {
    title: 'Why this matters',
    body: { summary: 'Payroll accuracy affects employee trust and statutory compliance (PF, ESI, TDS).' },
  },

  // ── Employee Master ──────────────────────────────────────────────────────
  'employee_master:employee-profile:help': {
    title: 'Employee Profile',
    body: {
      summary: 'The single source of truth for an employee — personal, job, compensation, documents, and assets.',
      contributing_factors: [
        'Changes here flow to attendance, leave, and payroll.',
        'The Insights tab shows read-only intelligence derived from live records.',
      ],
    },
  },
  'employee_master:employee-profile:why': {
    title: 'Why this matters',
    body: { summary: 'Employee Master is the SSOT; keeping it accurate keeps every downstream module correct.' },
  },

  // ── Onboarding ─────────────────────────────────────────────────────────────
  'onboarding:onboarding-review:help': {
    title: 'Onboarding Review',
    body: {
      summary: 'Review AI-extracted candidate data, verify documents, and approve to create the employee.',
      contributing_factors: [
        'Documents are validated against the Aadhaar identity anchor.',
        'Mismatched documents are flagged and excluded.',
      ],
    },
  },
  'onboarding:onboarding-review:process': {
    title: 'Onboarding Process',
    body: {
      summary: 'From candidate documents to an active employee record.',
      steps: [
        'Candidate uploads documents via the pre-join link.',
        'Run extraction — fields are populated by document authority.',
        'Run validation — identity and required-field checks.',
        'Resolve any flagged items, or approve with exception.',
        'Approve to create the employee in the master.',
      ],
    },
  },

  // ── Separation ─────────────────────────────────────────────────────────────
  'separation:separation:help': {
    title: 'Separation',
    body: {
      summary: 'Manage the employee exit lifecycle from initiation to relieving and archival.',
      contributing_factors: [
        'Asset recovery must complete before final clearance.',
        'Status moves active → on_notice → separated across the lifecycle.',
      ],
    },
  },

  // ── Assets ───────────────────────────────────────────────────────────────
  'assets:assets:help': {
    title: 'Asset Management',
    body: {
      summary: 'Track company assets and their assignment to employees. Outstanding assets block separation clearance.',
    },
  },

  // ── Executive Intelligence ──────────────────────────────────────────────────
  'executive_intelligence:workforce-command:help': {
    title: 'Workforce Command Center',
    body: {
      summary: 'A read-only attention surface — critical workforce items derived live from operational data. It never changes records.',
      contributing_factors: [
        'Every item cites the source table it was derived from.',
        'No AI decisions or scoring — deterministic rules only.',
      ],
    },
  },
}

function lookupStatic(module: GuidanceModule, pageKey: string, type: GuidanceType, role: string): GuidanceEntry | null {
  return STATIC[`${module}:${pageKey}:${type}:${role}`]
      ?? STATIC[`${module}:${pageKey}:${type}`]
      ?? null
}

/** Resolve a single guidance entry with DB-row precedence over static content. */
export function resolveGuidance(
  rows: GuidanceContentRow[],
  module: GuidanceModule,
  pageKey: string,
  type: GuidanceType,
  role: string,
): GuidanceEntry | null {
  const typed = rows.filter(r => r.content_type === type && (r.field_key ?? '') === '')
  const exact = typed.find(r => r.role === role)
  const all   = typed.find(r => r.role === 'all')
  const row   = exact ?? all
  if (row) return { title: row.title ?? defaultTitle(type), body: row.body }
  return lookupStatic(module, pageKey, type, role)
}

/** Resolve a field-level hint (content_type='field', keyed by field_key). */
export function resolveField(
  rows: GuidanceContentRow[],
  module: GuidanceModule,
  pageKey: string,
  fieldKey: string,
  role: string,
): GuidanceEntry | null {
  const typed = rows.filter(r => r.content_type === 'field' && r.field_key === fieldKey)
  const exact = typed.find(r => r.role === role)
  const all   = typed.find(r => r.role === 'all')
  const row   = exact ?? all
  if (row) return { title: row.title ?? 'Field help', body: row.body }
  return STATIC[`${module}:${pageKey}:field:${fieldKey}`]
      ?? STATIC[`${module}:${pageKey}:field`]
      ?? null
}

function defaultTitle(type: GuidanceType): string {
  return type === 'help' ? 'Help' : type === 'process' ? 'Process guide' : type === 'why' ? 'Why this matters' : 'Field help'
}
