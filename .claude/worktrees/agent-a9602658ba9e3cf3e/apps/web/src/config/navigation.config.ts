/**
 * navigation.config.ts — Single source of truth for all platform navigation.
 *
 * Consumed by:
 *   · AdminSidebar.tsx        — grouped collapsible nav
 *   · EmployeeSidebar.tsx     — ESS nav
 *   · CommandPalette.tsx      — ⌘K search targets
 *   · Breadcrumbs             — auto-generated trail
 *   · OperationalBanner.tsx   — deep-link hrefs
 *
 * Design rules:
 *   · No inline permission logic — use permission strings only
 *   · No raw hex / bg-gray-* / text-blue-* classes
 *   · Icons imported once here; never duplicated in consumers
 */

import {
  LayoutDashboard, Users, Brain, TrendingUp, LayoutGrid,
  Clock, BarChart2, ClipboardEdit, ClipboardCheck, AlertTriangle,
  FileSearch, Target, Timer,
  AlarmClock, UserCog, CalendarClock, CalendarDays,
  ListChecks, BookOpen, Settings2, GitMerge, CalendarCheck, CalendarPlus,
  GitBranch, ShieldCheck, Zap, BadgeCheck, Lock,
  DollarSign, FileText, Stamp, Bell, BarChart3,
  Building2, Database, Upload, Settings, PlayCircle,
  PieChart, Shield, Users as UsersIcon, Radio,
  Landmark, Receipt, CreditCard, Banknote, TrendingDown,
  Scale, CheckSquare, BookMarked, Inbox,
  Layers, FlaskConical, Search,
  FolderUp, UserPlus, Boxes,
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
}

// ── Admin Groups ───────────────────────────────────────────────────────────────

export const ADMIN_GROUPS: NavGroup[] = [
  {
    id:               'workspaces',
    label:            'Workspaces',
    icon:             Boxes,
    section:          'admin',
    defaultExpanded:  true,
    accentClass:      'bg-primary/[0.05]',
  },
  {
    id:               'workforce',
    label:            'Workforce Operations',
    icon:             Users,
    section:          'admin',
    defaultExpanded:  true,
    accentClass:      'bg-muted/[0.15]',
  },
  {
    id:               'attendance',
    label:            'Attendance Operations',
    icon:             Clock,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },
  {
    id:               'shifts',
    label:            'Shift & Workforce Planning',
    icon:             AlarmClock,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-primary/[0.07]',
  },
  {
    id:               'leave',
    label:            'Leave Operations',
    icon:             CalendarCheck,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },
  {
    id:               'governance',
    label:            'Governance & Compliance',
    icon:             ShieldCheck,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },

  // ── Payroll Workspace — 5 focused groups ─────────────────────────────────────
  {
    id:               'payroll-compensation',
    label:            'Compensation Management',
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
    id:               'payroll-compliance',
    label:            'Compliance & Taxation',
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

  {
    id:               'data-onboarding',
    label:            'Data Onboarding',
    icon:             FolderUp,
    section:          'admin',
    permission:       'employees:edit',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },
  {
    id:               'communications',
    label:            'Communication & Documents',
    icon:             Stamp,
    section:          'admin',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.15]',
  },
  {
    id:               'system',
    label:            'System Administration',
    icon:             Settings,
    section:          'admin',
    permission:       'settings:view',
    defaultExpanded:  false,
    accentClass:      'bg-muted/[0.08]',
  },
]

// ── Admin Nav Items ────────────────────────────────────────────────────────────

export const ADMIN_NAV_ITEMS: NavItem[] = [

  // ── Workspaces ─────────────────────────────────────────────────────────────
  {
    id:          'workspace-workforce',
    label:       'People & Workforce',
    breadcrumbLabel: 'Workforce',
    route:       '/admin/workforce',
    icon:        Users,
    groupId:     'workspaces',
    section:     'admin',
    permission:  'employees:view',
    keywords:    ['people', 'employees', 'onboarding', 'imports', 'workforce hub'],
    description: 'Unified workspace: employees, onboarding, imports, and analytics',
  },
  {
    id:          'workspace-attendance',
    label:       'Attendance Hub',
    breadcrumbLabel: 'Attendance',
    route:       '/admin/attendance-workspace',
    icon:        Clock,
    groupId:     'workspaces',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['attendance workspace', 'muster', 'corrections', 'forensics', 'anomalies'],
    description: 'Unified workspace: processing, corrections, forensics, and intelligence',
  },
  {
    id:          'workspace-payroll',
    label:       'Payroll Hub',
    breadcrumbLabel: 'Payroll',
    route:       '/admin/payroll-workspace',
    icon:        DollarSign,
    groupId:     'workspaces',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['payroll workspace', 'runs', 'compliance', 'reconciliation', 'ledger'],
    description: 'Unified workspace: runs, compliance, reconciliation, and compensation',
  },
  {
    id:          'workspace-operations',
    label:       'Operations Hub',
    breadcrumbLabel: 'Operations',
    route:       '/admin/operations',
    icon:        Zap,
    groupId:     'workspaces',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['operations', 'incidents', 'observability', 'webhooks', 'orchestration', 'inbox'],
    description: 'Unified workspace: inbox, incidents, orchestration, and system health',
  },

  // ── Workforce Operations ────────────────────────────────────────────────────
  {
    id:          'dashboard',
    label:       'Dashboard',
    route:       '/admin/dashboard',
    icon:        LayoutDashboard,
    groupId:     'workforce',
    section:     'admin',
    exact:       true,
    keywords:    ['home', 'overview', 'summary'],
    description: 'Admin overview and key metrics',
  },
  {
    id:          'people',
    label:       'People',
    route:       '/admin/employees',
    icon:        Users,
    groupId:     'workforce',
    section:     'admin',
    permission:  'employees:view',
    keywords:    ['employees', 'staff', 'directory', 'HR'],
    description: 'Employee directory and profiles',
  },
  {
    id:          'manager-dashboard',
    label:       'Manager Dashboard',
    breadcrumbLabel: 'Manager',
    route:       '/admin/manager-dashboard',
    icon:        LayoutGrid,
    groupId:     'workforce',
    section:     'admin',
    permission:  'attendance:view_team',
    keywords:    ['team', 'manager', 'reports', 'direct'],
    description: 'Live team attendance and operational status',
  },
  {
    id:          'workforce-analytics',
    label:       'Workforce Analytics',
    breadcrumbLabel: 'Analytics',
    route:       '/admin/analytics/workforce',
    icon:        TrendingUp,
    groupId:     'workforce',
    section:     'admin',
    permission:  'reports:view',
    keywords:    ['analytics', 'trends', 'stats', 'headcount'],
    description: 'Workforce composition and headcount analytics',
  },
  {
    id:          'intelligence',
    label:       'Intelligence',
    route:       '/admin/intelligence',
    icon:        Brain,
    groupId:     'workforce',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['ai', 'insights', 'risk', 'smart', 'ml'],
    description: 'AI-powered workforce risk and attendance insights',
  },

  // ── Attendance Operations ───────────────────────────────────────────────────
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
    id:          'corrections',
    label:       'Corrections',
    route:       '/admin/attendance/corrections',
    icon:        ClipboardEdit,
    groupId:     'attendance',
    section:     'admin',
    permission:  'corrections:approve',
    badge:       'Corrections',
    keywords:    ['fix', 'punch correction', 'edit attendance', 'approve'],
    description: 'Review and approve attendance correction requests',
  },
  {
    id:          'regularisation',
    label:       'Regularisation',
    route:       '/admin/attendance/regularisation',
    icon:        ClipboardCheck,
    groupId:     'attendance',
    section:     'admin',
    permission:  'corrections:approve',
    keywords:    ['regularize', 'approve', 'missing punch'],
    description: 'Approve employee attendance regularisation requests',
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
    id:          'audit-log',
    label:       'Audit Log',
    breadcrumbLabel: 'Audit',
    route:       '/admin/attendance/audit',
    icon:        FileSearch,
    groupId:     'attendance',
    section:     'admin',
    permission:  'attendance:audit',
    keywords:    ['history', 'changes', 'log', 'who changed'],
    description: 'Full audit trail of all attendance record changes',
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

  // ── Shift & Workforce Planning ──────────────────────────────────────────────
  {
    id:          'shift-definitions',
    label:       'Shift Definitions',
    breadcrumbLabel: 'Shifts',
    route:       '/admin/shift-master',
    icon:        AlarmClock,
    groupId:     'shifts',
    section:     'admin',
    permission:  'shifts:configure',
    keywords:    ['shifts', 'timing', 'schedule', 'define shift'],
    description: 'Create and manage shift definitions',
  },
  {
    id:          'employee-shifts',
    label:       'Employee Shifts',
    route:       '/admin/employee-shifts',
    icon:        UserCog,
    groupId:     'shifts',
    section:     'admin',
    permission:  'shifts:configure',
    keywords:    ['assign shift', 'employee schedule', 'standing shift'],
    description: 'Assign standing shifts to employees',
  },
  {
    id:          'roster-planner',
    label:       'Roster Planner',
    route:       '/admin/roster',
    icon:        CalendarClock,
    groupId:     'shifts',
    section:     'admin',
    permission:  'roster:edit',
    keywords:    ['roster', 'calendar', 'assignment', 'daily shift'],
    description: 'Day-by-day roster assignment planner',
  },
  {
    id:          'roster-templates',
    label:       'Roster Templates',
    route:       '/admin/masters/rosters',
    icon:        CalendarDays,
    groupId:     'shifts',
    section:     'admin',
    permission:  'roster:edit',
    keywords:    ['template', 'pattern', 'preset'],
    description: 'Reusable roster pattern templates',
  },
  {
    id:          'sites',
    label:       'Sites',
    route:       '/admin/masters/sites',
    icon:        Building2,
    groupId:     'shifts',
    section:     'admin',
    permission:  'masters:edit',
    keywords:    ['location', 'office', 'site', 'branch'],
    description: 'Work site and location management',
  },

  // ── Leave Operations ────────────────────────────────────────────────────────
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
    id:          'leave-policies',
    label:       'Leave Policies',
    route:       '/admin/leave-policy',
    icon:        Settings2,
    groupId:     'leave',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['policy', 'rules', 'carry forward', 'encashment'],
    description: 'Leave policy configuration and rules',
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

  // ── Governance & Compliance ─────────────────────────────────────────────────
  {
    id:          'policy-engine',
    label:       'Policy Engine',
    route:       '/admin/leave/policy-engine',
    icon:        GitBranch,
    groupId:     'governance',
    section:     'admin',
    permission:  'leave:configure',
    keywords:    ['policy', 'rules', 'inheritance', 'hierarchy'],
    description: 'Visual leave policy inheritance and rule engine',
  },
  {
    id:          'operational-health',
    label:       'Operational Health',
    route:       '/admin/operational-health',
    icon:        Zap,
    groupId:     'governance',
    section:     'admin',
    permission:  'attendance:view',
    keywords:    ['health', 'status', 'monitoring', 'processing', 'locks'],
    description: 'Platform processing status and operational alerts',
  },
  {
    id:          'attendance-policy',
    label:       'Attendance Policy',
    route:       '/admin/attendance/policy',
    icon:        ShieldCheck,
    groupId:     'governance',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['policy', 'rules', 'attendance config', 'grace period'],
    description: 'Attendance policy configuration and rules',
  },
  {
    id:          'period-locks',
    label:       'Period Locks',
    route:       '/admin/attendance/periods',
    icon:        Lock,
    groupId:     'governance',
    section:     'admin',
    permission:  'attendance:process',
    keywords:    ['lock', 'period', 'close month', 'freeze'],
    description: 'Attendance period locking and freeze management',
  },

  // ── Payroll — Compensation Management ──────────────────────────────────────
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

  // ── Payroll — Payroll Operations ────────────────────────────────────────────
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
    icon:        CheckSquare,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['validate', 'pre-run', 'rules', 'checks', 'reconciliation'],
    description: 'Pre-run validation engine and reconciliation rules',
  },
  {
    id:          'payroll-governance',
    label:       'Freeze & Governance',
    breadcrumbLabel: 'Governance',
    route:       '/admin/payroll/governance',
    icon:        ShieldCheck,
    groupId:     'payroll-operations',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['maker checker', 'freeze', 'variance', 'governance', 'finalize'],
    description: 'Maker-checker controls, payroll freeze, and variance approvals',
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

  // ── Payroll — Compliance & Taxation ────────────────────────────────────────
  {
    id:          'statutory-epf',
    label:       'EPF Management',
    breadcrumbLabel: 'EPF',
    route:       '/admin/payroll/statutory/epf',
    icon:        Landmark,
    groupId:     'payroll-compliance',
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
    groupId:     'payroll-compliance',
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
    groupId:     'payroll-compliance',
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
    groupId:     'payroll-compliance',
    section:     'admin',
    permission:  'payroll:view',
    keywords:    ['TDS', 'income tax', 'tax deduction', '80C', 'declarations'],
    description: 'TDS computation, declarations, and proof management',
  },

  // ── Payroll — Employee Financial Operations ─────────────────────────────────
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

  // ── Payroll — Payroll Intelligence ─────────────────────────────────────────
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
  // ── Data Onboarding ─────────────────────────────────────────────────────────
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

  // ── Communication & Documents ───────────────────────────────────────────────
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

  // ── System Administration ───────────────────────────────────────────────────
  {
    id:          'roles-permissions',
    label:       'Roles & Permissions',
    route:       '/admin/settings/roles',
    icon:        Shield,
    groupId:     'system',
    section:     'admin',
    permission:  'settings:edit',
    keywords:    ['RBAC', 'roles', 'access control', 'permissions', 'users'],
    description: 'Role-based access control and permission governance',
  },
  {
    id:          'users',
    label:       'Users',
    route:       '/admin/settings/users',
    icon:        UsersIcon,
    groupId:     'system',
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
    groupId:     'system',
    section:     'admin',
    permission:  'masters:edit',
    keywords:    ['config', 'setup', 'master data', 'reference data'],
    description: 'Master data configuration for departments, grades, etc.',
  },
  {
    id:          'workflows',
    label:       'Approval Workflows',
    breadcrumbLabel: 'Workflows',
    route:       '/admin/approvals/workflows',
    icon:        GitMerge,
    groupId:     'system',
    section:     'admin',
    permission:  'workflows:configure',
    keywords:    ['workflow', 'approval chain', 'escalation'],
    description: 'Configure multi-level approval workflows',
  },
  {
    id:          'attendance-upload',
    label:       'Attendance Upload',
    route:       '/admin/attendance/upload',
    icon:        Upload,
    groupId:     'system',
    section:     'admin',
    permission:  'attendance:process',
    keywords:    ['CSV', 'bulk upload', 'import', 'raw logs'],
    description: 'Bulk attendance log upload via CSV',
  },
  {
    id:          'settings',
    label:       'Settings',
    route:       '/admin/settings',
    icon:        Settings,
    groupId:     'system',
    section:     'admin',
    exact:       true,
    permission:  'settings:view',
    keywords:    ['configuration', 'preferences', 'tenant'],
    description: 'Platform configuration and tenant settings',
  },
  {
    id:          'reports',
    label:       'Reports',
    route:       '/admin/reports',
    icon:        BarChart3,
    groupId:     'system',
    section:     'admin',
    permission:  'reports:view',
    keywords:    ['export', 'download', 'analytics', 'data export'],
    description: 'Operational reports and data exports',
  },
  {
    id:          'observability',
    label:       'Observability Console',
    breadcrumbLabel: 'Observability',
    route:       '/admin/system/observability',
    icon:        Radio,
    groupId:     'system',
    section:     'admin',
    permission:  'settings:view',
    keywords:    ['event bus', 'job queue', 'metrics', 'platform health', 'dead letter', 'modules'],
    description: 'Live platform event bus, job queue, and module health console',
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
  {
    id:          'ess-schedule',
    label:       'My Schedule',
    route:       '/ess/schedule',
    icon:        CalendarClock,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['shift', 'schedule', 'roster'],
    description: 'Your upcoming shift schedule',
  },
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
  {
    id:          'ess-apply-leave',
    label:       'Apply for Leave',
    route:       '/ess/leave/apply',
    icon:        CalendarPlus,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['apply leave', 'request leave'],
    description: 'Submit a new leave application',
  },
  {
    id:          'ess-corrections',
    label:       'Corrections',
    route:       '/ess/attendance/corrections',
    icon:        ClipboardEdit,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['correction', 'missing punch', 'fix'],
    description: 'Request attendance corrections',
  },
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
    id:          'ess-reimbursements',
    label:       'Reimbursements',
    route:       '/ess/reimbursements',
    icon:        Receipt,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['claim', 'expense', 'medical', 'reimbursement'],
    description: 'Submit and track expense reimbursement claims',
  },
  {
    id:          'ess-leave-ledger',
    label:       'Leave Ledger',
    route:       '/ess/leave/ledger',
    icon:        BookMarked,
    groupId:     'ess-main',
    section:     'ess',
    keywords:    ['leave balance', 'accrual', 'ledger', 'carry forward'],
    description: 'View your leave balance history and accrual ledger',
  },
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
