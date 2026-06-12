/**
 * nav-config.ts — Enterprise HRMS Navigation
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  9 domains — top nav + contextual left sidebar              │
 * │                                                             │
 * │  Operations · Workforce · Attendance · Leave · Payroll      │
 * │  Compliance · Reports · Intelligence · Setup                │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ═══════════════════════════════════════════════════════════════
 *  STRICT SEPARATION PRINCIPLE (enforced by this config)
 * ═══════════════════════════════════════════════════════════════
 *
 *  OPERATIONAL domains  →  execution · processing · approvals · transactions
 *  SETUP domain         →  masters · policies · structures · configurations
 *
 *  Rule: if a page is DEFINING, CONFIGURING, MAPPING, STRUCTURING,
 *        GOVERNING, TEMPLATING, or ASSIGNING RULES — it belongs ONLY in Setup.
 *
 *  Each configuration / master page has exactly ONE canonical location.
 *  Operational domains contain ZERO configuration duplication.
 *
 * ═══════════════════════════════════════════════════════════════
 *  LONGEST-PREFIX ROUTING (more-specific path overrides domain)
 * ═══════════════════════════════════════════════════════════════
 *
 *  /admin/payroll/statutory      → Compliance  (26 > /admin/payroll 14)
 *  /admin/payroll/salary-components → Setup    (32 > /admin/payroll 14)
 *  /admin/payroll/compensation   → Setup       (28 > /admin/payroll 14)
 *  /admin/payroll/simulation     → Setup       (26 > /admin/payroll 14)
 *  /admin/attendance/policy      → Setup       (24 > /admin/attendance 16)
 *  /admin/attendance/groups      → Setup       (24 > /admin/attendance 16)
 *  (note: /admin/attendance/periods stays in Attendance — Period Lock/Close
 *   is an operational action, owned by the Attendance domain only.)
 *  /admin/masters/rosters         → Setup       (broad /admin/masters prefix)
 *  /admin/leave-types            → Setup       (18 > /admin/leave 12)
 *  /admin/leave-policy           → Setup       (19 > /admin/leave 12)
 */

import {
  // Domain icons
  Users,
  Clock,
  CalendarDays,
  DollarSign,
  ShieldCheck,
  Inbox,
  LifeBuoy,
  BarChart2,
  Settings,
  Brain,
  // Workforce
  Briefcase,
  UserPlus,
  Package,
  // Attendance
  Upload,
  BookOpen,
  AlertTriangle,
  CheckSquare,
  CalendarClock,
  AlarmClock,
  FileUp,
  // Leave
  CalendarHeart,
  CalendarX,
  Timer,
  RefreshCw,
  // Payroll
  Zap,
  PlayCircle,
  CreditCard,
  Receipt,
  RotateCcw,
  GitMerge,
  FlaskConical,
  Layers,
  BarChart3,
  // Compliance
  Landmark,
  ScrollText,
  Archive,
  // Advanced Operations
  Activity,
  Target,
  // Setup
  GitBranch,
  Building2,
  MapPin,
  TrendingUp,
  Scale,
  Radio,
  ListChecks,
  Settings2,
  Bell,
  Smartphone,
  Command,
  Lock,
  GraduationCap,
  LogOut,
  FileText,
  Search,
  BadgeCheck,
  Sparkles,
  Cpu,
} from 'lucide-react'
import type { UserRole } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Optional role allow-list used for navigation VISIBILITY only.
 *
 *   · undefined / empty  → visible to every admin-portal role (super_admin + hr_admin)
 *   · ['super_admin']    → only super_admin sees the tab / group / item
 *
 * This affects rendering of the menu ONLY. Route guards, RBAC, permissions and
 * APIs are unchanged — a role that can still reach a route by URL is unaffected.
 */
type RoleAllowList = UserRole[]

export interface DomainNavItem {
  id:       string
  label:    string
  route:    string
  icon:     React.ComponentType<{ className?: string }>
  badge?:   string
  exact?:   boolean
  /** Extra search synonyms — terms a user might type to find this page. */
  keywords?: string[]
  /** If set, only these roles see this item in the menu. */
  roles?: RoleAllowList
}

export interface DomainNavGroup {
  label: string
  items: DomainNavItem[]
  /** If set, only these roles see this group in the menu. */
  roles?: RoleAllowList
}

export interface Domain {
  id:            string
  label:         string
  shortLabel?:   string
  icon:          React.ComponentType<{ className?: string }>
  /** URL prefixes that activate this domain (longest-prefix wins) */
  matchPrefixes: string[]
  /** Default route when the domain tab is clicked */
  defaultRoute:  string
  groups:        DomainNavGroup[]
  /** If set, only these roles see this domain tab in the menu. */
  roles?:        RoleAllowList
}

// ── Domain Configuration ───────────────────────────────────────────────────────

export const DOMAINS: Domain[] = [

  // ── 0. Operations ─────────────────────────────────────────────────────────────
  //
  // Unified admin home + work queue. Control Center is the default entry point;
  // Insights Hub and Platform Health round out the overview. The Queue group
  // surfaces the work queue, daily-ops and approvals inbox in the same domain.
  //
  {
    id:           'operations',
    label:        'Operations',
    shortLabel:   'Ops',
    icon:         Command,
    matchPrefixes: [
      '/admin/control-center',
      '/admin/dashboard',     // redirect target still activates this domain
      '/admin/insights',
      '/admin/executive',
      '/admin/readiness',
      '/admin/intelligence/workforce-command',
      '/admin/my-work-queue',
      '/admin/daily-ops',
      '/admin/approvals/inbox',
      '/admin/notifications/inbox',
      '/admin/helpdesk',
    ],
    defaultRoute: '/admin/control-center',
    groups: [
      {
        label: 'Overview',
        items: [
          { id: 'control-center',  label: 'Command Center',  route: '/admin/control-center', exact: true, icon: Command,  keywords: ['home', 'dashboard', 'overview', 'control center', 'command center', 'ops', 'operations', 'exceptions', 'kpi', 'health'] },
          { id: 'insights-hub',    label: 'Insights Hub',    route: '/admin/insights',       exact: true, icon: Sparkles, keywords: ['analytics', 'intelligence', 'insights', 'charts', 'workforce data'] },
          { id: 'platform-health', label: 'Platform Health', route: '/admin/readiness',                   icon: Activity, keywords: ['readiness', 'system health', 'uat', 'certification', 'platform status'] },
        ],
      },
      {
        label: 'Queue',
        items: [
          { id: 'ops-queue',   label: 'Operations Queue', route: '/admin/my-work-queue',       icon: Inbox,       keywords: ['work queue', 'my tasks', 'pending actions', 'to-do', 'tasks', 'queue', 'pending items'] },
          { id: 'daily-ops',   label: 'Daily Operations', route: '/admin/daily-ops',           icon: Activity,    keywords: ['daily tasks', 'ops dashboard', 'today ops', 'daily work', 'daily checklist'] },
          { id: 'approvals',   label: 'Approvals Inbox',  route: '/admin/approvals/inbox',     icon: CheckSquare, keywords: ['approve', 'reject', 'pending approvals', 'leave approval', 'attendance approval', 'inbox'] },
          { id: 'notif-inbox', label: 'Inbox',            route: '/admin/notifications/inbox', icon: BookOpen,    keywords: ['notifications', 'alerts', 'messages', 'notification center'] },
          { id: 'hr-helpdesk', label: 'HR Helpdesk',      route: '/admin/helpdesk',            icon: LifeBuoy,    keywords: ['helpdesk', 'tickets', 'support', 'employee tickets', 'hr support', 'service desk', 'grievance', 'issues'] },
        ],
      },
    ],
  },

  // ── 1. Workforce ──────────────────────────────────────────────────────────────
  //
  // OPERATIONAL ONLY: employee directory, onboarding execution, lifecycle actions.
  //
  // REMOVED (moved to Setup › Organization):
  //   Departments & Roles  (/admin/organization)
  //   Sites                (/admin/masters/sites)
  //   Work Locations       (/admin/masters/work-locations)
  //   Grades & Pay Bands   (/admin/masters/grades)
  //   Employment Categories(/admin/masters/employment-categories)
  //
  {
    id:           'workforce',
    label:        'Workforce',
    shortLabel:   'People',
    icon:         Users,
    matchPrefixes: [
      '/admin/employees',
      '/admin/onboarding',
      '/admin/letters',
      '/admin/onboarding/module',
      '/admin/onboarding/pre-joinee',
      '/admin/employees/separation',
      '/admin/assets',
      '/admin/recruitment',
      '/admin/workforce/center',
      '/admin/documents',
    ],
    defaultRoute: '/admin/employees',
    groups: [
      {
        label: 'Employees',
        items: [
          { id: 'employees',             label: 'Employee Directory',   route: '/admin/employees',             exact: true, icon: Users,        keywords: ['staff', 'people', 'employees list', 'headcount', 'employee database'] },
          { id: 'workforce-ops',         label: 'Workforce Operations', route: '/admin/workforce/center',                     icon: Activity,     keywords: ['ops center', 'workforce operations', 'employee ops', 'manpower center', 'people ops'] },
          { id: 'admin-documents',       label: 'Documents',            route: '/admin/documents',                            icon: FileText,     keywords: ['employee documents', 'files', 'document management', 'document vault', 'upload document'] },
          { id: 'onboarding',            label: 'Onboarding',           route: '/admin/onboarding',            exact: true,  icon: UserPlus,     keywords: ['new hire', 'joining', 'new employee', 'induction', 'pre-joining'] },
          { id: 'onboarding-checklists', label: 'Onboarding Checklists', route: '/admin/onboarding/module',                   icon: GraduationCap, keywords: ['onboarding tasks', 'new hire checklist', 'joining checklist', 'induction tasks'] },
          { id: 'separation-workflow',   label: 'Separation',           route: '/admin/employees/separation',                 icon: LogOut,       keywords: ['exit', 'offboarding', 'resignation', 'termination', 'fnf', 'full and final', 'exit process', 'notice period'] },
          { id: 'assets',                label: 'Assets',               route: '/admin/assets',                               icon: Package,      keywords: ['asset management', 'equipment', 'laptop', 'device', 'asset assignment', 'asset allocation', 'inventory'] },
          { id: 'letters',               label: 'Letters',              route: '/admin/letters',                              icon: ScrollText,   keywords: ['offer letter', 'appointment letter', 'salary letter', 'experience letter', 'generate letter'] },
          { id: 'recruitment',           label: 'Recruitment',          route: '/admin/recruitment',                          icon: Briefcase, badge: 'Soon', keywords: ['hiring', 'job opening', 'candidate', 'vacancy', 'interview', 'JD', 'job description'] },
        ],
      },
    ],
  },

  // ── 2. Attendance ─────────────────────────────────────────────────────────────
  //
  // OPERATIONAL ONLY: punch intake, muster, corrections, anomalies, approvals.
  // Roster & Coverage retained as an OPERATIONAL scheduling workspace.
  //
  // REMOVED (moved to Setup › Workforce Rules):
  //   Shift Master     (/admin/shift-master)
  //   Attendance Policy(/admin/attendance/policy)
  // Periods (Lock/Close) stays HERE — operational period lock/close, single home.
  //
  {
    id:           'attendance',
    label:        'Attendance',
    shortLabel:   'Attend',
    icon:         Clock,
    matchPrefixes: [
      '/admin/attendance',       // catches /admin/attendance/* except Setup-overridden paths
      '/admin/employee-shifts',  // operational shift assignment view
      '/admin/roster',           // roster intelligence lives under Attendance > Scheduling
    ],
    defaultRoute: '/admin/attendance/upload-workspace',
    groups: [
      {
        label: 'Operations',
        items: [
          { id: 'att-center',     label: 'Attendance Operations', route: '/admin/attendance/center',           icon: Activity,      keywords: ['ops center', 'attendance operations', 'daily attendance', 'attendance ops', 'attendance management'] },
          { id: 'att-workspace',  label: 'Attendance Workspace', route: '/admin/attendance-workspace', icon: Activity,      keywords: ['attendance data', 'time tracking', 'punch records', 'employee attendance', 'daily punches'] },
          { id: 'att-upload',     label: 'Punch Intake',         route: '/admin/attendance/upload-workspace', icon: Upload, keywords: ['upload attendance', 'import attendance', 'punch upload', 'biometric upload', 'swipe data', 'attendance import'] },
          { id: 'muster',         label: 'Muster Roll',          route: '/admin/attendance/muster',           icon: BookOpen,  keywords: ['daily attendance register', 'attendance report', 'present absent', 'muster'] },
          { id: 'muster-upload',  label: 'Muster Upload',        route: '/admin/attendance/muster-upload',    icon: FileUp,    keywords: ['upload muster', 'muster import', 'import muster data'] },
          { id: 'anomalies',      label: 'Anomalies',            route: '/admin/attendance/anomalies',        icon: AlertTriangle, keywords: ['late', 'absent', 'missing punch', 'attendance issues', 'irregularities', 'half day'] },
          { id: 'regularisation', label: 'Approvals',            route: '/admin/attendance/regularisation',   icon: CheckSquare,   keywords: ['attendance approval', 'regularize', 'regularisation', 'correction request', 'approve attendance', 'WFH'] },
          { id: 'att-periods',    label: 'Periods (Lock/Close)', route: '/admin/attendance/periods',          icon: CalendarClock, keywords: ['attendance lock', 'period close', 'month end', 'lock attendance', 'period management'] },
        ],
      },
      {
        label: 'Scheduling',
        items: [
          { id: 'shift-roster',  label: 'Shift Roster',    route: '/admin/roster',              icon: CalendarClock, keywords: ['roster', 'shift schedule', 'shift plan', 'team schedule', 'staff schedule'] },
          { id: 'emp-shifts',    label: 'Shift Overrides', route: '/admin/employee-shifts',     icon: AlarmClock,    keywords: ['employee shift', 'shift assignment', 'individual shift', 'shift change'] },
          { id: 'roster-intel',  label: 'Roster Analytics', route: '/admin/roster/intelligence', icon: Brain,       keywords: ['roster report', 'shift analytics', 'coverage analytics', 'roster insights'] },
        ],
      },
      {
        label: 'Analytics & Audit',
        items: [
          { id: 'att-exceptions', label: 'Exceptions',  route: '/admin/attendance/exceptions', icon: AlertTriangle, keywords: ['attendance exceptions', 'issues', 'discrepancies', 'flagged attendance', 'attendance problems'] },
          { id: 'att-forensics',  label: 'Timeline',    route: '/admin/attendance/forensics',  icon: Activity,      keywords: ['attendance history', 'employee timeline', 'audit trail', 'attendance log', 'deep dive', 'drill down'] },
          { id: 'who-is-in',      label: 'Who Is In',   route: '/admin/attendance/who-is-in',  icon: Users,         keywords: ['live attendance', 'real-time', 'present today', 'absent today', 'on time', 'check in', 'current status'] },
          { id: 'att-audit',      label: 'Audit Log',   route: '/admin/attendance/audit',      icon: ScrollText,    keywords: ['attendance audit', 'change log', 'audit trail', 'modification history'] },
        ],
      },
    ],
  },

  // ── 3. Leave ──────────────────────────────────────────────────────────────────
  //
  // OPERATIONAL ONLY: approvals, balances, transactions, comp-off, overtime.
  //
  // REMOVED (moved to Setup › Workforce Rules):
  //   Leave Types       (/admin/leave-types)
  //   Leave Policies    (/admin/leave-policy)
  //   Holiday Calendar  (/admin/holidays)
  //
  {
    id:           'leave',
    label:        'Leave',
    shortLabel:   'Leave',
    icon:         CalendarX,
    matchPrefixes: [
      '/admin/leave',     // catches /admin/leave/* except Setup-overridden paths
      '/admin/comp-off',
      '/admin/overtime',
    ],
    defaultRoute: '/admin/comp-off',
    groups: [
      {
        label: 'Operations',
        items: [
          { id: 'leave-approvals',  label: 'Leave Approvals',   route: '/admin/leave/approvals',         icon: CheckSquare,   keywords: ['approve leave', 'leave requests', 'pending leave', 'leave approval', 'review leave'] },
          { id: 'leave-balances',   label: 'Leave Balances',    route: '/admin/leave/balances',          icon: BarChart2,     keywords: ['leave quota', 'remaining leave', 'leave credit', 'PL balance', 'CL balance', 'SL balance', 'EL balance'] },
          { id: 'leave-txns',       label: 'Transactions',      route: '/admin/leave/transactions',      icon: ListChecks,    keywords: ['leave history', 'leave log', 'leave record', 'leave entries', 'leave taken'] },
          { id: 'comp-off',         label: 'Comp Off',          route: '/admin/comp-off',                icon: RefreshCw,     keywords: ['compensatory off', 'compensatory leave', 'CTO', 'comp leave', 'time off in lieu', 'worked extra'] },
          { id: 'overtime',         label: 'Overtime',          route: '/admin/overtime',                icon: Timer,         keywords: ['OT', 'extra hours', 'overtime pay', 'overtime request', 'late sitting'] },
          { id: 'leave-jobs',       label: 'Scheduler Status',  route: '/admin/leave-jobs',              icon: Activity,      keywords: ['accrual scheduler', 'leave automation', 'background jobs', 'cron', 'scheduled tasks'] },
          { id: 'leave-ledger',     label: 'Accrual History',   route: '/admin/leave/ledger',            icon: BookOpen,      keywords: ['leave credits', 'accrual log', 'credit history', 'leave accrued', 'leave earned'] },
          { id: 'leave-accrual',    label: 'Accrual Runs',      route: '/admin/leave/accrual',           icon: RefreshCw,     keywords: ['accrue leave', 'leave accrual run', 'monthly accrual', 'leave credit run'] },
          { id: 'collision-log',    label: 'Leave Conflicts',   route: '/admin/leave/collision-log',     icon: AlertTriangle, keywords: ['leave overlap', 'leave clash', 'conflicting leaves', 'team leave conflict'] },
          { id: 'optional-hols',    label: 'Optional Holidays', route: '/admin/leave/optional-holidays', icon: CalendarDays,  keywords: ['optional holiday', 'OH', 'festival holiday', 'floating holiday'] },
        ],
      },
    ],
  },

  // ── 4. Payroll ────────────────────────────────────────────────────────────────
  //
  // EXECUTION ONLY: runs, revisions, pay inputs, payouts.
  //
  // REMOVED (moved to Setup › Payroll Rules):
  //   Compensation Master  (/admin/payroll/compensation)    — longer prefix → Setup wins
  //   Simulation           (/admin/payroll/simulation)       — longer prefix → Setup wins
  //   Payroll Calendar     (/admin/payroll-readiness)
  //
  // Cost Intelligence + Payroll Ledger live HERE (Analytics & Audit) — their
  // routes are /admin/payroll/*, owned by this domain. Single home, no domain
  // bounce. (The Reports "All Reports" page still exposes them as reports.)
  //
  // Still ACTIVE longer-prefix overrides (defined in Setup):
  //   /admin/payroll/salary-components → Setup
  //   /admin/payroll/compensation      → Setup
  //   /admin/payroll/simulation        → Setup
  //   /admin/payroll/statutory         → Compliance
  //
  {
    id:           'payroll',
    label:        'Payroll',
    shortLabel:   'Pay',
    icon:         DollarSign,
    matchPrefixes: [
      '/admin/payroll',            // catches all /admin/payroll/* not overridden below
      '/admin/payroll/run-console',
    ],
    defaultRoute: '/admin/payroll/hub',
    groups: [
      {
        label: 'Execution',
        items: [
          { id: 'payroll-hub',      label: 'Payroll Hub',        route: '/admin/payroll/hub',         icon: Command,   exact: true, keywords: ['payroll overview', 'payroll home', 'payroll command', 'readiness', 'coverage', 'payroll dashboard', 'all payroll tools'] },
          { id: 'ops-center',       label: 'Payroll Operations', route: '/admin/payroll/center',      icon: Zap,       exact: true, keywords: ['operations center', 'control center', 'run workflow', 'execution', 'payroll operations', 'payroll management', 'payroll center', 'seven step', '7 step'] },
          { id: 'run-console',      label: 'Run Console',       route: '/admin/payroll/run-console', icon: Activity,               keywords: ['run payroll', 'process payroll', 'execute payroll', 'start payroll', 'payroll run console'] },
          { id: 'payroll-runs',     label: 'Payroll Runs',      route: '/admin/payroll',             icon: PlayCircle, exact: true, keywords: ['payroll history', 'past runs', 'salary runs', 'run list'] },
          { id: 'comp-revisions',   label: 'Comp Revisions',    route: '/admin/payroll/revisions',   icon: GitMerge,               keywords: ['salary revision', 'increment', 'hike', 'salary hike', 'appraisal', 'compensation change', 'pay revision', 'ctc revision', 'salary increment'] },
          { id: 'payroll-forecast', label: 'Forecast',          route: '/admin/payroll/forecast',    icon: TrendingUp,             keywords: ['salary forecast', 'cost forecast', 'manpower cost projection', 'payroll projection', 'cost estimate'] },
          { id: 'payroll-variance', label: 'Variance',          route: '/admin/payroll/variance',    icon: BarChart3,              keywords: ['payroll variance', 'month-on-month', 'salary difference', 'payroll change', 'MOM comparison'] },
        ],
      },
      {
        label: 'Processing',
        items: [
          { id: 'payroll-validation', label: 'Validation',         route: '/admin/payroll/validation',           icon: CheckSquare, keywords: ['payroll check', 'validate payroll', 'pre-run check', 'payroll errors'] },
          { id: 'payroll-reconcile',  label: 'Reconciliation',     route: '/admin/payroll/reconciliation',        icon: Scale,       keywords: ['reconcile payroll', 'verify payroll', 'payroll match', 'discrepancy'] },
          { id: 'payroll-governance', label: 'Governance',         route: '/admin/payroll/governance',            icon: ShieldCheck, keywords: ['payroll governance', 'payroll audit', 'compliance check'] },
          { id: 'payroll-approvals',  label: 'Approvals',          route: '/admin/payroll/approvals',             icon: CheckSquare, keywords: ['approve payroll', 'payroll sign-off', 'payroll approval'] },
          { id: 'payroll-finalize',   label: 'Finalization',       route: '/admin/payroll/finalize',              icon: BadgeCheck,  keywords: ['finalize payroll', 'close payroll', 'payroll sign-off', 'lock payroll'] },
          { id: 'payroll-payout',     label: 'Payout',             route: '/admin/payroll/payout',                icon: CreditCard,  keywords: ['disburse salary', 'salary disbursement', 'bank transfer', 'NEFT', 'salary payment', 'payment advice'] },
          { id: 'payroll-payout-recon', label: 'Payout Reconciliation', route: '/admin/payroll/payout-reconciliation', icon: RotateCcw, keywords: ['payment reconciliation', 'bank reconciliation', 'disbursement check'] },
          // Statutory Dashboard intentionally lives only under Compliance (was duplicated here).
          { id: 'payroll-accounting', label: 'Accounting',         route: '/admin/payroll/accounting',            icon: BookOpen,    keywords: ['journal entries', 'GL', 'general ledger', 'accounting entries', 'payroll GL', 'tally', 'ERP'] },
        ],
      },
      {
        label: 'Pay Inputs',
        items: [
          { id: 'loans-advances', label: 'Loans & Advances',    route: '/admin/payroll/advances',       icon: CreditCard, keywords: ['advance salary', 'salary advance request', 'loan advance', 'emergency advance', 'employee loan', 'loan EMI', 'loan deduction', 'salary loan'] },
          { id: 'reimbursements', label: 'Reimbursements',      route: '/admin/payroll/reimbursements', icon: Receipt,    keywords: ['expense', 'claim', 'reimbursement request', 'expense claim', 'medical reimbursement'] },
          { id: 'fbp-recon',      label: 'FBP Reconciliation',  route: '/admin/payroll/fbp',            icon: Receipt,    keywords: ['FBP', 'flexible benefit plan', 'flexi benefit', 'FBP declaration', 'flexible pay', 'flexi pay'] },
          { id: 'variable-pay',   label: 'Variable Pay',        route: '/admin/payroll/variable-pay',   icon: TrendingUp, keywords: ['incentive', 'bonus', 'performance pay', 'variable component', 'incentive pay'] },
          { id: 'arrears',        label: 'Arrear Payments',     route: '/admin/payroll/arrears',        icon: RotateCcw,  keywords: ['arrear', 'back pay', 'retroactive pay', 'previous month', 'pending salary'] },
        ],
      },
      {
        label: 'Analytics & Audit',
        items: [
          { id: 'workforce-cost',      label: 'Cost Intelligence', route: '/admin/payroll/cost-intelligence', icon: BarChart3,     keywords: ['manpower cost', 'salary cost', 'headcount cost', 'cost analytics', 'cost breakdown'] },
          { id: 'payroll-ledger',      label: 'Payroll Ledger',    route: '/admin/payroll/ledger',            icon: BookOpen,      keywords: ['salary ledger', 'payroll record', 'pay history', 'payroll register'] },
          { id: 'payroll-forensics',   label: 'Deep Analysis',     route: '/admin/payroll/forensics',         icon: AlertTriangle, keywords: ['payroll analysis', 'deep dive', 'salary investigation', 'forensic payroll', 'payroll drill down'] },
          { id: 'payroll-investigate', label: 'Investigation',     route: '/admin/payroll/investigate',       icon: Activity,      keywords: ['investigate payroll', 'payroll query', 'payroll dispute', 'salary query'] },
        ],
      },
    ],
  },

  // ── 5. Compliance ─────────────────────────────────────────────────────────────
  //
  // FILING EXECUTION ONLY: EPF/ESI/PTAX/TDS processing and submissions.
  // Configuration of these schemes lives in Setup › Compliance Setup.
  //
  // /admin/payroll/statutory is more specific than /admin/payroll → wins.
  //
  {
    id:           'compliance',
    label:        'Compliance',
    shortLabel:   'Legal',
    icon:         ShieldCheck,
    matchPrefixes: [
      '/admin/payroll/statutory',        // longer than /admin/payroll — wins
      '/admin/payroll/statutory-groups', // statutory groups page
      '/admin/payroll/tax-governance',   // exact match for governance pages
      '/admin/payroll/tax-governance-admin',
      '/admin/payroll/filing-pack',      // Filing Pack Center
    ],
    defaultRoute: '/admin/payroll/statutory-dashboard',
    groups: [
      {
        label: 'Overview',
        items: [
          { id: 'compliance-dashboard', label: 'Dashboard', route: '/admin/payroll/statutory-dashboard', icon: BarChart3, keywords: ['statutory overview', 'compliance overview', 'PF ESI status', 'filing status', 'statutory dashboard'] },
        ],
      },
      {
        label: 'Statutory Filings',
        items: [
          { id: 'pf',        label: 'PF / EPF',        route: '/admin/payroll/statutory/epf',            icon: Landmark,   keywords: ['provident fund', 'EPF', 'employee provident fund', 'PF challan', 'PF return', 'ECR', 'EPFO'] },
          { id: 'esi',       label: 'ESI',             route: '/admin/payroll/statutory/esi',            icon: Landmark,   keywords: ['ESIC', 'employee state insurance', 'medical insurance', 'ESI challan', 'ESI return'] },
          { id: 'pt',        label: 'Prof. Tax',       route: '/admin/payroll/statutory/ptax',           icon: Landmark,   keywords: ['professional tax', 'PTAX', 'state tax', 'PT deduction', 'profession tax'] },
          { id: 'tds',       label: 'TDS',             route: '/admin/payroll/statutory/tds',            icon: Landmark,   keywords: ['tax deducted at source', 'income tax', 'form 16', 'TDS return', 'IT deduction', '24Q'] },
          { id: 'lwf',       label: 'LWF',             route: '/admin/payroll/statutory/lwf',            icon: Landmark,   keywords: ['labour welfare fund', 'welfare fund', 'LWF contribution', 'labour fund'] },
          { id: 'statutory-groups', label: 'Statutory Groups', route: '/admin/payroll/statutory-groups', icon: Landmark, keywords: ['statutory groups', 'PF state', 'ESI state', 'PT state', 'LWF state', 'wage ceiling', 'statutory mapping'] },
          { id: 'stat-recon',label: 'Statutory Recon', route: '/admin/payroll/statutory-reconciliation', icon: ScrollText, keywords: ['statutory reconciliation', 'statutory match', 'filing reconciliation'] },
        ],
      },
      {
        label: 'Tax & Declarations',
        items: [
          { id: 'tax-governance',       label: 'Tax Declarations',   route: '/admin/payroll/tax-governance',       icon: ScrollText,  keywords: ['IT declaration', 'investment declaration', 'form 12BB', 'HRA claim', 'tax saving', '80C', 'tax proof'] },
          { id: 'tax-governance-admin', label: 'Verification Queue', route: '/admin/payroll/tax-governance-admin', icon: ShieldCheck, keywords: ['verify declarations', 'tax verification', 'declaration approval', 'IT proof verification'] },
        ],
      },
      {
        label: 'Filing Pack',
        items: [
          { id: 'filing-pack', label: 'Filing Pack', route: '/admin/payroll/filing-pack', icon: Archive, keywords: ['filing pack', 'ECR 2.0', 'ECR file', 'EPFO upload', '24Q', 'form 24Q', 'TDS return', 'challan sheet', 'ready to file', 'generate compliance files', 'statutory filing', 'compliance pack', 'ITNS 281', 'TDS challan'] },
        ],
      },
    ],
  },

  // ── 6. Reports ────────────────────────────────────────────────────────────────
  //
  // OUTPUTS ONLY: reports, exports, salary sheets.
  // Workforce Cost + Payroll Ledger moved here from Payroll Analytics.
  // Muster Roll is NOT listed here — it's an operational Attendance surface
  // (/admin/attendance/muster), owned solely by the Attendance domain. The
  // "All Reports" page still exposes muster as a report/export.
  //
  {
    id:           'reports',
    label:        'Reports',
    shortLabel:   'Data',
    icon:         BarChart2,
    matchPrefixes: [
      '/admin/reports',
      '/admin/explorer',   // Data Explorer lives outside /admin/reports — keep Reports tab active
      '/admin/audit-trail',
    ],
    defaultRoute: '/admin/reports',
    groups: [
      {
        label: 'Overview',
        items: [
          { id: 'reports-hub',         label: 'Reports Hub',         route: '/admin/reports',             exact: true, icon: BarChart2, keywords: ['reports home', 'all reports', 'reports overview', 'reporting center'] },
        ],
      },
      {
        label: 'Analytics',
        items: [
          { id: 'analytics-studio',    label: 'Analytics Studio',    route: '/admin/reports/analytics',               icon: Sparkles,  keywords: ['analytics studio', 'workforce analytics', 'payroll analytics', 'explore data', 'charts', 'trend', 'department analytics'] },
          { id: 'data-explorer',       label: 'Data Explorer',       route: '/admin/explorer',                        icon: Search,    keywords: ['data explorer', 'explore', 'group by', 'drill down', 'pivot', 'employee list', 'absenteeism', 'compensation growth', 'export excel'] },
        ],
      },
      {
        label: 'Operational',
        items: [
          { id: 'reports-operational', label: 'Operational Reports', route: '/admin/reports/operational',              icon: FileText,  keywords: ['headcount report', 'attendance report', 'salary register', 'statutory register', 'muster roll', 'leave register', 'payroll register'] },
          { id: 'audit-trail',         label: 'Audit Trail',         route: '/admin/audit-trail',                      icon: ScrollText, keywords: ['audit log', 'audit trail', 'change history', 'who changed', 'activity log', 'system log', 'data changes', 'compliance log'] },
        ],
      },
    ],
  },

  // ── 7. Intelligence ──────────────────────────────────────────────────────────
  //
  // First-class primary domain for enterprise oversight, risk, simulation, and
  // advanced workforce intelligence tools.
  //
  // Positioned BEFORE Setup — these are strategic operational capabilities, not
  // administrative utilities. Config/masters live in Setup.
  //
  // matchPrefixes are deliberately more-specific than their parent paths so they
  // win via longest-prefix matching over Attendance (/admin/attendance/* overrides):
  //   /admin/attendance/risk             (22 > /admin/attendance 17)
  //   /admin/attendance/confidence       (28 > /admin/attendance 17)
  //   /admin/attendance/simulate-policy  (33 > /admin/attendance 17)
  //   /admin/attendance/intelligence-center (38 > /admin/attendance 17)
  //   /admin/attendance/health-index     (30 > /admin/attendance 17)

  //   /admin/approvals/governance-matrix (no /admin/approvals prefix in other domains)
  //   /admin/system/*                    (no other domain claims /admin/system)
  //   /admin/workforce/optimization      (no other domain owns /admin/workforce)
  //   /admin/system/automations|incidents|webhooks  (platform orchestration tools)
  //
  {
    id:           'advanced-ops',
    label:        'Intelligence',
    shortLabel:   'Intel',
    icon:         Brain,
    matchPrefixes: [
      // Risk & Governance
      '/admin/approvals/governance-matrix',
      '/admin/system/event-governance',
      '/admin/attendance/risk',
      '/admin/attendance/confidence',
      '/admin/attendance/policy-conflicts',
      // Simulation & Optimization
      '/admin/attendance/simulate-policy',
      '/admin/workforce/optimization',
      // Advanced Intelligence
      '/admin/attendance/intelligence-center',
      '/admin/attendance/health-index',
      '/admin/analytics/workforce',
      '/admin/intelligence',
      '/admin/operational-health',
      // Platform Orchestration
      '/admin/system/orchestration',
      '/admin/system/observability',
      '/admin/system/automations',
      '/admin/system/incidents',
      '/admin/system/webhooks',
      '/admin/system/integrations',
      '/admin/enterprise',
      '/admin/trust',
      '/admin/fabric',
    ],
    defaultRoute: '/admin/workforce/optimization',
    groups: [
      {
        label: 'Risk & Governance',
        items: [
          { id: 'governance-matrix',    label: 'Approval Matrix',       route: '/admin/approvals/governance-matrix', icon: GitMerge,     keywords: ['approval chain', 'approval hierarchy', 'approval rules', 'who approves', 'delegation'] },
          { id: 'event-governance',     label: 'Event Log',             route: '/admin/system/event-governance',     icon: Radio,        roles: ['super_admin'], keywords: ['system events', 'event history', 'audit events', 'system log'] },
          { id: 'attendance-risk',      label: 'Attendance Risk',       route: '/admin/attendance/risk',             icon: AlertTriangle, keywords: ['risk score', 'attendance risk', 'at risk employees', 'risk analysis'] },
          { id: 'attendance-confidence',label: 'Attendance Confidence', route: '/admin/attendance/confidence',       icon: Target,        keywords: ['confidence score', 'data quality', 'attendance accuracy', 'reliability'] },
          { id: 'policy-conflicts',     label: 'Policy Conflicts',      route: '/admin/attendance/policy-conflicts', icon: AlertTriangle, keywords: ['policy violations', 'rule violations', 'attendance conflicts', 'payroll impacting', 'policy clash'] },
        ],
      },
      {
        label: 'Simulation & Optimization',
        items: [
          { id: 'policy-simulation',    label: 'Policy Simulation', route: '/admin/attendance/simulate-policy', icon: FlaskConical, keywords: ['simulate policy', 'what if', 'policy test', 'attendance simulation', 'trial run'] },
          { id: 'workforce-opt',        label: 'Optimization',      route: '/admin/workforce/optimization',     icon: TrendingUp,   keywords: ['workforce optimization', 'efficiency', 'resource optimization', 'productivity'] },
        ],
      },
      {
        label: 'Advanced Analytics',
        items: [
          { id: 'session-intelligence',  label: 'Attendance Sessions',  route: '/admin/attendance/intelligence-center', icon: Activity,   keywords: ['session data', 'biometric sessions', 'punch sessions', 'attendance sessions'] },
          { id: 'health-index',          label: 'Health Index',           route: '/admin/attendance/health-index',        icon: Zap,        keywords: ['attendance health', 'health score', 'data quality', 'attendance quality'] },
          { id: 'workforce-signals',     label: 'Workforce Signals',     route: '/admin/intelligence/workforce-command', icon: Activity,   keywords: ['workforce signals', 'workforce command', 'attention', 'people signals', 'onboarding stalled', 'separations', 'assets at risk', 'probation due', 'manpower'] },
          { id: 'org-health',            label: 'Org Health',             route: '/admin/intelligence/org-health',        icon: TrendingUp, keywords: ['org pulse', 'organization health', 'company health', 'org score'] },
          { id: 'action-center',         label: 'Action Center',          route: '/admin/intelligence/action-center',     icon: Activity,   keywords: ['actions', 'pending actions', 'to-do', 'tasks', 'exceptions', 'action items'] },
          { id: 'workforce-digest',      label: 'Daily Digest',           route: '/admin/intelligence/digest',            icon: FileText,   keywords: ['AI summary', 'daily summary', 'briefing', 'workforce briefing', 'morning digest'] },
          { id: 'workforce-search',      label: 'People Search',          route: '/admin/intelligence/search',            icon: Search,     keywords: ['find employee', 'search employee', 'directory search', 'people finder', 'advanced search'] },
          { id: 'uat-certification',     label: 'UAT Testing',            route: '/admin/intelligence/uat-certification', icon: ShieldCheck, roles: ['super_admin'], keywords: ['UAT', 'user acceptance testing', 'certification', 'QA testing'] },
          { id: 'narratives',            label: 'Narratives',             route: '/admin/intelligence/narratives',        icon: FileText,   keywords: ['AI narratives', 'story', 'written insights', 'AI summary', 'narrative report'] },
          { id: 'workforce-intel',       label: 'Analytics',              route: '/admin/intelligence',  exact: true,    icon: Brain,      keywords: ['workforce intelligence', 'advanced analytics', 'AI analytics', 'intelligence'] },
          { id: 'operational-health',    label: 'Operational Health',     route: '/admin/operational-health',             icon: Activity,   keywords: ['ops health', 'operations status', 'platform health', 'system status'] },
        ],
      },
      {
        label: 'Platform Orchestration',
        // super_admin only — platform/SRE surfaces, not HR-user features (audit D1).
        roles: ['super_admin'],
        items: [
          { id: 'enterprise-control-center', label: 'Enterprise Control Center', route: '/admin/enterprise',           icon: Command,    keywords: ['enterprise', 'tenant management', 'admin center', 'super admin'] },
          { id: 'trust-workspace',           label: 'Trust Intelligence',        route: '/admin/trust',                icon: ShieldCheck, keywords: ['trust score', 'employee trust', 'document trust', 'trust verification', 'trust intelligence'] },
          { id: 'fabric-workspace',          label: 'Fabric Intelligence',       route: '/admin/fabric',               icon: Cpu,         keywords: ['fabric', 'data fabric', 'intelligence fabric'] },
          { id: 'orchestration',             label: 'System Orchestration',      route: '/admin/system/orchestration', icon: GitBranch,   keywords: ['orchestration', 'automation engine', 'workflow engine', 'system flows'] },
          { id: 'observability',             label: 'System Monitor',            route: '/admin/system/observability', icon: Radio,       keywords: ['monitoring', 'logs', 'metrics', 'system monitor', 'observability'] },
          { id: 'integration-registry',      label: 'Integration Registry',      route: '/admin/system/integrations',  icon: Zap,         keywords: ['integrations', 'API', 'connectors', 'third party', 'webhook registry'] },
          { id: 'automations',               label: 'Automations',               route: '/admin/system/automations',   icon: Settings2,   keywords: ['automated rules', 'trigger', 'automation', 'background tasks', 'rules engine'] },
          { id: 'incidents',                 label: 'Incident Manager',          route: '/admin/system/incidents',     icon: ShieldCheck, keywords: ['incidents', 'system issues', 'incident tracking', 'problems', 'alerts', 'SRE'] },
          { id: 'webhooks',                  label: 'Webhooks',                  route: '/admin/system/webhooks',      icon: Activity,    keywords: ['webhook', 'event push', 'callback URL', 'integration hook'] },
        ],
      },
    ],
  },

  // ── 8. Setup ──────────────────────────────────────────────────────────────────
  //
  // SINGLE SOURCE OF TRUTH for all configuration and master data.
  //
  // All items that define / configure / map / structure / govern / template
  // must live HERE and ONLY here. Zero duplication in operational domains.
  //
  // Groups:
  //   Organization       — company structure masters
  //   Workforce Rules    — shift, leave, attendance, holiday configuration
  //   Payroll Rules      — salary structures, components, statutory
  //   Compliance Setup   — statutory scheme configuration
  //   System & Integrations — users, roles, integrations, settings
  //
  // Longer-prefix overrides that bring specific paths here instead
  // of their parent operational domain:
  //   /admin/organization            (longer than no Workforce prefix for org)
  //   /admin/masters/*               (all master data — broad ownership)
  //   /admin/shift-master            (longer than /admin/attendance)
  //   /admin/attendance/policy       (longer than /admin/attendance)
  //   /admin/attendance/groups       (longer than /admin/attendance)

  //   /admin/leave-types             (longer than /admin/leave)
  //   /admin/leave-policy            (longer than /admin/leave)
  //   /admin/leave/governance        (longer than /admin/leave)
  //   /admin/holidays                (standalone — no operational domain owns it)
  //   /admin/payroll/salary-components (longer than /admin/payroll)
  //   /admin/payroll/compensation      (longer than /admin/payroll)
  //   /admin/payroll/simulation        (longer than /admin/payroll)
  //   /admin/payroll-readiness
  //
  {
    id:           'setup',
    label:        'Setup',
    shortLabel:   'Admin',
    icon:         Settings,
    matchPrefixes: [
      // Company settings (longer sub-paths /admin/settings/roles and /users still win)
      '/admin/settings',
      // Organizational masters
      '/admin/organization',
      '/admin/masters',                  // broad — all /admin/masters/* belong here
      // Attendance config overrides (longer than /admin/attendance)
      '/admin/shift-master',
      '/admin/attendance/policy',
      '/admin/attendance/groups',
      // Leave config overrides (longer than /admin/leave)
      '/admin/leave-types',
      '/admin/leave-policy',
      '/admin/leave/governance',
      '/admin/leave/policy-engine',
      '/admin/holidays',
      // Payroll config overrides (longer than /admin/payroll)
      '/admin/payroll/setup',              // Compensation Setup hub (single front door)
      '/admin/payroll/salary-components',
      '/admin/payroll/compensation',
      '/admin/payroll/simulation',
      '/admin/payroll-readiness',
      // System
      '/admin/import',
      '/admin/notifications/templates',
      '/admin/approvals/workflows',
      // Settings sub-pages — longer than Home's /admin/settings (16) → Setup wins
      '/admin/settings/roles',   // 21 chars
      '/admin/settings/users',   // 21 chars
    ],
    defaultRoute: '/admin/organization',
    groups: [

      // ── Company ─────────────────────────────────────────────────────────────
      {
        label: 'Company',
        items: [
          { id: 'company-settings', label: 'Company Settings', route: '/admin/settings', icon: Settings, keywords: ['company setup', 'company profile', 'tenant settings', 'company details', 'organization settings', 'branding'] },
        ],
      },

      // ── Organization ────────────────────────────────────────────────────────
      {
        label: 'Organization',
        items: [
          { id: 'departments',  label: 'Departments & Roles', route: '/admin/organization',                  icon: GitBranch,  keywords: ['org chart', 'org structure', 'department structure', 'hierarchy', 'reporting structure', 'org setup', 'team structure'] },
          { id: 'sites',        label: 'Sites',               route: '/admin/masters/sites',                 icon: Building2,  keywords: ['office', 'branch', 'site master', 'office address', 'branch list'] },
          { id: 'locations',    label: 'Work Locations',      route: '/admin/masters/work-locations',        icon: MapPin,     keywords: ['office location', 'remote location', 'work site', 'branch location', 'location master'] },
          { id: 'cost-centers', label: 'Cost Centers',        route: '/admin/masters/cost-centers',          icon: Scale,      keywords: ['cost centre', 'accounting code', 'GL mapping', 'finance code', 'cost code'] },
          { id: 'grades',       label: 'Grades & Pay Bands',  route: '/admin/masters/grades',                icon: TrendingUp, keywords: ['grade', 'pay band', 'salary band', 'pay grade', 'grade structure', 'CTC band', 'compensation band', 'salary range', 'band', 'level'] },
          { id: 'emp-types',    label: 'Employment Types',    route: '/admin/masters/employment-categories', icon: Users,      keywords: ['employment category', 'employee type', 'contract type', 'full time', 'part time', 'probation', 'permanent', 'contractual', 'consultant'] },
          { id: 'asset-cats',   label: 'Asset Categories',    route: '/admin/masters/asset-categories',      icon: Package,    keywords: ['asset type', 'equipment type', 'device category', 'asset classification', 'laptop category'] },
          // Reference Data hub — identity types, relationship types, document types,
          // and other lookup masters live on the tabbed /admin/masters page. Without
          // this entry those tabs were unreachable (forms pointed to "Masters" with
          // no nav path). exact:true so it doesn't clash with /admin/masters/* pages.
          { id: 'reference-data', label: 'Reference Data', route: '/admin/masters', exact: true, icon: ListChecks, keywords: ['master data', 'lookup', 'reference tables', 'codes', 'masters', 'configuration data', 'taxonomy', 'identity types', 'document types'] },
        ],
      },

      // ── Workforce Rules ──────────────────────────────────────────────────────
      {
        label: 'Workforce Rules',
        items: [
          { id: 'shifts',            label: 'Shifts',            route: '/admin/shift-master',              icon: AlarmClock,    keywords: ['shift master', 'shift timing', 'working hours', 'shift schedule', 'time slots', 'shift setup'] },
          { id: 'rosters',           label: 'Roster Policies',   route: '/admin/masters/rosters',           icon: CalendarClock, keywords: ['roster policy', 'roster setup', 'shift roster policy', 'roster configuration'] },
          { id: 'rotation-policies', label: 'Rotation Policies', route: '/admin/masters/rotation-policies', icon: CalendarClock, keywords: ['rotation', 'rotating shift', 'shift rotation', 'cycle schedule'] },
          { id: 'holidays',          label: 'Holiday Calendar',  route: '/admin/holidays',                  icon: CalendarDays,  keywords: ['public holiday', 'gazetted holiday', 'national holiday', 'holiday list', 'bank holiday', 'weekly off'] },
          { id: 'att-policy',        label: 'Attendance Policy', route: '/admin/attendance/policy',         icon: ShieldCheck,   keywords: ['attendance rules', 'late mark rules', 'half day rules', 'grace period', 'OT policy', 'attendance configuration'] },
        ],
      },

      // ── Leave Configuration ──────────────────────────────────────────────────
      {
        label: 'Leave Configuration',
        items: [
          { id: 'leave-types',         label: 'Leave Types',      route: '/admin/leave-types',         icon: ListChecks,   keywords: ['CL', 'SL', 'PL', 'EL', 'annual leave', 'sick leave', 'casual leave', 'earned leave', 'leave setup', 'add leave type'] },
          { id: 'leave-policies',      label: 'Leave Policies',   route: '/admin/leave-policy',         icon: Settings2,    keywords: ['leave rules', 'leave eligibility', 'leave entitlement', 'carry forward', 'encashment', 'leave configuration'] },
          { id: 'leave-governance',    label: 'Leave Rules',      route: '/admin/leave/governance',     icon: CalendarHeart, keywords: ['leave governance', 'leave rules setup', 'leave approval flow', 'leave automation'] },
          { id: 'leave-policy-engine', label: 'Policy Simulator', route: '/admin/leave/policy-engine',  icon: Settings2,    keywords: ['leave simulation', 'policy test', 'what if leave', 'leave calculator'] },
        ],
      },

      // ── Payroll Rules ────────────────────────────────────────────────────────
      // Compensation Setup is the SINGLE front door for salary components,
      // structures, statutory mappings and statutory policy (tabbed hub).
      // The individual routes still exist for deep links but are no longer
      // listed separately here — eliminating the previous scatter.
      {
        label: 'Payroll Rules',
        items: [
          { id: 'comp-setup',   label: 'Compensation Setup', route: '/admin/payroll/setup',          icon: Layers,       keywords: ['salary structure', 'CTC components', 'compensation structure', 'salary setup', 'earnings deductions', 'HRA', 'basic salary', 'allowance', 'salary components'] },
          { id: 'payroll-grps', label: 'Payroll Groups',    route: '/admin/masters/payroll-groups',  icon: DollarSign,   keywords: ['payroll group', 'pay group', 'salary group', 'payment group'] },
          { id: 'payroll-cal',  label: 'Payroll Calendar',  route: '/admin/payroll-readiness',       icon: CalendarDays, keywords: ['payroll calendar', 'pay cycle', 'payroll schedule', 'pay dates', 'cutoff date', 'payroll month'] },
          { id: 'simulation',   label: 'Simulation',        route: '/admin/payroll/simulation',      icon: FlaskConical, keywords: ['salary simulation', 'payroll simulation', 'what if salary', 'salary calculator', 'CTC simulation', 'hypothetical'] },
        ],
      },

      // ── System & Integrations ────────────────────────────────────────────────
      {
        label: 'System',
        items: [
          { id: 'roles-permissions', label: 'Roles & Permissions',   route: '/admin/settings/roles',          icon: Lock,    keywords: ['roles', 'permissions', 'access control', 'RBAC', 'user roles', 'admin rights', 'privileges'] },
          { id: 'users-mgmt',        label: 'Users',                  route: '/admin/settings/users',          icon: Users,   keywords: ['user management', 'add user', 'manage users', 'admin users', 'HR users', 'user access'] },
          { id: 'approval-workflows',label: 'Approval Workflows',     route: '/admin/approvals/workflows',     icon: GitMerge, keywords: ['approval flow', 'workflow setup', 'escalation', 'approval chain', 'approval rules', 'approver hierarchy'] },
          { id: 'upload',            label: 'Upload Masters',         route: '/admin/import',                  icon: Upload,  keywords: ['bulk upload', 'data import', 'csv upload', 'excel upload', 'bulk import', 'import data', 'mass upload'] },
          { id: 'notif-templates',   label: 'Notification Templates', route: '/admin/notifications/templates', icon: Bell,    keywords: ['email templates', 'notification setup', 'alerts config', 'email configuration', 'SMS template'] },
        ],
      },

    ],
  },

]

// ── Executive Mode — curated domain set ───────────────────────────────────────
//
// Shown in place of DOMAINS when executiveMode is active.
// Three domains: Intelligence (KPIs + narratives), Reports (outputs), Workforce (read-only).
// All routes already exist — this is nav-visibility only, no new pages.
//
// Entry point on toggle: Workforce Command (narrative-first — leads with AI
// summary + attention KPIs before offering the full analytics directory).
//
export const EXECUTIVE_DOMAINS: Domain[] = [

  {
    id:           'exec-intelligence',
    label:        'Intelligence',
    shortLabel:   'Intel',
    icon:         Brain,
    matchPrefixes: [
      '/admin/intelligence',
      '/admin/insights',
      '/admin/executive',
      '/admin/analytics',
      '/admin/operational-health',
    ],
    defaultRoute: '/admin/intelligence/workforce-command',
    groups: [
      {
        label: 'Executive',
        items: [
          { id: 'exec-workforce-command', label: 'Workforce Summary',      route: '/admin/intelligence/workforce-command', exact: true, icon: Brain,     keywords: ['executive home', 'workforce command', 'executive summary', 'leadership view', 'CXO dashboard'] },
          { id: 'exec-narratives',        label: 'Narratives',             route: '/admin/intelligence/narratives',                    icon: FileText,  keywords: ['AI narratives', 'management report', 'executive narrative', 'written summary'] },
          { id: 'exec-insights-hub',      label: 'Insights Hub',           route: '/admin/insights',                       exact: true, icon: Sparkles,  keywords: ['analytics', 'executive analytics', 'insights', 'data'] },
          { id: 'exec-executive-center',  label: 'Executive Intelligence', route: '/admin/executive',                                  icon: BarChart3, keywords: ['CEO view', 'CHRO view', 'executive view', 'executive dashboard', 'CXO view', 'strategic view', 'management view', 'board view'] },
          { id: 'exec-org-health',        label: 'Org Health',             route: '/admin/intelligence/org-health',                    icon: TrendingUp, keywords: ['org pulse', 'organizational health', 'company health'] },
          { id: 'exec-op-health',         label: 'Operational Health',     route: '/admin/operational-health',                        icon: Activity,  keywords: ['ops health', 'platform status', 'operational status'] },
        ],
      },
    ],
  },

  {
    id:           'exec-reports',
    label:        'Reports',
    shortLabel:   'Data',
    icon:         BarChart2,
    matchPrefixes: [
      '/admin/reports',
      '/admin/payroll/cost-intelligence',
      '/admin/payroll/ledger',
    ],
    defaultRoute: '/admin/reports',
    groups: [
      {
        label: 'Reports',
        items: [
          { id: 'exec-reports-all',    label: 'All Reports',       route: '/admin/reports',                   icon: BarChart2  },
          { id: 'exec-cost-intel',     label: 'Cost Intelligence', route: '/admin/payroll/cost-intelligence', icon: BarChart3  },
          { id: 'exec-payroll-ledger', label: 'Payroll Ledger',    route: '/admin/payroll/ledger',            icon: BookOpen   },
        ],
      },
    ],
  },

  {
    id:           'exec-workforce',
    label:        'Workforce',
    shortLabel:   'People',
    icon:         Users,
    matchPrefixes: [
      '/admin/employees',
    ],
    defaultRoute: '/admin/employees',
    groups: [
      {
        label: 'Directory',
        items: [
          { id: 'exec-directory', label: 'Employee Directory', route: '/admin/employees', exact: true, icon: Users },
        ],
      },
    ],
  },

]

/**
 * Returns the executive-mode domain for the given pathname (longest-prefix).
 * Falls back to null if the path isn't covered by executive domains.
 */
export function getExecutiveDomainForPath(pathname: string): Domain | null {
  let best: Domain | null = null
  let bestLen = -1
  for (const domain of EXECUTIVE_DOMAINS) {
    for (const prefix of domain.matchPrefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix)) {
        if (prefix.length > bestLen) {
          bestLen = prefix.length
          best    = domain
        }
      }
    }
  }
  return best
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns the domain that owns the given pathname.
 * Longest-prefix matching so more-specific prefixes win.
 *
 * Override examples:
 *   /admin/payroll/statutory/epf      → Compliance  (26 chars > Payroll 14)
 *   /admin/payroll/salary-components  → Setup       (32 chars > Payroll 14)
 *   /admin/payroll/compensation       → Setup       (28 chars > Payroll 14)
 *   /admin/payroll/simulation         → Setup       (26 chars > Payroll 14)
 *   /admin/attendance/policy          → Setup       (24 chars > Attendance 16)
 *   /admin/leave-types                → Setup       (18 chars > Leave 12)
 *   /admin/leave-policy               → Setup       (19 chars > Leave 12)
 *   /admin/masters/grades             → Setup       (broad /admin/masters prefix)
 *   /admin/shift-master               → Setup       (explicit prefix)
 */
export function getDomainForPath(pathname: string): Domain | null {
  let best: Domain | null = null
  let bestLen = -1

  for (const domain of DOMAINS) {
    for (const prefix of domain.matchPrefixes) {
      if (
        pathname === prefix ||
        pathname.startsWith(prefix + '/') ||
        pathname.startsWith(prefix)
      ) {
        if (prefix.length > bestLen) {
          bestLen = prefix.length
          best    = domain
        }
      }
    }
  }

  return best
}

/** Returns all nav items across all groups in a domain. */
export function getDomainItems(domain: Domain): DomainNavItem[] {
  return domain.groups.flatMap(g => g.items)
}

/** Returns true if any prefix of the domain matches the pathname. */
export function isDomainActive(domain: Domain, pathname: string): boolean {
  return domain.matchPrefixes.some(
    p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p),
  )
}

// ── Role-aware visibility (menu rendering only) ─────────────────────────────────

/**
 * True if a domain/group/item carrying `allow` should be visible to `role`.
 * An undefined or empty allow-list means "no restriction" (all admin roles).
 */
export function isRoleAllowed(allow: RoleAllowList | undefined, role: UserRole | undefined): boolean {
  if (!allow || allow.length === 0) return true
  if (!role) return false
  return allow.includes(role)
}

/**
 * Returns a copy of `domain` with groups/items the role may not see removed.
 * Empty groups are dropped. Does not mutate the original config.
 */
export function getVisibleDomain(domain: Domain, role: UserRole | undefined): Domain {
  return {
    ...domain,
    groups: domain.groups
      .filter(g => isRoleAllowed(g.roles, role))
      .map(g => ({ ...g, items: g.items.filter(i => isRoleAllowed(i.roles, role)) }))
      .filter(g => g.items.length > 0),
  }
}

/**
 * All domains visible to `role`, with groups/items filtered and any domain that
 * ends up with zero visible groups removed entirely.
 */
export function getVisibleDomains(role: UserRole | undefined): Domain[] {
  return DOMAINS
    .filter(d => isRoleAllowed(d.roles, role))
    .map(d => getVisibleDomain(d, role))
    .filter(d => d.groups.length > 0)
}

// ── Searchable nav index ────────────────────────────────────────────────────────
//
// Flattens the LIVE DOMAINS tree into a single list the command palette can
// search — so nav search always matches exactly what's in the sidebar (no
// drift). Role-aware: hidden domains/groups/items are excluded.
//
export interface SearchableNavItem {
  id:       string
  label:    string
  route:    string
  domain:   string
  group:    string
  icon:     React.ComponentType<{ className?: string }>
  badge?:   string
  keywords?: string[]
}

export function getSearchableNavItems(role: UserRole | undefined): SearchableNavItem[] {
  const out: SearchableNavItem[] = []
  const seen = new Set<string>()   // dedupe by route — first (most specific) wins
  for (const domain of getVisibleDomains(role)) {
    for (const group of domain.groups) {
      for (const item of group.items) {
        if (seen.has(item.route)) continue
        seen.add(item.route)
        out.push({
          id:       item.id,
          label:    item.label,
          route:    item.route,
          domain:   domain.label,
          group:    group.label,
          icon:     item.icon,
          badge:    item.badge,
          keywords: item.keywords,
        })
      }
    }
  }
  return out
}
