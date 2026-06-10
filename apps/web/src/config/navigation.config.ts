/**
 * navigation.config.ts — Single source of truth for all platform navigation.
 *
 * Consumed by:
 *   · AdminSidebar.tsx        — grouped collapsible nav
 *   · EmployeeSidebar.tsx     — ESS nav  (ESS_NAV_ITEMS only)
 *   · CommandPalette.tsx      — ⌘K search targets
 *   · Breadcrumbs             — auto-generated trail
 *   · OperationalBanner.tsx   — deep-link hrefs
 *
 * ── Admin group structure ─────────────────────────────────────────────────────
 *
 *  PRIMARY NAVIGATION  (18 groups — all first-class operational domains)
 *  ─────────────────────────────────────────────────────────────────────
 *   1.  People & Workforce          (workforce)
 *   2.  Attendance                  (attendance)              ← operational only
 *   3.  Shifts & Rosters            (shifts-rosters)
 *   4.  Leave                       (leave)                   ← operational only
 *   5.  Compensation Management     (payroll-compensation)
 *   6.  Payroll Operations          (payroll-operations)
 *   7.  Statutory Compliance        (payroll-statutory)       ← was payroll-compliance
 *   8.  Employee Financial Ops      (payroll-financial)
 *   9.  Payroll Intelligence        (payroll-intelligence)
 *  10.  Data Onboarding             (data-onboarding)
 *  11.  Communications & Documents  (communications)
 *  12.  Compliance & Governance     (compliance-governance)   ← canonical policy/audit/governance
 *  13.  Reports & Intelligence      (reports-intelligence)    ← analytics, reports, executive
 *
 *  ADVANCED OPERATIONS  (4 sub-groups — promoted first-class domain, before Configuration)
 *  ─────────────────────────────────────────────────────────────────────────────────────────
 *  14.  Risk & Governance           (advanced-risk)           ← strategic oversight
 *  15.  Simulation & Optimization   (advanced-simulation)     ← what-if / workforce planning
 *  16.  Advanced Intelligence       (advanced-intelligence)   ← deep analytics
 *  17.  Platform Orchestration      (advanced-platform)       ← workflow/saga engines
 *
 *  CONFIGURATION  (setup utilities only)
 *  ─────────────────────────────────────
 *  18.  Configuration & Masters     (configuration)           ← masters + settings
 *
 * ── Canonical ownership decisions ────────────────────────────────────────────
 *
 *  Governance      → compliance-governance  (single canonical home)
 *  Policy systems  → compliance-governance  (attendance policy, leave policy, policy engine)
 *  Audit           → compliance-governance  (audit log, access control)
 *  Statutory       → payroll-statutory      (EPF/ESI/PTAX/TDS are payroll calculations —
 *                                            requires payroll:view; stays payroll-scoped)
 *  Analytics       → reports-intelligence   (workforce analytics, operational intelligence)
 *  Executive BI    → reports-intelligence   (not buried in advanced)
 *  Simulations     → advanced-simulation    (roster sim, policy sim, workforce opt.)
 *  Risk scoring    → advanced-risk          (confidence, absenteeism risk, governance matrix)
 *  Advanced intel  → advanced-intelligence  (session-level, health index)
 *  Orchestration   → advanced-platform      (saga/event/orchestration tooling)
 *
 * ── Duplication removals / promotion history ─────────────────────────────────
 *  – Attendance Policy:      Attendance       → compliance-governance
 *  – Attendance Audit Log:   Attendance       → compliance-governance
 *  – Operational Health:     Attendance       → compliance-governance
 *  – Leave Policies:         Leave            → compliance-governance
 *  – Policy Engine:          Leave            → compliance-governance
 *  – Roles & Permissions:    Configuration    → compliance-governance
 *  – Approval Workflows:     Configuration    → compliance-governance
 *  – Exception Governance:   advanced         → compliance-governance
 *  – Executive Intelligence: advanced         → reports-intelligence
 *  – Workforce Analytics:    workforce        → reports-intelligence
 *  – Intelligence (AI risk): workforce        → reports-intelligence
 *  – payroll-compliance group renamed → payroll-statutory
 *  – 'Freeze & Governance' item label → 'Payroll Freeze'
 *  – Advanced Tools (collapsed bottom utility) → Advanced Operations (promoted primary domain)
 *    positioned BEFORE Configuration — strategic ops > admin setup
 *
 * Design rules:
 *   · No inline permission logic — use permission strings only
 *   · No raw hex / bg-gray-* / text-blue-* classes
 *   · Icons imported once here; never duplicated in consumers
 */

import {
  Users, Brain, TrendingUp,
  Clock, BarChart2, ClipboardCheck, AlertTriangle, Command,
  FileSearch, Target, Timer,
  AlarmClock, UserCog, CalendarClock, CalendarDays, CalendarHeart,
  ListChecks, BookOpen, Settings2, GitMerge, CalendarCheck, CalendarPlus,
  GitBranch, ShieldCheck, Zap, BadgeCheck, Lock,
  DollarSign, FileText, Stamp, Bell, BarChart3,
  Building2, Database, Upload, Settings, PlayCircle,
  PieChart, Shield, Users as UsersIcon, Radio,
  Landmark, Receipt, CreditCard, Banknote, TrendingDown,
  Scale, BookMarked, Inbox,
  Layers, FlaskConical, Search, Activity, GitMerge as GitMergeIcon,
  FolderUp, UserPlus, ShieldAlert,
  Calculator, ScrollText,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface NavItem {
  /** Unique stable ID — used by command palette recent history */
  id:            string
  label:         string
  /** Full route path (includes /admin/ or /ess/ prefix) */
  route:         string
  /** Short label for breadcrumbs when the full label is too long */
  breadcrumbLabel?: string
  icon:          React.ComponentType<{ className?: string }>
  /** Which sidebar group this belongs to */
  groupId:       string
  /** Portal this item belongs to */
  section:       'admin' | 'ess' | 'both'
  /**
   * Permission string from the platform permission model.
   * If absent, the item is visible to all authenticated users.
   */
  permission?:   string
  /** Extra search terms for the command palette fuzzy matcher */
  keywords?:     string[]
  /** One-line description shown in command palette results */
  description?:  string
  /**
   * Badge key — matched against live sidebar badge counts
   * (e.g. 'Anomalies', 'Corrections', 'Pending').
   */
  badge?:        string
  /** If true, only exact pathname matches set the item as active */
  exact?:        boolean
  /**
   * If true, the item lives inside an Advanced Tools sub-group.
   * Consumers (sidebar, command palette) collapse these by default.
   */
  advanced?:     boolean
}

export interface NavGroup {
  id:               string
  label:            string
  icon:             React.ComponentType<{ className?: string }>
  /** Portal this group belongs to */
  section:          'admin' | 'ess' | 'both'
  /**
   * Permission string — if the user lacks this, the entire group is hidden.
   * If absent, the group is always visible.
   */
  permission?:      string
  /** Whether to expand this group when no active route is inside it */
  defaultExpanded?: boolean
  /**
   * Visual accent class (design-token-only).
   * Controls the group header tint and container background.
   */
  accentClass?:     string
  /**
   * If true, this group belongs to the Advanced Tools section.
   * Sidebar renders all advanced groups inside a collapsible parent.
   */
  advanced?:        boolean
}

// ── Admin Groups ───────────────────────────────────────────────────────────────

export const ADMIN_GROUPS: NavGroup[] = [

  // ── 0. Command Center ────────────────────────────────────────────────────────
  {
    id:               'control-center',
    label:            'Command Center',
    icon:             Command,
    section:          'admin',
    defaultExpanded:  true,
    accentClass:      'bg-primary/[0.06]',
  },

  // ── 1. People & Workforce ────────────────────────────────────────────────────
  {
    id:               'workforce',
    label:            'People & Workforce',
    icon:             Users,
    section:          'admin',
    defaultExpanded:  true,
    accentClass:      'bg-muted/[0.15]',
  },

  // ── 2. Attendance (operational workflows only) ───────────────────────────────
  {
    id:               'attendance',
    label:            'Attendance',
    icon:             Clock,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },

  // ── 3. Shifts & Rosters ──────────────────────────────────────────────────────
  {
    id:               'shifts-rosters',
    label:            'Shifts & Rosters',
    icon:             CalendarClock,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-primary/[0.06]',
  },

  // ── 4. Leave (operational + leave-specific config) ───────────────────────────
  {
    id:               'leave',
    label:            'Leave',
    icon:             CalendarCheck,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },

  // ── 5–9. Payroll (5 focused sub-groups under the Payroll domain) ─────────────

  {
    id:               'payroll-compensation',
    label:            'Compensation',
    icon:             Landmark,
    section:          'admin',
    permission:       'payroll:view',
    defaultExpanded:  false,
    accentClass:      'bg-primary/[0.05]',
  },
  {
    id:               'payroll-operations',
    label:            'Payroll Operations',
    icon:             DollarSign,
    section:          'admin',
    permission:       'payroll:view',
    defaultExpanded:  false,
    accentClass:      'bg-primary/[0.05]',
  },
  {
    // Renamed from 'payroll-compliance' to avoid confusion with the new
    // Compliance & Governance group. EPF/ESI/PTAX/TDS intentionally remain
    // payroll-scoped (require payroll:view and are payroll calculation concerns).
    id:               'payroll-statutory',
    label:            'Statutory Compliance',
    icon:             ShieldCheck,
    section:          'admin',
    permission:       'payroll:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.12]',
  },
  {
    id:               'payroll-financial',
    label:            'Employee Financial Ops',
    icon:             CreditCard,
    section:          'admin',
    permission:       'payroll:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.12]',
  },
  {
    id:               'payroll-intelligence',
    label:            'Payroll Intelligence',
    icon:             BarChart3,
    section:          'admin',
    permission:       'payroll:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },

  // ── 10. Data Onboarding ──────────────────────────────────────────────────────
  {
    id:               'data-onboarding',
    label:            'Data Onboarding',
    icon:             FolderUp,
    section:          'admin',
    permission:       'employees:edit',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },

  // ── 11. Communications & Documents ──────────────────────────────────────────
  {
    id:               'communications',
    label:            'Communications & Documents',
    icon:             Stamp,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },

  // ── 12. Compliance & Governance ──────────────────────────────────────────────
  // Canonical home for: policies, governance, audit, access control,
  // approval governance, and platform exception management.
  // Note: statutory payroll compliance (EPF/ESI/PTAX/TDS) stays in
  // payroll-statutory as it requires payroll:view and is payroll-calculation-scoped.
  {
    id:               'compliance-governance',
    label:            'Compliance & Governance',
    icon:             Scale,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.10]',
  },

  // ── 13. Reports & Intelligence ───────────────────────────────────────────────
  // Contains: operational reports, workforce analytics, executive BI,
  // and operational AI intelligence.
  {
    id:               'reports-intelligence',
    label:            'Reports & Intelligence',
    icon:             BarChart3,
    section:          'admin',
    permission:       'reports:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },

  // ── 14–17. ADVANCED OPERATIONS ───────────────────────────────────────────────
  // First-class primary domain — positioned BEFORE Configuration.
  // Strategic ops > admin setup. Each sub-group is a peer primary nav group.
  // In nav-config.ts (ContextualSidebar / TopNav), these are owned by the
  // 'advanced-ops' domain. Here they are individual sidebar groups for the
  // legacy AdminSidebar and command palette.

  {
    id:               'advanced-risk',
    label:            'Risk & Governance',
    icon:             ShieldAlert,
    section:          'admin',
    permission:       'settings:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },
  {
    id:               'advanced-simulation',
    label:            'Simulation & Optimization',
    icon:             FlaskConical,
    section:          'admin',
    permission:       'settings:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },
  {
    id:               'advanced-intelligence',
    label:            'Advanced Intelligence',
    icon:             Brain,
    section:          'admin',
    permission:       'settings:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },
  {
    id:               'advanced-platform',
    label:            'Platform Orchestration',
    icon:             GitBranch,
    section:          'admin',
    permission:       'settings:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },

  // ── 18. Configuration & Masters (setup utilities only — no governance) ────────
  // Positioned LAST — admin setup is less frequently accessed than Advanced Operations.
  {
    id:               'configuration',
    label:            'Configuration & Masters',
    icon:             Settings,
    section:          'admin',
    permission:       'settings:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },
]

// ── Admin Nav Items ────────────────────────────────────────────────────────────

export const ADMIN_NAV_ITEMS: NavItem[] = [

  // ════════════════════════════════════════════════════════════════════════════
  // 0. CONTROL CENTER  — Primary admin home
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'control-center',
    label:       'Command Center',
    route:       '/admin/control-center',
    icon:        Command,
    groupId:     'control-center',
    section:     'admin',
    exact:       true,
    keywords:    ['home', 'overview', 'operations', 'control center', 'command center', 'health', 'exceptions', 'kpi'],
    description: 'Platform-wide operational command and live health monitoring',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 1. PEOPLE & WORKFORCE
  // Daily operational entry point: admin dashboard + people directory.
  // Analytics and intelligence moved to Reports & Intelligence for clean separation.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'people',
    label:       'People',
    route:       '/admin/employees',
    icon:        Users,
    groupId:     'workforce',
    section:     'admin',
    permission:  'employees:view',
    keywords:    ['employees', 'staff', 'directory', 'HR'],
    description: 'Employee directory and master records',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 2. ATTENDANCE  (operational workflows only)
  // Policy, audit, and health monitoring moved to Compliance & Governance.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'workspace-attendance',
    label:       'Attendance Hub',
    breadcrumbLabel: 'Attendance',
    route:       '/admin/attendance-workspace',
    icon:        Clock,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['attendance workspace', 'muster', 'corrections', 'forensics', 'anomalies'],
    description: 'Unified workspace: processing, corrections, forensics, and intelligence',
  },
  {
    id:          'who-is-in',
    label:       'Who Is In',
    route:       '/admin/attendance/who-is-in',
    icon:        Radio,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['who is in', 'live', 'real-time', 'present', 'absent', 'late', 'on time', 'out of office', 'check-in', 'today'],
    description: 'Real-time attendance status — who is in, late, or out of office today',
  },
  {
    id:          'muster-roll',
    label:       'Muster Roll',
    route:       '/admin/attendance/muster',
    icon:        BarChart2,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['attendance register', 'monthly', 'calendar'],
    description: 'Monthly attendance register across all employees',
  },
  {
    id:          'regularisation',
    label:       'Regularisation',
    route:       '/admin/attendance/regularisation',
    icon:        ClipboardCheck,
    groupId:     'attendance',
    section:     'admin',
    permission:  'corrections:approve',
    badge:       'Corrections',
    keywords:    ['regularise', 'regularisation', 'approve', 'missing punch', 'punch fix', 'attendance adjustment'],
    description: 'Review and approve employee attendance regularisation requests',
  },
  {
    id:          'anomalies',
    label:       'Anomalies',
    route:       '/admin/attendance/anomalies',
    icon:        AlertTriangle,
    groupId:     'attendance',
    section:     'admin',
    permission:  'anomalies:view',
    badge:       'Anomalies',
    keywords:    ['issues', 'flags', 'problems', 'abnormal'],
    description: 'Review attendance anomalies flagged by the system',
  },
  {
    id:          'forensics',
    label:       'Forensics',
    route:       '/admin/attendance/forensics',
    icon:        Target,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['timeline', 'investigation', 'deep dive', 'trace'],
    description: 'Per-employee forensic attendance timeline investigation',
  },
  {
    id:          'overtime',
    label:       'Overtime',
    route:       '/admin/overtime',
    icon:        Timer,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['OT', 'extra hours', 'overtime'],
    description: 'Overtime records and approval management',
  },
  {
    id:          'attendance-upload',
    label:       'Attendance Upload',
    route:       '/admin/attendance/upload',
    icon:        Upload,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:process',
    keywords:    ['CSV', 'bulk upload', 'import', 'raw logs'],
    description: 'Bulk attendance log upload via CSV',
  },
  {
    id:          'period-locks',
    label:       'Period Locks',
    route:       '/admin/attendance/periods',
    icon:        Lock,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:process',
    keywords:    ['lock', 'period', 'close month', 'freeze'],
    description: 'Attendance period locking and freeze management',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 3. SHIFTS & ROSTERS
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'shift-definitions',
    label:       'Shift Definitions',
    breadcrumbLabel: 'Shifts',
    route:       '/admin/shift-master',
    icon:        AlarmClock,
    groupId:     'shifts-rosters',
    section:     'admin',
    permission:  'shifts:configure',
    keywords:    ['shifts', 'timing', 'schedule', 'define shift'],
    description: 'Create and manage shift definitions',
  },
  {
    id:          'employee-shifts',
    label:       'Shift Overrides',
    route:       '/admin/employee-shifts',
    icon:        UserCog,
    groupId:     'shifts-rosters',
    section:     'admin',
    permission:  'shifts:configure',
    keywords:    ['shift override', 'temporary shift', 'emergency coverage', 'exception shift', 'employee shift override'],
    description: 'Exception-only shift overrides for temporary or emergency assignments',
  },
  {
    id:          'roster-planner',
    label:       'Roster Planner',
    route:       '/admin/roster',
    icon:        CalendarClock,
    groupId:     'shifts-rosters',
    section:     'admin',
    permission:  'roster:edit',
    keywords:    ['roster', 'calendar', 'assignment', 'daily shift'],
    description: 'Day-by-day roster assignment planner',
  },
  {
    id:          'roster-templates',
    label:       'Roster Policies',
    route:       '/admin/masters/rosters',
    icon:        CalendarDays,
    groupId:     'shifts-rosters',
    section:     'admin',
    permission:  'roster:edit',
    keywords:    ['roster policy', 'weekly off', 'pattern', 'template', 'preset', 'governance'],
    description: 'Enterprise roster & weekly-off governance policies',
  },
  {
    id:          'rotation-policies-nav',
    label:       'Rotation Policies',
    route:       '/admin/masters/rotation-policies',
    icon:        CalendarClock,
    groupId:     'shifts-rosters',
    section:     'admin',
    permission:  'roster:edit',
    keywords:    ['rotation policy', 'shift mapping', 'weekday shift', 'saturday shift', 'condition shift', 'shift governance'],
    description: 'Map working conditions (weekday/Saturday/Sunday) to specific shifts',
  },
  {
    id:          'roster-intelligence-nav',
    label:       'Roster Intelligence',
    breadcrumbLabel: 'Roster Intel',
    route:       '/admin/roster/intelligence',
    icon:        Brain,
    groupId:     'shifts-rosters',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['roster analytics', 'coverage report', 'rotation analysis'],
    description: 'Roster analytics, coverage reports, and rotation analysis',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 4. LEAVE  (operational + leave-specific config)
  // Leave Policies and Policy Engine moved to Compliance & Governance.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'leave-ledger',
    label:       'Leave Ledger',
    route:       '/admin/leave/ledger',
    icon:        ListChecks,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:view',
    keywords:    ['balance', 'allocation', 'leave register', 'entitlement'],
    description: 'Employee leave balance and entitlement ledger',
  },
  {
    id:          'leave-types',
    label:       'Leave Types',
    route:       '/admin/leave-types',
    icon:        BookOpen,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['CL', 'SL', 'EL', 'leave config', 'leave setup'],
    description: 'Configure leave types (CL, SL, EL, etc.)',
  },
  {
    id:          'accrual-rules',
    label:       'Accrual Rules',
    route:       '/admin/leave/accrual',
    icon:        TrendingUp,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['accrual', 'earn', 'monthly', 'proration'],
    description: 'Leave accrual schedule and rules',
  },
  {
    id:          'comp-off',
    label:       'Comp-Off',
    route:       '/admin/comp-off',
    icon:        CalendarPlus,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:approve',
    keywords:    ['compensatory', 'worked holiday', 'comp off', 'CO'],
    description: 'Compensatory off requests and approvals',
  },
  {
    id:          'collision-log',
    label:       'Collision Log',
    route:       '/admin/leave/collision-log',
    icon:        GitMerge,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:view',
    keywords:    ['conflicts', 'overlap', 'collision', 'duplicate'],
    description: 'Leave collision detection and resolution log',
  },
  {
    id:          'optional-holidays',
    label:       'Optional Holidays',
    route:       '/admin/leave/optional-holidays',
    icon:        CalendarCheck,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['optional holiday', 'OHD', 'restricted holiday'],
    description: 'Optional holiday pool and employee selections',
  },
  {
    id:          'holidays',
    label:       'Holiday Calendar',
    breadcrumbLabel: 'Holidays',
    route:       '/admin/holidays',
    icon:        CalendarDays,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['holidays', 'national holiday', 'public holiday'],
    description: 'Organization-wide holiday calendar',
  },
  {
    id:          'leave-jobs',
    label:       'Leave Jobs',
    route:       '/admin/leave-jobs',
    icon:        PlayCircle,
    groupId:     'leave',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['scheduler', 'automation', 'job', 'cron'],
    description: 'Automated leave processing job schedules',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 5. COMPENSATION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'compensation-master',
    label:       'Compensation Master',
    breadcrumbLabel: 'Compensation',
    route:       '/admin/payroll/compensation',
    icon:        Landmark,
    groupId:     'payroll-compensation',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['salary structure', 'CTC', 'compensation', 'package'],
    description: 'Manage salary structures and employee compensation',
  },
  {
    id:          'comp-revisions',
    label:       'Compensation Revisions',
    breadcrumbLabel: 'Revisions',
    route:       '/admin/payroll/compensation-revisions',
    icon:        TrendingUp,
    groupId:     'payroll-compensation',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['increment', 'hike', 'revision', 'promotion', 'CTC change'],
    description: 'Submit and approve compensation revision requests',
  },
  {
    id:          'comp-simulation',
    label:       'Compensation Simulation',
    breadcrumbLabel: 'Simulation',
    route:       '/admin/payroll/simulation',
    icon:        FlaskConical,
    groupId:     'payroll-compensation',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['simulate', 'model', 'what if', 'impact', 'CTC scenario'],
    description: 'Model compensation changes before committing revisions',
  },
  {
    id:          'comp-layers',
    label:       'Salary Components',
    breadcrumbLabel: 'Components',
    route:       '/admin/payroll/salary-components',
    icon:        Layers,
    groupId:     'payroll-compensation',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['HRA', 'basic', 'allowance', 'deduction', 'component', 'salary structure'],
    description: 'Configure salary component library and earning/deduction types',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 6. PAYROLL OPERATIONS
  // 'Freeze & Governance' renamed to 'Payroll Freeze' — the governance label
  // is reserved for compliance-governance; this is a payroll workflow step.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'payroll-runs',
    label:       'Payroll Runs',
    route:       '/admin/payroll',
    icon:        DollarSign,
    groupId:     'payroll-operations',
    section:     'admin',
    exact:       true,
    permission:  'payroll:view',
    keywords:    ['run payroll', 'salary', 'process', 'pay cycle'],
    description: 'Run and manage payroll cycles',
  },
  {
    id:          'payroll-readiness',
    label:       'Payroll Readiness',
    // NOTE: path is /admin/payroll-readiness (not under /admin/payroll/) for legacy reasons;
    // do not change route without a coordinated redirect migration.
    route:       '/admin/payroll-readiness',
    icon:        BadgeCheck,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['payroll check', 'ready', 'lop', 'validation', 'pre-payroll'],
    description: 'Pre-payroll attendance validation and readiness checks',
  },
  {
    id:          'payroll-validation',
    label:       'Validation Center',
    breadcrumbLabel: 'Validation',
    route:       '/admin/payroll/validation',
    icon:        ShieldCheck,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['validate', 'pre-run', 'rules', 'checks', 'reconciliation'],
    description: 'Pre-run validation engine and reconciliation rules',
  },
  {
    id:          'payroll-resolution-center',
    label:       'Resolution Center',
    breadcrumbLabel: 'Resolution',
    route:       '/admin/payroll/blockers',
    icon:        ShieldAlert,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['blockers', 'failed', 'resolve', 'fix', 'retry', 'remediation', 'errors'],
    description: 'Review and resolve payroll run blockers, retry failed employees',
  },
  {
    // Renamed from 'Freeze & Governance' — this is a payroll workflow step,
    // not a governance system. The 'governance' label is reserved for
    // compliance-governance. Maker-checker and payroll freeze are operational.
    id:          'payroll-governance',
    label:       'Payroll Freeze',
    breadcrumbLabel: 'Freeze',
    route:       '/admin/payroll/governance',
    icon:        Lock,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['maker checker', 'freeze', 'variance', 'finalize', 'lock payroll'],
    description: 'Maker-checker controls and payroll period freeze',
  },
  {
    id:          'payroll-finalization',
    label:       'Finalization',
    breadcrumbLabel: 'Finalization',
    route:       '/admin/payroll/finalize',
    icon:        BadgeCheck,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['finalize', 'lock', 'rollback', 'bank advice', 'export'],
    description: 'Finalize payroll run, freeze month, export bank advice',
  },
  {
    id:          'payroll-approval-workflow',
    label:       'Approval Workflow',
    breadcrumbLabel: 'Approvals',
    route:       '/admin/payroll/approvals',
    icon:        GitMergeIcon,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['approval', 'maker checker', 'multi-stage', 'HR review', 'finance', 'compliance'],
    description: 'Multi-stage payroll approval: HR → Finance → Compliance → Approved',
  },
  {
    id:          'payroll-variance-center',
    label:       'Variance Intelligence',
    breadcrumbLabel: 'Variance',
    route:       '/admin/payroll/variance',
    icon:        TrendingDown,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['variance', 'anomaly', 'MoM', 'net pay change', 'LOP spike', 'zero net'],
    description: 'Month-over-month variance detection and anomaly investigation',
  },
  {
    id:          'payroll-payout',
    label:       'Payout Center',
    breadcrumbLabel: 'Payout',
    route:       '/admin/payroll/payout',
    icon:        Banknote,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['payout', 'bank advice', 'disbursement', 'transfer', 'failed payout'],
    description: 'Bank disbursement orchestration, advice export, and payout tracking',
  },
  {
    id:          'payroll-payout-reconciliation',
    label:       'Payout Reconciliation',
    breadcrumbLabel: 'Payout Recon',
    route:       '/admin/payroll/payout-reconciliation',
    icon:        Scale,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['payout reconciliation', 'UTR', 'bank reference', 'disbursement status', 'failed payout', 'retry'],
    description: 'Track and reconcile payout obligations against actual bank disbursements',
  },
  {
    id:          'payroll-calendar',
    label:       'Payroll Calendar',
    breadcrumbLabel: 'Calendar',
    route:       '/admin/payroll/forecast',
    icon:        CalendarCheck,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['calendar', 'schedule', 'cycle', 'pay date', 'forecast'],
    description: 'Payroll cycle calendar and disbursement schedule',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 7. STATUTORY COMPLIANCE  (was 'Compliance & Taxation')
  // EPF, ESI, PTAX, TDS — payroll-calculation scoped, require payroll:view.
  // General compliance/governance lives in compliance-governance group.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'statutory-reconciliation',
    label:       'Statutory Reconciliation',
    breadcrumbLabel: 'Stat. Reconciliation',
    route:       '/admin/payroll/statutory-reconciliation',
    icon:        Scale,
    groupId:     'payroll-statutory',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['PF', 'ESI', 'PT', 'TDS', 'reconciliation', 'filing', 'statutory'],
    description: 'PF · ESI · PT · TDS reconciliation and ready-for-filing status',
  },
  {
    id:          'statutory-epf',
    label:       'EPF Management',
    breadcrumbLabel: 'EPF',
    route:       '/admin/payroll/statutory/epf',
    icon:        Landmark,
    groupId:     'payroll-statutory',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['EPF', 'PF', 'provident fund', 'EPS', 'EDLI'],
    description: 'Employee Provident Fund contributions and filing',
  },
  {
    id:          'statutory-esi',
    label:       'ESI Management',
    breadcrumbLabel: 'ESI',
    route:       '/admin/payroll/statutory/esi',
    icon:        Landmark,
    groupId:     'payroll-statutory',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['ESI', 'ESIC', 'medical insurance', 'health insurance statutory'],
    description: 'Employee State Insurance contributions and eligibility',
  },
  {
    id:          'statutory-ptax',
    label:       'Professional Tax',
    breadcrumbLabel: 'PTAX',
    route:       '/admin/payroll/statutory/ptax',
    icon:        Landmark,
    groupId:     'payroll-statutory',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['PTAX', 'professional tax', 'state tax', 'PT'],
    description: 'Professional tax slabs and state-wise contributions',
  },
  {
    id:          'statutory-tds',
    label:       'TDS Management',
    breadcrumbLabel: 'TDS',
    route:       '/admin/payroll/statutory/tds',
    icon:        Landmark,
    groupId:     'payroll-statutory',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['TDS', 'income tax', 'tax deduction', '80C', 'declarations'],
    description: 'TDS computation, declarations, and proof management',
  },
  {
    id:          'tax-governance',
    label:       'Tax Governance',
    breadcrumbLabel: 'Tax Governance',
    route:       '/admin/payroll/tax-governance',
    icon:        ScrollText,
    groupId:     'payroll-statutory',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['tax governance', 'IT window', 'declaration window', 'regime policy', 'proof settings', 'compliance', '80C'],
    description: 'IT declaration window, regime policy, proof settings, and compliance dashboard',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 8. EMPLOYEE FINANCIAL OPS
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'advance-salary',
    label:       'Salary Advances',
    breadcrumbLabel: 'Advances',
    route:       '/admin/payroll/advances',
    icon:        Banknote,
    groupId:     'payroll-financial',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['advance', 'salary advance', 'loan against salary'],
    description: 'Employee advance salary requests and recovery schedules',
  },
  {
    id:          'loans',
    label:       'Loan Management',
    route:       '/admin/payroll/loans',
    icon:        CreditCard,
    groupId:     'payroll-financial',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['loan', 'EMI', 'amortization', 'repayment'],
    description: 'Employee loan disbursement and EMI tracking',
  },
  {
    id:          'reimbursements',
    label:       'Reimbursements',
    route:       '/admin/payroll/reimbursements',
    icon:        Receipt,
    groupId:     'payroll-financial',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['reimbursement', 'claim', 'expense', 'medical'],
    description: 'Employee expense reimbursement claims and approvals',
  },
  {
    id:          'variable-pay',
    label:       'Variable Pay',
    route:       '/admin/payroll/variable-pay',
    icon:        TrendingDown,
    groupId:     'payroll-financial',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['incentive', 'bonus', 'variable', 'performance pay'],
    description: 'Performance incentives and variable payout management',
  },
  {
    id:          'arrear-engine',
    label:       'Arrear Engine',
    route:       '/admin/payroll/arrears',
    icon:        Scale,
    groupId:     'payroll-financial',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['arrear', 'backdated', 'retroactive', 'arrears calculation'],
    description: 'Calculate and process salary arrears for revision adjustments',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 9. PAYROLL INTELLIGENCE
  // NOTE: Payslip Explainability is NOT a separate entry — it is accessed
  // via Payroll Forensics → drill into a specific run.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'payroll-forensics',
    label:       'Payroll Forensics',
    breadcrumbLabel: 'Forensics',
    route:       '/admin/payroll/forensics',
    icon:        Activity,
    groupId:     'payroll-intelligence',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['audit', 'forensics', 'timeline', 'snapshot', 'replay', 'integrity', 'hash', 'who changed', 'override', 'log', 'trail', 'explainability', 'payslip breakdown'],
    description: 'Audit trail, immutable snapshots, deterministic replay, and per-employee payslip explainability',
  },
  {
    id:          'payroll-accounting-center',
    label:       'Accounting Center',
    breadcrumbLabel: 'Accounting',
    route:       '/admin/payroll/accounting',
    icon:        BookOpen,
    groupId:     'payroll-intelligence',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['GL', 'general ledger', 'journal entries', 'double entry', 'accounting', 'cost center', 'ERP export', 'SAP', 'Tally', 'Zoho', 'QuickBooks', 'accrual', 'reversal'],
    description: 'Double-entry GL ledger, journal entries, cost allocations, and ERP exports',
  },
  {
    id:          'payroll-ledger',
    label:       'Payroll Ledger',
    breadcrumbLabel: 'Ledger',
    route:       '/admin/payroll/ledger',
    icon:        BookMarked,
    groupId:     'payroll-intelligence',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['ledger', 'audit', 'changes', 'explainability', 'before after'],
    description: 'Explainability ledger for all payroll component changes',
  },
  {
    id:          'payroll-investigate',
    label:       'Payroll Investigation',
    breadcrumbLabel: 'Investigation',
    route:       '/admin/payroll/investigate',
    icon:        Search,
    groupId:     'payroll-intelligence',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['investigate', 'drill down', 'discrepancy', 'why', 'payroll diff'],
    description: 'Deep-dive investigation for payroll discrepancies',
  },
  {
    id:          'payroll-cost-intelligence',
    label:       'Workforce Cost',
    breadcrumbLabel: 'Cost Intel',
    route:       '/admin/payroll/cost-intelligence',
    icon:        PieChart,
    groupId:     'payroll-intelligence',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['cost', 'workforce cost', 'headcount cost', 'department cost'],
    description: 'Workforce cost breakdown and trend analytics',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 10. DATA ONBOARDING
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'master-import',
    label:       'Master Import',
    route:       '/admin/import',
    icon:        FolderUp,
    groupId:     'data-onboarding',
    section:     'admin',
    permission:  'employees:edit',
    keywords:    ['import', 'CSV', 'XLSX', 'bulk upload', 'master data', 'departments', 'employees'],
    description: 'Bulk import master data and employees via CSV/XLSX',
  },
  {
    id:          'ai-onboarding',
    label:       'AI Onboarding',
    route:       '/admin/onboarding',
    icon:        UserPlus,
    groupId:     'data-onboarding',
    section:     'admin',
    permission:  'employees:edit',
    keywords:    ['onboarding', 'AI', 'document extraction', 'new hire', 'candidate'],
    description: 'AI-assisted employee onboarding via document extraction',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 11. COMMUNICATIONS & DOCUMENTS
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'letters',
    label:       'Letter Generation',
    breadcrumbLabel: 'Letters',
    route:       '/admin/letters',
    icon:        Stamp,
    groupId:     'communications',
    section:     'admin',
    permission:  'employees:edit',
    keywords:    ['letter', 'offer letter', 'experience', 'appointment', 'generate'],
    description: 'Generate and manage HR letter documents',
  },
  {
    id:          'notifications-templates',
    label:       'Notification Templates',
    breadcrumbLabel: 'Notifications',
    route:       '/admin/notifications/templates',
    icon:        Bell,
    groupId:     'communications',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['alerts', 'email', 'notify', 'channel', 'templates', 'SMS'],
    description: 'Notification channels, templates, and delivery log',
  },
  {
    id:          'operational-inbox-admin',
    label:       'Operational Inbox',
    breadcrumbLabel: 'Inbox',
    route:       '/admin/notifications/inbox',
    icon:        Inbox,
    groupId:     'communications',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['inbox', 'notifications', 'alerts', 'action items'],
    description: 'Unified operational inbox with escalation management',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 12. COMPLIANCE & GOVERNANCE  ← NEW canonical group
  //
  // Consolidated from: Configuration (roles, workflows), Attendance (policy,
  // audit, health), Leave (policies, policy engine), Advanced (exceptions).
  //
  // Ownership taxonomy within this group:
  //   Access Control:   Roles & Permissions
  //   Workflow Control: Approval Workflows, Exception Governance
  //   Policy Systems:   Attendance Policy, Leave Policy, Policy Engine
  //   Audit:            Attendance Audit Log
  //   Platform Health:  Operational Health
  // ════════════════════════════════════════════════════════════════════════════

  // — Access Control —
  {
    id:          'roles-permissions',
    label:       'Roles & Permissions',
    route:       '/admin/settings/roles',
    icon:        Shield,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['RBAC', 'roles', 'access control', 'permissions', 'users'],
    description: 'Role-based access control and permission governance',
  },

  // — Workflow Governance —
  {
    id:          'workflows',
    label:       'Approval Workflows',
    breadcrumbLabel: 'Workflows',
    route:       '/admin/approvals/workflows',
    icon:        GitMerge,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'workflows:configure',
    keywords:    ['workflow', 'approval chain', 'escalation'],
    description: 'Configure multi-level approval workflows',
  },
  {
    // Moved from advanced — attendance exception governance is a compliance
    // concern, not a simulation/experimental tool.
    id:          'exception-governance',
    label:       'Exception Governance',
    breadcrumbLabel: 'Exceptions',
    route:       '/admin/attendance/exceptions',
    icon:        ShieldAlert,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['exception', 'rule override', 'governance engine', 'attendance exception'],
    description: 'Fine-grained attendance exception tracking and governance rules',
  },

  // — Policy Systems —
  {
    // Moved from Attendance — policy configuration belongs in governance, not operations.
    id:          'attendance-policy',
    label:       'Attendance Policy',
    route:       '/admin/attendance/policy',
    icon:        Settings2,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['policy', 'rules', 'attendance config', 'grace period'],
    description: 'Attendance policy configuration and rules',
  },
  {
    // Moved from Leave — policy configuration belongs in governance, not operations.
    id:          'leave-policies',
    label:       'Leave Policy',
    route:       '/admin/leave-policy',
    icon:        Settings2,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['policy', 'rules', 'carry forward', 'encashment'],
    description: 'Leave policy configuration and rules',
  },
  {
    // Moved from Leave — rule engine is a governance/compliance concern.
    id:          'policy-engine',
    label:       'Policy Engine',
    route:       '/admin/leave/policy-engine',
    icon:        GitBranch,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['policy', 'rules', 'inheritance', 'hierarchy'],
    description: 'Visual leave policy inheritance and rule engine',
  },
  {
    id:          'leave-governance',
    label:       'Leave Governance',
    route:       '/admin/leave/governance',
    icon:        CalendarHeart,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['birthday', 'anniversary', 'event grant', 'important dates', 'event leave'],
    description: 'Configure important date types and event-triggered leave grants',
  },

  // — Audit —
  {
    // Moved from Attendance — audit trails are a compliance/governance concern.
    id:          'audit-log',
    label:       'Attendance Audit Log',
    breadcrumbLabel: 'Audit',
    route:       '/admin/attendance/audit',
    icon:        FileSearch,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'attendance:audit',
    keywords:    ['history', 'changes', 'log', 'who changed', 'audit trail'],
    description: 'Full audit trail of all attendance record changes',
  },

  // — Platform Health —
  {
    // Moved from Attendance — platform processing health is an operational
    // governance concern, not an attendance workflow.
    id:          'operational-health',
    label:       'Operational Health',
    route:       '/admin/operational-health',
    icon:        Zap,
    groupId:     'compliance-governance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['health', 'status', 'monitoring', 'processing', 'locks'],
    description: 'Platform processing status and operational alerts',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 13. CONFIGURATION & MASTERS  (setup/config utilities only)
  // Governance and compliance items removed — they live in compliance-governance.
  // This group now contains ONLY: masters, locations, settings, observability.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'sites',
    label:       'Sites',
    route:       '/admin/masters/sites',
    icon:        Building2,
    groupId:     'configuration',
    section:     'admin',
    permission:  'masters:edit',
    keywords:    ['location', 'office', 'site', 'branch'],
    description: 'Work site and location management',
  },
  {
    id:          'users',
    label:       'Users',
    route:       '/admin/settings/users',
    icon:        UsersIcon,
    groupId:     'configuration',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['users', 'accounts', 'login', 'admin users'],
    description: 'System user accounts and access management',
  },
  {
    id:          'masters',
    label:       'Masters Config',
    breadcrumbLabel: 'Masters',
    route:       '/admin/masters',
    icon:        Database,
    groupId:     'configuration',
    section:     'admin',
    permission:  'masters:edit',
    keywords:    ['config', 'setup', 'master data', 'reference data', 'departments', 'grades'],
    description: 'Master data configuration for departments, grades, categories, etc.',
  },
  {
    id:          'settings',
    label:       'Settings',
    route:       '/admin/settings',
    icon:        Settings,
    groupId:     'configuration',
    section:     'admin',
    exact:       true,
    permission:  'settings:view',
    keywords:    ['configuration', 'preferences', 'tenant'],
    description: 'Platform configuration and tenant settings',
  },
  {
    id:          'observability',
    label:       'Observability Console',
    breadcrumbLabel: 'Observability',
    route:       '/admin/system/observability',
    icon:        Radio,
    groupId:     'configuration',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['event bus', 'job queue', 'metrics', 'platform health', 'dead letter', 'modules'],
    description: 'Live platform event bus, job queue, and module health console',
  },
  {
    id:          'integration-registry',
    label:       'Integration Registry',
    breadcrumbLabel: 'Integrations',
    route:       '/admin/system/integrations',
    icon:        GitBranch,
    groupId:     'configuration',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['integration', 'API', 'biometric', 'ERP', 'connect', 'external', 'third party', 'connector'],
    description: 'Register and manage external system integrations and API connections',
  },
  {
    id:          'webhook-management',
    label:       'Webhooks',
    breadcrumbLabel: 'Webhooks',
    route:       '/admin/system/webhooks',
    icon:        Zap,
    groupId:     'configuration',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['webhook', 'outbound', 'delivery', 'event push', 'API callback', 'http hook'],
    description: 'Configure outbound webhooks and monitor delivery history',
  },
  {
    id:          'automations-console',
    label:       'Automations',
    breadcrumbLabel: 'Automations',
    route:       '/admin/system/automations',
    icon:        Activity,
    groupId:     'configuration',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['automation', 'jobs', 'scheduler', 'cron', 'background tasks', 'triggers'],
    description: 'Background automation jobs and scheduler management',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 14. REPORTS & INTELLIGENCE
  // Contains: operational reports, workforce analytics, operational AI intelligence,
  // and executive BI. Advanced/experimental intelligence stays in advanced-intelligence.
  // ════════════════════════════════════════════════════════════════════════════

  {
    id:          'reports',
    label:       'Reports',
    route:       '/admin/reports',
    icon:        BarChart3,
    groupId:     'reports-intelligence',
    section:     'admin',
    permission:  'reports:view',
    keywords:    ['export', 'download', 'analytics', 'data export'],
    description: 'Operational reports and data exports',
  },
  {
    // Moved from workforce — analytics belongs in reports & intelligence,
    // not in the operational people command center.
    id:          'workforce-analytics',
    label:       'Workforce Analytics',
    breadcrumbLabel: 'Analytics',
    route:       '/admin/analytics/workforce',
    icon:        TrendingUp,
    groupId:     'reports-intelligence',
    section:     'admin',
    permission:  'reports:view',
    keywords:    ['analytics', 'trends', 'stats', 'headcount', 'attrition', 'retention'],
    description: 'Workforce composition, headcount, and attrition analytics',
  },
  {
    // Moved from workforce — operational AI intelligence belongs in the
    // intelligence hub, not alongside the People directory.
    id:          'intelligence',
    label:       'Workforce Intelligence',
    breadcrumbLabel: 'Intelligence',
    route:       '/admin/intelligence',
    icon:        Brain,
    groupId:     'reports-intelligence',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['ai', 'insights', 'risk', 'smart', 'ml', 'workforce risk'],
    description: 'AI-powered workforce risk scores and attendance intelligence',
  },
  {
    // Moved from advanced — Executive Intelligence is a top-level BI capability,
    // not a hidden advanced utility. It belongs alongside operational analytics.
    id:          'executive-intelligence',
    label:       'Executive Intelligence',
    breadcrumbLabel: 'Executive',
    route:       '/admin/analytics/executive',
    icon:        PieChart,
    groupId:     'reports-intelligence',
    section:     'admin',
    permission:  'reports:view',
    keywords:    ['executive', 'C-suite', 'board', 'summary', 'scorecard', 'KPI'],
    description: 'Board-level KPIs and executive workforce scorecard',
  },

  // ════════════════════════════════════════════════════════════════════════════
  // ADVANCED OPERATIONS  ── 4 sub-groups, promoted first-class domain
  //
  // Strategic enterprise oversight: risk scoring, simulations, advanced
  // workforce intelligence, and platform orchestration. Positioned before
  // Configuration — these are operational capabilities, not admin utilities.
  // In nav-config.ts DOMAINS, these live under the 'advanced-ops' domain.
  // ════════════════════════════════════════════════════════════════════════════

  // ── Risk & Governance ────────────────────────────────────────────────────────

  {
    id:          'governance-matrix',
    label:       'Governance Matrix',
    breadcrumbLabel: 'Governance',
    route:       '/admin/approvals/governance-matrix',
    icon:        GitMerge,
    groupId:     'advanced-risk',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['governance matrix', 'approval matrix', 'RACI', 'roles governance'],
    description: 'Multi-module governance matrix and approval authority mapping',
  },
  {
    id:          'event-governance',
    label:       'Event Governance',
    breadcrumbLabel: 'Events',
    route:       '/admin/system/event-governance',
    icon:        Radio,
    groupId:     'advanced-risk',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['event bus', 'event governance', 'pub sub', 'domain events'],
    description: 'Platform domain event governance and routing configuration',
  },
  {
    id:          'attendance-risk',
    label:       'Attendance Risk',
    breadcrumbLabel: 'Risk',
    route:       '/admin/attendance/risk',
    icon:        AlertTriangle,
    groupId:     'advanced-risk',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['risk', 'absenteeism', 'pattern', 'at-risk employees'],
    description: 'Absenteeism risk scoring and early-warning indicators',
  },
  {
    id:          'attendance-confidence',
    label:       'Attendance Confidence',
    breadcrumbLabel: 'Confidence',
    route:       '/admin/attendance/confidence',
    icon:        Target,
    groupId:     'advanced-risk',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['confidence', 'accuracy', 'data quality', 'attendance score'],
    description: 'Per-record confidence scoring for attendance data quality',
  },

  // ── Simulation & Optimization ────────────────────────────────────────────────

  {
    id:          'policy-simulation',
    label:       'Policy Simulation',
    breadcrumbLabel: 'Policy Sim',
    route:       '/admin/attendance/simulate-policy',
    icon:        FlaskConical,
    groupId:     'advanced-simulation',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['simulate', 'policy impact', 'what-if', 'attendance policy'],
    description: 'Model attendance policy changes before deployment',
  },
  {
    id:          'workforce-optimization',
    label:       'Workforce Optimization',
    breadcrumbLabel: 'Optimization',
    route:       '/admin/workforce/optimization',
    icon:        TrendingUp,
    groupId:     'advanced-simulation',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['optimization', 'scheduling', 'workforce planning', 'headcount'],
    description: 'AI-powered workforce scheduling and headcount optimization',
  },

  // ── Advanced Intelligence ────────────────────────────────────────────────────

  {
    id:          'attendance-intelligence-center',
    label:       'Session Intelligence',
    breadcrumbLabel: 'Session Intelligence',
    route:       '/admin/attendance/intelligence-center',
    icon:        Activity,
    groupId:     'advanced-intelligence',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['work session', 'punch pairing', 'cross midnight', 'missing punch', 'session replay', 'ot heatmap', 'payroll lock', 'anomaly', 'attendance state machine', 'temporal ownership'],
    description: 'Punch pairing engine, cross-midnight sessions, anomaly detection, OT heatmap, and payroll locking',
  },
  {
    id:          'health-index',
    label:       'Health Index',
    breadcrumbLabel: 'Health Index',
    route:       '/admin/attendance/health-index',
    icon:        Zap,
    groupId:     'advanced-intelligence',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['health index', 'attendance health', 'team health'],
    description: 'Composite attendance health index by department and team',
  },

  // ── Platform Orchestration ───────────────────────────────────────────────────

  {
    id:              'enterprise-control-center',
    label:           'Enterprise Control Center',
    breadcrumbLabel: 'Control Center',
    route:           '/admin/enterprise',
    icon:            Command,
    groupId:         'advanced-platform',
    section:         'admin',
    permission:      'settings:view',
    keywords:        ['enterprise', 'intelligence', 'governance', 'trust', 'control center', 'admin console', 'compliance', 'security', 'audit'],
    description:     'Unified enterprise intelligence console — governance, trust, operations, security, and audit',
  },
  {
    id:          'orchestration',
    label:       'Orchestration Console',
    breadcrumbLabel: 'Orchestration',
    route:       '/admin/system/orchestration',
    icon:        GitBranch,
    groupId:     'advanced-platform',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['orchestration', 'workflow engine', 'process', 'saga'],
    description: 'Business process orchestration and saga management console',
  },
]

// ── ESS Nav Items ──────────────────────────────────────────────────────────────

export const ESS_NAV_ITEMS: NavItem[] = [
  {
    id:          'ess-attendance',
    label:       'My Attendance',
    route:       '/ess/attendance',
    icon:        Clock,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['attendance', 'check in', 'hours'],
    description: 'View your monthly attendance records',
  },
  // ess-schedule removed from nav — shift info is now shown in the My Attendance heatmap hover
  {
    id:          'ess-leave',
    label:       'My Leave',
    route:       '/ess/leave',
    icon:        CalendarDays,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['leave', 'vacation', 'balance'],
    description: 'View and apply for leave',
  },
  // ess-apply-leave removed from nav — apply leave is now embedded inside Leave Balance page
  // ess-regularization removed from primary nav — regularisation requests are now
  // accessible inline from My Attendance (/ess/attendance).  The page still exists
  // at /ess/attendance/regularization for deep-links and the "View all" action.
  {
    id:          'ess-comp-off',
    label:       'Comp-Off',
    route:       '/ess/comp-off',
    icon:        CalendarCheck,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['comp off', 'compensatory', 'worked holiday'],
    description: 'View and claim compensatory off',
  },
  {
    id:          'ess-payslips',
    label:       'My Payslips',
    route:       '/ess/payroll/my-slips',
    icon:        DollarSign,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['payslip', 'salary', 'pay'],
    description: 'Download your payslips',
  },
  {
    id:          'ess-letters',
    label:       'My Letters',
    route:       '/ess/letters',
    icon:        FileText,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['letter', 'offer', 'experience', 'document'],
    description: 'View and download your HR letters',
  },
  {
    id:          'ess-tax-declarations',
    label:       'Tax Declarations',
    route:       '/ess/declarations',
    icon:        Landmark,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['tax', 'TDS', '80C', 'declaration', 'regime', 'income tax'],
    description: 'Submit tax declarations and manage TDS regime election',
  },
  {
    id:          'ess-tax-planner',
    label:       'Tax Planner',
    route:       '/ess/salary/tax-planner',
    icon:        Calculator,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['tax planner', 'plan', '80C', 'IT planner', 'tax saving', 'regime comparison', 'TDS planner'],
    description: 'Plan and compare tax declarations across multiple scenarios',
  },
  {
    id:          'ess-it-statement',
    label:       'IT Statement',
    route:       '/ess/salary/it-statement',
    icon:        ScrollText,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['IT statement', 'income tax statement', 'annual tax', 'form 16', 'taxable income'],
    description: 'Annual projected income tax computation statement',
  },
  {
    id:          'ess-ytd-statement',
    label:       'YTD Statement',
    route:       '/ess/salary/ytd',
    icon:        ScrollText,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['YTD', 'year to date', 'payroll summary', 'cumulative salary', 'monthly earnings'],
    description: 'Year-to-date payroll earnings and deductions summary',
  },
  {
    id:          'ess-reimbursements',
    label:       'Reimbursements',
    route:       '/ess/reimbursements',
    icon:        Receipt,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['claim', 'expense', 'medical', 'reimbursement'],
    description: 'Submit and track expense reimbursement claims',
  },
  // ess-leave-ledger removed from nav — accrual ledger is now the "Ledger" tab inside /ess/leave/balance
  {
    id:          'ess-optional-holidays',
    label:       'Optional Holidays',
    route:       '/ess/optional-holidays',
    icon:        CalendarCheck,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['optional holiday', 'restricted holiday', 'OHD'],
    description: 'Browse and select your optional holidays',
  },
  {
    id:          'ess-compensation',
    label:       'My Compensation',
    route:       '/ess/compensation',
    icon:        DollarSign,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['salary', 'CTC', 'components', 'payslip breakdown'],
    description: 'View your salary structure and compensation details',
  },
  {
    id:          'ess-profile',
    label:       'My Profile',
    route:       '/ess/profile',
    icon:        UsersIcon,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['profile', 'personal info', 'my details', 'update info'],
    description: 'View and update your employee profile',
  },
]

// ── Utility: find item by route ────────────────────────────────────────────────

export function findNavItem(route: string): NavItem | undefined {
  return [...ADMIN_NAV_ITEMS, ...ESS_NAV_ITEMS].find(
    item => item.route === route
  )
}

/** Build breadcrumb trail from a route path */
export function buildBreadcrumbs(pathname: string): Array<{ label: string; route: string }> {
  const crumbs: Array<{ label: string; route: string }> = []
  const item = [...ADMIN_NAV_ITEMS, ...ESS_NAV_ITEMS].find(
    i => pathname === i.route || pathname.startsWith(i.route + '/')
  )
  if (item) {
    crumbs.push({ label: item.breadcrumbLabel ?? item.label, route: item.route })
  }
  return crumbs
}

/** Returns all nav items for the command palette */
export function getCommandItems(section: 'admin' | 'ess' | 'both'): NavItem[] {
  return [...ADMIN_NAV_ITEMS, ...ESS_NAV_ITEMS].filter(
    item => item.section === section || item.section === 'both'
  )
}
