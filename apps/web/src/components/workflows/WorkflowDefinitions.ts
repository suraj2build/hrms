import {
  AlarmClock,
  CalendarClock,
  CheckSquare,
  Clock,
  ClipboardCheck,
  AlertTriangle,
  Lock,
  DollarSign,
  TrendingDown,
  FileText,
} from 'lucide-react'
import type { WorkflowStep } from './GuidedWorkflowFlow'

// ─── Shift → Roster → Attendance activation workflow ────────────────────────

export const CREATE_SHIFT_WORKFLOW: {
  id: string
  title: string
  description: string
  steps: WorkflowStep[]
} = {
  id: 'create-shift-workflow',
  title: 'Set Up Shift Scheduling',
  description:
    'Complete these steps to configure shifts, assign rosters, and activate attendance tracking.',
  steps: [
    {
      id: 'define-shift',
      title: 'Define Shift',
      description:
        'Create shift timings for your organization (morning, evening, night, etc.)',
      status: 'pending',
      route: '/admin/shift-master',
      ctaLabel: 'Go to Shifts',
      icon: AlarmClock,
    },
    {
      id: 'configure-roster-policy',
      title: 'Configure Roster Policy',
      description: 'Set weekly-off patterns per site — determines whether employees work on each day',
      status: 'pending',
      route: '/admin/masters/rosters',
      ctaLabel: 'Roster Policies',
      icon: CalendarClock,
      prerequisite: ['define-shift'],
    },
    {
      id: 'configure-rotation-policy',
      title: 'Configure Rotation Policy',
      description: 'Map working conditions (weekday/Saturday/Sunday) to specific shifts per site',
      status: 'pending',
      route: '/admin/masters/rotation-policies',
      ctaLabel: 'Rotation Policies',
      icon: CalendarClock,
      prerequisite: ['configure-roster-policy'],
    },
    {
      id: 'activate-attendance',
      title: 'Activate Attendance',
      description: 'Assign governance policies to sites and begin collecting attendance punches',
      status: 'pending',
      route: '/admin/attendance',
      ctaLabel: 'Activate',
      icon: Clock,
      prerequisite: ['configure-rotation-policy'],
    },
  ],
}

// ─── Run Payroll workflow ────────────────────────────────────────────────────

export const RUN_PAYROLL_WORKFLOW: {
  id: string
  title: string
  description: string
  steps: WorkflowStep[]
} = {
  id: 'run-payroll-workflow',
  title: 'Run Monthly Payroll',
  description: 'Follow this checklist to run payroll accurately and on time.',
  steps: [
    {
      id: 'validate-attendance',
      title: 'Validate Attendance',
      description: 'Ensure all attendance records are complete and approved',
      status: 'pending',
      route: '/admin/payroll-readiness',
      ctaLabel: 'Check Readiness',
      icon: ClipboardCheck,
    },
    {
      id: 'resolve-anomalies',
      title: 'Resolve Anomalies',
      description: 'Fix any attendance anomalies before processing payroll',
      status: 'pending',
      route: '/admin/attendance/anomalies',
      ctaLabel: 'Fix Anomalies',
      icon: AlertTriangle,
      prerequisite: ['validate-attendance'],
    },
    {
      id: 'lock-attendance',
      title: 'Lock Attendance Period',
      description: 'Freeze attendance for the payroll period',
      status: 'pending',
      route: '/admin/attendance/periods',
      ctaLabel: 'Lock Period',
      icon: Lock,
      prerequisite: ['resolve-anomalies'],
    },
    {
      id: 'run-payroll',
      title: 'Run Payroll',
      description: 'Process salary calculations for all employees',
      status: 'pending',
      route: '/admin/payroll',
      ctaLabel: 'Run Payroll',
      icon: DollarSign,
      prerequisite: ['lock-attendance'],
    },
    {
      id: 'review-variance',
      title: 'Review Variance',
      description: 'Check month-over-month variance for anomalies',
      status: 'pending',
      route: '/admin/payroll/variance',
      ctaLabel: 'Review',
      icon: TrendingDown,
      prerequisite: ['run-payroll'],
    },
    {
      id: 'approve-payroll',
      title: 'Approve & Finalize',
      description: 'Complete maker-checker approval and lock payroll',
      status: 'pending',
      route: '/admin/payroll/approvals',
      ctaLabel: 'Approve',
      icon: CheckSquare,
      prerequisite: ['review-variance'],
    },
    {
      id: 'publish-payslips',
      title: 'Publish Payslips',
      description: 'Release payslips to employees via ESS portal',
      status: 'pending',
      route: '/admin/payroll/payout',
      ctaLabel: 'Publish',
      icon: FileText,
      prerequisite: ['approve-payroll'],
    },
  ],
}
