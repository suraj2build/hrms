/**
 * nav-config.ts — Enterprise HRMS Navigation
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  8 enterprise domains — top nav + contextual left sidebar   │
 * │                                                             │
 * │  Workforce · Attendance · Leave · Payroll · Compliance      │
 * │  Operations · Reports · Setup                               │
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
 *  /admin/attendance/periods     → Setup       (25 > /admin/attendance 16)
 *  /admin/attendance/groups      → Setup       (24 > /admin/attendance 16)
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
  id:     string
  label:  string
  route:  string
  icon:   React.ComponentType<{ className?: string }>
  badge?: string
  exact?: boolean
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

  // ── 0. Home ───────────────────────────────────────────────────────────────────
  //
  // Primary admin landing zone. Control Center + Executive Intelligence + Settings.
  //
  {
    id:           'home',
    label:        'Home',
    shortLabel:   'Home',
    icon:         Command,
    matchPrefixes: [
      '/admin/control-center',
      '/admin/dashboard',     // kept so redirect still activates this domain
      '/admin/intelligence/workforce-command', // primary HR landing
      '/admin/insights',      // Insights Hub — single front door to all analytics
      '/admin/executive',     // Executive Intelligence Center
      '/admin/settings',      // Company / Global Settings
      '/admin/readiness',     // Platform health console
    ],
    defaultRoute: '/admin/intelligence/workforce-command',
    groups: [
      {
        label: 'Overview',
        items: [
          { id: 'workforce-command-home', label: 'Workforce Command',      route: '/admin/intelligence/workforce-command', exact: true, icon: Brain },
          { id: 'insights-hub',           label: 'Insights Hub',           route: '/admin/insights',       exact: true, icon: Sparkles },
          { id: 'control-center',         label: 'Control Center',         route: '/admin/control-center', exact: true, icon: Command   },
          { id: 'platform-health',        label: 'Platform Health',        route: '/admin/readiness',                   icon: Activity  },
          { id: 'executive-center',       label: 'Executive Intelligence', route: '/admin/executive',                   icon: BarChart3 },
        ],
      },
      {
        label: 'Configuration',
        items: [
          { id: 'company-settings', label: 'Company Settings', route: '/admin/settings', icon: Settings },
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
          { id: 'employees',          label: 'Employee Directory', route: '/admin/employees',          exact: true, icon: Users         },
          { id: 'workforce-ops',      label: 'Ops Center',         route: '/admin/workforce/center',                icon: Activity      },
          { id: 'admin-documents',    label: 'Documents',          route: '/admin/documents',                       icon: FileText      },
          { id: 'onboarding',         label: 'Onboarding',         route: '/admin/onboarding',         exact: true, icon: UserPlus      },
          { id: 'onboarding-checklists', label: 'Onboarding Checklists', route: '/admin/onboarding/module',         icon: GraduationCap },
          { id: 'separation-workflow',label: 'Separation',         route: '/admin/employees/separation',           icon: LogOut        },
          { id: 'assets',             label: 'Assets',             route: '/admin/assets',                         icon: Package       },
          { id: 'letters',            label: 'Letters',            route: '/admin/letters',                        icon: ScrollText    },
          { id: 'recruitment',        label: 'Recruitment',        route: '/admin/recruitment',                    icon: Briefcase, badge: 'Soon' },
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
  //   Pay Periods      (/admin/attendance/periods)
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
          { id: 'att-center',     label: 'Ops Center',    route: '/admin/attendance/center',           icon: Activity      },
          { id: 'att-workspace',  label: 'Attendance Workspace', route: '/admin/attendance-workspace', icon: Activity      },
          { id: 'att-upload',     label: 'Punch Intake',  route: '/admin/attendance/upload-workspace', icon: Upload        },
          { id: 'muster',         label: 'Muster Roll',   route: '/admin/attendance/muster',           icon: BookOpen      },
          { id: 'muster-upload',  label: 'Muster Upload', route: '/admin/attendance/muster-upload',    icon: FileUp        },
          { id: 'anomalies',      label: 'Anomalies',     route: '/admin/attendance/anomalies',        icon: AlertTriangle },
          { id: 'regularisation', label: 'Approvals',     route: '/admin/attendance/regularisation',   icon: CheckSquare   },
          { id: 'att-periods',    label: 'Periods (Lock/Close)', route: '/admin/attendance/periods',   icon: CalendarClock },
        ],
      },
      {
        label: 'Scheduling',
        items: [
          { id: 'shift-roster',  label: 'Shift Roster',       route: '/admin/roster',                icon: CalendarClock },
          { id: 'emp-shifts',    label: 'Shift Overrides',    route: '/admin/employee-shifts',       icon: AlarmClock },
          { id: 'roster-intel',  label: 'Roster Intelligence', route: '/admin/roster/intelligence',  icon: Brain      },
        ],
      },
      {
        label: 'Analytics & Audit',
        items: [
          { id: 'att-exceptions', label: 'Exceptions',  route: '/admin/attendance/exceptions', icon: AlertTriangle },
          { id: 'att-forensics',  label: 'Timeline',    route: '/admin/attendance/forensics',  icon: Activity      },
          { id: 'who-is-in',      label: 'Who Is In',   route: '/admin/attendance/who-is-in',  icon: Users         },
          { id: 'att-audit',      label: 'Audit Log',   route: '/admin/attendance/audit',      icon: ScrollText    },
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
          { id: 'leave-approvals',  label: 'Leave Approvals',    route: '/admin/leave/approvals',        icon: CheckSquare   },
          { id: 'leave-balances',   label: 'Leave Balances',     route: '/admin/leave/balances',         icon: BarChart2     },
          { id: 'leave-txns',       label: 'Transactions',       route: '/admin/leave/transactions',     icon: ListChecks    },
          { id: 'comp-off',         label: 'Comp Off',           route: '/admin/comp-off',               icon: RefreshCw     },
          { id: 'overtime',         label: 'Overtime',           route: '/admin/overtime',               icon: Timer         },
          { id: 'leave-jobs',       label: 'Engine Status',      route: '/admin/leave-jobs',             icon: Activity      },
          { id: 'leave-ledger',     label: 'Accrual Ledger',     route: '/admin/leave/ledger',           icon: BookOpen      },
          { id: 'leave-accrual',    label: 'Accrual Engine',     route: '/admin/leave/accrual',          icon: RefreshCw     },
          { id: 'collision-log',    label: 'Collision Log',      route: '/admin/leave/collision-log',    icon: AlertTriangle },
          { id: 'optional-hols',    label: 'Optional Holidays',  route: '/admin/leave/optional-holidays', icon: CalendarDays },
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
  // REMOVED (moved to Reports):
  //   Workforce Cost  (/admin/payroll/cost-intelligence)
  //   Payroll Ledger  (/admin/payroll/ledger)
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
    defaultRoute: '/admin/payroll/center',
    groups: [
      {
        label: 'Execution',
        items: [
          { id: 'ops-center',       label: 'Operations Center', route: '/admin/payroll/center',       icon: Zap,        exact: true },
          { id: 'run-console',      label: 'Run Console',       route: '/admin/payroll/run-console',  icon: Activity    },
          { id: 'payroll-runs',     label: 'Payroll Runs',      route: '/admin/payroll',              icon: PlayCircle, exact: true },
          { id: 'comp-revisions',   label: 'Comp Revisions',    route: '/admin/payroll/revisions',    icon: GitMerge    },
          { id: 'payroll-forecast', label: 'Forecast',          route: '/admin/payroll/forecast',     icon: TrendingUp  },
          { id: 'payroll-variance', label: 'Variance',          route: '/admin/payroll/variance',     icon: BarChart3   },
        ],
      },
      {
        label: 'Processing',
        items: [
          { id: 'payroll-validation', label: 'Validation',  route: '/admin/payroll/validation',  icon: CheckSquare },
          { id: 'payroll-reconcile',  label: 'Reconciliation', route: '/admin/payroll/reconciliation', icon: Scale },
          { id: 'payroll-governance', label: 'Governance',  route: '/admin/payroll/governance',  icon: ShieldCheck },
          { id: 'payroll-approvals',  label: 'Approvals',   route: '/admin/payroll/approvals',   icon: CheckSquare },
          { id: 'payroll-finalize',   label: 'Finalization', route: '/admin/payroll/finalize',   icon: BadgeCheck },
          { id: 'payroll-payout',     label: 'Payout',      route: '/admin/payroll/payout',      icon: CreditCard  },
          { id: 'payroll-payout-recon', label: 'Payout Reconciliation', route: '/admin/payroll/payout-reconciliation', icon: RotateCcw },
          // Statutory Dashboard intentionally lives only under Compliance (was duplicated here).
          { id: 'payroll-accounting', label: 'Accounting',  route: '/admin/payroll/accounting',  icon: BookOpen    },
        ],
      },
      {
        label: 'Pay Inputs',
        items: [
          { id: 'advances',       label: 'Salary Advances', route: '/admin/payroll/advances',       icon: CreditCard },
          { id: 'reimbursements', label: 'Reimbursements',  route: '/admin/payroll/reimbursements', icon: Receipt    },
          { id: 'fbp-recon',      label: 'FBP Reconciliation', route: '/admin/payroll/fbp',         icon: Receipt    },
          { id: 'variable-pay',   label: 'Variable Pay',    route: '/admin/payroll/variable-pay',   icon: TrendingUp },
          { id: 'loans',          label: 'Loan Management', route: '/admin/payroll/loans',          icon: Landmark   },
          { id: 'arrears',        label: 'Arrear Engine',   route: '/admin/payroll/arrears',        icon: RotateCcw  },
        ],
      },
      {
        label: 'Analytics & Audit',
        items: [
          { id: 'payroll-forensics',   label: 'Forensics',     route: '/admin/payroll/forensics',   icon: AlertTriangle },
          { id: 'payroll-investigate', label: 'Investigation', route: '/admin/payroll/investigate', icon: Activity      },
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
      '/admin/payroll/tax-governance',   // exact match for governance pages
      '/admin/payroll/tax-governance-admin',
    ],
    defaultRoute: '/admin/payroll/statutory-dashboard',
    groups: [
      {
        label: 'Overview',
        items: [
          { id: 'compliance-dashboard', label: 'Dashboard', route: '/admin/payroll/statutory-dashboard', icon: BarChart3 },
        ],
      },
      {
        label: 'Statutory Filings',
        items: [
          { id: 'pf',        label: 'PF / EPF',             route: '/admin/payroll/statutory/epf',              icon: Landmark   },
          { id: 'esi',       label: 'ESI',                  route: '/admin/payroll/statutory/esi',              icon: Landmark   },
          { id: 'pt',        label: 'Prof. Tax',            route: '/admin/payroll/statutory/ptax',             icon: Landmark   },
          { id: 'tds',       label: 'TDS',                  route: '/admin/payroll/statutory/tds',              icon: Landmark   },
          { id: 'lwf',       label: 'LWF',                  route: '/admin/payroll/statutory/lwf',              icon: Landmark   },
          { id: 'stat-recon',label: 'Statutory Recon',      route: '/admin/payroll/statutory-reconciliation',   icon: ScrollText },
        ],
      },
      {
        label: 'IT / TDS Governance',
        items: [
          { id: 'tax-governance',       label: 'Tax Governance',       route: '/admin/payroll/tax-governance',       icon: ScrollText },
          { id: 'tax-governance-admin', label: 'Verification Queue',   route: '/admin/payroll/tax-governance-admin', icon: ShieldCheck },
        ],
      },
    ],
  },

  // ── 6. Operations ─────────────────────────────────────────────────────────────
  //
  // UNIFIED QUEUE ONLY: pending approvals, unresolved items, escalations.
  //
  {
    id:           'operations',
    label:        'Operations',
    shortLabel:   'Ops',
    icon:         Inbox,
    matchPrefixes: [
      '/admin/my-work-queue',
      '/admin/daily-ops',
      '/admin/approvals/inbox',
      '/admin/notifications/inbox',
    ],
    defaultRoute: '/admin/my-work-queue',
    groups: [
      {
        label: 'Queue',
        items: [
          { id: 'ops-queue',   label: 'Operations Queue', route: '/admin/my-work-queue',       icon: Inbox       },
          { id: 'daily-ops',   label: 'Daily Operations', route: '/admin/daily-ops',           icon: Activity    },
          { id: 'approvals',   label: 'Approvals Inbox',  route: '/admin/approvals/inbox',     icon: CheckSquare },
          { id: 'notif-inbox', label: 'Inbox',            route: '/admin/notifications/inbox', icon: BookOpen    },
        ],
      },
    ],
  },

  // ── 7. Reports ────────────────────────────────────────────────────────────────
  //
  // OUTPUTS ONLY: reports, exports, muster roll, salary sheets.
  // Workforce Cost + Payroll Ledger moved here from Payroll Analytics.
  //
  {
    id:           'reports',
    label:        'Reports',
    shortLabel:   'Data',
    icon:         BarChart2,
    matchPrefixes: [
      '/admin/reports',
    ],
    defaultRoute: '/admin/reports',
    groups: [
      {
        label: 'Reports',
        items: [
          { id: 'reports-center',  label: 'All Reports',     route: '/admin/reports',                       icon: BarChart2  },
          { id: 'muster-roll',     label: 'Muster Roll',     route: '/admin/attendance/muster',             icon: BookOpen   },
          { id: 'workforce-cost',  label: 'Cost Intelligence', route: '/admin/payroll/cost-intelligence',     icon: BarChart3  },
          { id: 'payroll-ledger',  label: 'Payroll Ledger',  route: '/admin/payroll/ledger',                icon: BookOpen   },
        ],
      },
    ],
  },

  // ── 8. Advanced Operations ───────────────────────────────────────────────────
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
    label:        'Advanced Operations',
    shortLabel:   'Adv',
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
    ],
    defaultRoute: '/admin/workforce/optimization',
    groups: [
      {
        label: 'Risk & Governance',
        items: [
          { id: 'governance-matrix',    label: 'Governance Matrix',      route: '/admin/approvals/governance-matrix',         icon: GitMerge     },
          { id: 'event-governance',     label: 'Event Governance',       route: '/admin/system/event-governance',             icon: Radio,        roles: ['super_admin'] },
          { id: 'attendance-risk',      label: 'Attendance Risk',        route: '/admin/attendance/risk',                     icon: AlertTriangle },
          { id: 'attendance-confidence',label: 'Attendance Confidence',  route: '/admin/attendance/confidence',               icon: Target       },
          { id: 'policy-conflicts',     label: 'Policy Conflicts',       route: '/admin/attendance/policy-conflicts',         icon: AlertTriangle },
        ],
      },
      {
        label: 'Simulation & Optimization',
        items: [
          { id: 'policy-simulation',    label: 'Policy Simulation',      route: '/admin/attendance/simulate-policy',          icon: FlaskConical },
          { id: 'workforce-opt',        label: 'Optimization',           route: '/admin/workforce/optimization',              icon: TrendingUp   },
        ],
      },
      {
        label: 'Advanced Intelligence',
        items: [
          { id: 'session-intelligence',  label: 'Session Intelligence',   route: '/admin/attendance/intelligence-center', icon: Activity  },
          { id: 'health-index',          label: 'Health Index',           route: '/admin/attendance/health-index',        icon: Zap       },
          { id: 'workforce-analytics',   label: 'Headcount Analytics',     route: '/admin/analytics/workforce',            icon: BarChart2 },
          { id: 'org-health',            label: 'Org Health',             route: '/admin/intelligence/org-health',        icon: TrendingUp  },
          { id: 'action-center',         label: 'Action Center',          route: '/admin/intelligence/action-center',     icon: Activity    },
          { id: 'workforce-digest',      label: 'Daily Digest',            route: '/admin/intelligence/digest',            icon: FileText    },
          { id: 'workforce-search',      label: 'People Search',            route: '/admin/intelligence/search',            icon: Search      },
          { id: 'uat-certification',     label: 'UAT Certification',      route: '/admin/intelligence/uat-certification', icon: ShieldCheck, roles: ['super_admin'] },
          { id: 'narratives',            label: 'Narratives',               route: '/admin/intelligence/narratives',        icon: FileText  },
          { id: 'workforce-intel',       label: 'Intelligence Hub',         route: '/admin/intelligence',                   icon: Brain     },
          { id: 'operational-health',    label: 'Operational Health',     route: '/admin/operational-health',             icon: Activity  },
        ],
      },
      {
        label: 'Platform Orchestration',
        // super_admin only — platform/SRE surfaces, not HR-user features (audit D1).
        roles: ['super_admin'],
        items: [
          { id: 'enterprise-control-center', label: 'Enterprise Control Center', route: '/admin/enterprise',               icon: Command    },
          { id: 'orchestration',             label: 'Orchestration Console',     route: '/admin/system/orchestration',     icon: GitBranch  },
          { id: 'observability',             label: 'Observability Console',     route: '/admin/system/observability',     icon: Radio      },
          { id: 'integration-registry',      label: 'Integration Registry',      route: '/admin/system/integrations',      icon: Zap        },
          { id: 'automations',               label: 'Automations',               route: '/admin/system/automations',       icon: Settings2  },
          { id: 'incidents',                 label: 'Incident Manager',          route: '/admin/system/incidents',         icon: ShieldCheck },
          { id: 'webhooks',                  label: 'Webhooks',                  route: '/admin/system/webhooks',          icon: Activity   },
        ],
      },
    ],
  },

  // ── 9. Setup ──────────────────────────────────────────────────────────────────
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
  //   /admin/attendance/periods      (longer than /admin/attendance)
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
      // Organizational masters
      '/admin/organization',
      '/admin/masters',                  // broad — all /admin/masters/* belong here
      // Attendance config overrides (longer than /admin/attendance)
      '/admin/shift-master',
      '/admin/attendance/policy',
      '/admin/attendance/periods',
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

      // ── Organization ────────────────────────────────────────────────────────
      {
        label: 'Organization',
        items: [
          { id: 'departments',  label: 'Departments & Roles', route: '/admin/organization',                    icon: GitBranch },
          { id: 'sites',        label: 'Sites',               route: '/admin/masters/sites',                   icon: Building2 },
          { id: 'locations',    label: 'Work Locations',      route: '/admin/masters/work-locations',          icon: MapPin    },
          { id: 'cost-centers', label: 'Cost Centers',        route: '/admin/masters/cost-centers',            icon: Scale     },
          { id: 'grades',       label: 'Grades & Pay Bands',  route: '/admin/masters/grades',                  icon: TrendingUp },
          { id: 'emp-types',    label: 'Employment Types',    route: '/admin/masters/employment-categories',   icon: Users     },
          { id: 'asset-cats',   label: 'Asset Categories',    route: '/admin/masters/asset-categories',        icon: Package   },
        ],
      },

      // ── Workforce Rules ──────────────────────────────────────────────────────
      {
        label: 'Workforce Rules',
        items: [
          { id: 'shifts',            label: 'Shifts',             route: '/admin/shift-master',              icon: AlarmClock    },
          { id: 'rosters',           label: 'Roster Policies',    route: '/admin/masters/rosters',           icon: CalendarClock },
          { id: 'rotation-policies', label: 'Rotation Policies',  route: '/admin/masters/rotation-policies', icon: CalendarClock },
          { id: 'holidays',          label: 'Holiday Calendar',   route: '/admin/holidays',                  icon: CalendarDays  },
          { id: 'att-policy',        label: 'Attendance Policy',  route: '/admin/attendance/policy',         icon: ShieldCheck   },
        ],
      },

      // ── Leave Configuration ──────────────────────────────────────────────────
      {
        label: 'Leave Configuration',
        items: [
          { id: 'leave-types',         label: 'Leave Types',       route: '/admin/leave-types',          icon: ListChecks    },
          { id: 'leave-policies',      label: 'Leave Policies',    route: '/admin/leave-policy',         icon: Settings2     },
          { id: 'leave-governance',    label: 'Leave Governance',  route: '/admin/leave/governance',     icon: CalendarHeart },
          { id: 'leave-policy-engine', label: 'Policy Engine',     route: '/admin/leave/policy-engine',  icon: Settings2     },
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
          { id: 'comp-setup',      label: 'Compensation Setup',  route: '/admin/payroll/setup',             icon: Layers        },
          { id: 'payroll-grps',    label: 'Payroll Groups',      route: '/admin/masters/payroll-groups',    icon: DollarSign    },
          { id: 'pay-cycles',      label: 'Attendance Periods',  route: '/admin/attendance/periods',        icon: CalendarClock },
          { id: 'payroll-cal',     label: 'Payroll Calendar',    route: '/admin/payroll-readiness',         icon: CalendarDays  },
          { id: 'simulation',      label: 'Simulation',          route: '/admin/payroll/simulation',        icon: FlaskConical  },
        ],
      },

      // ── System & Integrations ────────────────────────────────────────────────
      {
        label: 'System',
        items: [
          { id: 'roles-permissions', label: 'Roles & Permissions',   route: '/admin/settings/roles',          icon: Lock       },
          { id: 'users-mgmt',        label: 'Users',                  route: '/admin/settings/users',          icon: Users      },
          { id: 'approval-workflows',label: 'Approval Workflows',    route: '/admin/approvals/workflows',     icon: GitMerge   },
          { id: 'upload',            label: 'Upload Masters',         route: '/admin/import',                  icon: Upload     },
          { id: 'notif-templates',   label: 'Notification Templates', route: '/admin/notifications/templates', icon: Bell       },
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
    defaultRoute: '/admin/insights',
    groups: [
      {
        label: 'Executive',
        items: [
          { id: 'exec-insights-hub',      label: 'Insights Hub',           route: '/admin/insights',                       exact: true, icon: Sparkles   },
          { id: 'exec-workforce-command', label: 'Workforce Command',      route: '/admin/intelligence/workforce-command', exact: true, icon: Brain      },
          { id: 'exec-executive-center',  label: 'Executive Intelligence', route: '/admin/executive',                                  icon: BarChart3  },
          { id: 'exec-org-health',        label: 'Org Health',             route: '/admin/intelligence/org-health',                    icon: TrendingUp },
          { id: 'exec-narratives',        label: 'Narratives',             route: '/admin/intelligence/narratives',                    icon: FileText   },
          { id: 'exec-op-health',         label: 'Operational Health',     route: '/admin/operational-health',                        icon: Activity   },
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
 *   /admin/attendance/periods         → Setup       (25 chars > Attendance 16)
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
