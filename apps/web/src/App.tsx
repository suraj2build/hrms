import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/lib/api/client'

// ── Layouts ──────────────────────────────────────────────────────────────────
import { AppShell }    from '@/components/layout/AppShell'      // legacy flat routes
import { AdminShellV2 } from '@/components/layout/AdminShellV2' // /admin/* — V2 shell with domain tabs
import { EssShell }    from '@/components/layout/EssShell'      // /ess/*   — all authenticated users

// ── Auth pages (always needed, keep eager) ────────────────────────────────────
import { Login }        from '@/pages/auth/Login'
import { Signup }       from '@/pages/auth/Signup'
import { AuthCallback } from '@/pages/auth/AuthCallback'

// ── Dashboard (eager — first page after login) ─────────────────────────────────
import { Dashboard }         from '@/pages/dashboard/Dashboard'
import { EmployeeDashboard } from '@/pages/dashboard/EmployeeDashboard'

// ── People — eager (frequent navigation targets) ──────────────────────────────
import { EmployeeList }    from '@/pages/employees/EmployeeList'
import { AddEmployee }     from '@/pages/employees/AddEmployee'
import { EmployeeProfile } from '@/pages/employees/EmployeeProfile'

// ── Core attendance (eager — high-traffic admin views) ────────────────────────
import { Attendance }             from '@/pages/attendance/Attendance'
import { RegularisationApproval } from '@/pages/attendance/RegularisationApproval'
import { ApprovalInbox }          from '@/pages/attendance/ApprovalInbox'
import { ManagerDashboard }       from '@/pages/attendance/ManagerDashboard'

// ── ESS (eager — used by every employee daily) ────────────────────────────────
import { MyAttendance }    from '@/pages/attendance/MyAttendance'
import { MyLeaveRequests } from '@/pages/attendance/MyLeaveRequests'
import { LeaveApply }      from '@/pages/attendance/LeaveApply'
import { EssIssues }           from '@/pages/ess/EssIssues'
import { EssCorrections }      from '@/pages/ess/EssCorrections'
import { EssSchedule }         from '@/pages/ess/EssSchedule'
import { EssCompOff }          from '@/pages/ess/EssCompOff'
import { EssOptionalHolidays } from '@/pages/ess/EssOptionalHolidays'
import { EssComingSoon }       from '@/pages/ess/EssComingSoon'
import { MyPayslips }          from '@/pages/payroll/MyPayslips'

import type { Profile, Tenant, UserRole } from '@/types'

// ── Lazy-loaded: heavy admin pages (charts, large grids, complex UIs) ─────────
// Each uses .then(m => ({ default: m.X })) to unwrap named exports.

const Organization      = lazy(() => import('@/pages/organization/Organization').then(m => ({ default: m.Organization })))
const Documents         = lazy(() => import('@/pages/documents/Documents').then(m => ({ default: m.Documents })))
const Reports           = lazy(() => import('@/pages/reports/Reports').then(m => ({ default: m.Reports })))

// Import + Onboarding
const ImportWorkspace      = lazy(() => import('@/pages/import/ImportWorkspace').then(m => ({ default: m.ImportWorkspace })))
const OnboardingDashboard  = lazy(() => import('@/pages/onboarding/OnboardingDashboard').then(m => ({ default: m.OnboardingDashboard })))
const HRReviewWorkspace    = lazy(() => import('@/pages/onboarding/HRReviewWorkspace').then(m => ({ default: m.HRReviewWorkspace })))

const MusterRoll             = lazy(() => import('@/pages/attendance/MusterRoll').then(m => ({ default: m.MusterRoll })))
const AttendanceAudit        = lazy(() => import('@/pages/attendance/AttendanceAudit').then(m => ({ default: m.AttendanceAudit })))
const AttendanceAnomalies    = lazy(() => import('@/pages/attendance/AttendanceAnomalies').then(m => ({ default: m.AttendanceAnomalies })))
const AttendanceCorrections  = lazy(() => import('@/pages/attendance/AttendanceCorrections').then(m => ({ default: m.AttendanceCorrections })))
const ShiftMaster            = lazy(() => import('@/pages/attendance/ShiftMaster').then(m => ({ default: m.ShiftMaster })))
const EmployeeShifts         = lazy(() => import('@/pages/attendance/EmployeeShifts').then(m => ({ default: m.EmployeeShifts })))
const ShiftRoster            = lazy(() => import('@/pages/attendance/ShiftRoster').then(m => ({ default: m.ShiftRoster })))
const AttendanceUpload       = lazy(() => import('@/pages/attendance/AttendanceUpload').then(m => ({ default: m.AttendanceUpload })))
const AttendancePeriods      = lazy(() => import('@/pages/attendance/AttendancePeriods').then(m => ({ default: m.AttendancePeriods })))

const Holidays            = lazy(() => import('@/pages/attendance/Holidays').then(m => ({ default: m.Holidays })))
const LeaveTypes          = lazy(() => import('@/pages/attendance/LeaveTypes').then(m => ({ default: m.LeaveTypes })))
const LeavePolicy         = lazy(() => import('@/pages/attendance/LeavePolicy').then(m => ({ default: m.LeavePolicy })))
const LeaveJobs           = lazy(() => import('@/pages/attendance/LeaveJobs').then(m => ({ default: m.LeaveJobs })))
const LeaveAccrualLedger  = lazy(() => import('@/pages/attendance/LeaveAccrualLedger').then(m => ({ default: m.LeaveAccrualLedger })))
const AttendancePolicy    = lazy(() => import('@/pages/attendance/AttendancePolicy').then(m => ({ default: m.AttendancePolicy })))
const CompOff             = lazy(() => import('@/pages/attendance/CompOff').then(m => ({ default: m.CompOff })))
const OvertimeManagement  = lazy(() => import('@/pages/attendance/OvertimeManagement').then(m => ({ default: m.OvertimeManagement })))
const PayrollReadiness    = lazy(() => import('@/pages/attendance/PayrollReadiness').then(m => ({ default: m.PayrollReadiness })))
const LeaveAccrualAdmin   = lazy(() => import('@/pages/attendance/LeaveAccrualAdmin').then(m => ({ default: m.LeaveAccrualAdmin })))
const CollisionLog        = lazy(() => import('@/pages/attendance/CollisionLog').then(m => ({ default: m.CollisionLog })))
const OptionalHolidayPool = lazy(() => import('@/pages/attendance/OptionalHolidayPool').then(m => ({ default: m.OptionalHolidayPool })))
const LeavePolicyEngine   = lazy(() => import('@/pages/attendance/LeavePolicyEngine').then(m => ({ default: m.LeavePolicyEngine })))
const AttendanceTimeline  = lazy(() => import('@/pages/attendance/AttendanceTimeline').then(m => ({ default: m.AttendanceTimeline })))
const OperationalHealth   = lazy(() => import('@/pages/attendance/OperationalHealth').then(m => ({ default: m.OperationalHealth })))

// Heavy analytics / intelligence pages — always lazy
const WorkforceAnalytics    = lazy(() => import('@/pages/attendance/WorkforceAnalytics').then(m => ({ default: m.WorkforceAnalytics })))
const WorkforceIntelligence = lazy(() => import('@/pages/attendance/WorkforceIntelligence').then(m => ({ default: m.WorkforceIntelligence })))
const RosterIntelligence    = lazy(() => import('@/pages/attendance/RosterIntelligence').then(m => ({ default: m.RosterIntelligence })))

// Payroll — Recharts-heavy, HR-admin only
const PayrollRuns              = lazy(() => import('@/pages/payroll/PayrollRuns').then(m => ({ default: m.PayrollRuns })))
const PayrollInvestigation     = lazy(() => import('@/pages/payroll/PayrollInvestigation').then(m => ({ default: m.PayrollInvestigation })))
const CompensationRevisions    = lazy(() => import('@/pages/payroll/CompensationRevisions').then(m => ({ default: m.CompensationRevisions })))
const PayrollCostIntelligence  = lazy(() => import('@/pages/payroll/PayrollCostIntelligence').then(m => ({ default: m.PayrollCostIntelligence })))
const PayrollForecast          = lazy(() => import('@/pages/payroll/PayrollForecast').then(m => ({ default: m.PayrollForecast })))
const PayrollSimulation        = lazy(() => import('@/pages/payroll/PayrollSimulation').then(m => ({ default: m.PayrollSimulation })))

// ESS compensation
const EssCompensation          = lazy(() => import('@/pages/ess/EssCompensation').then(m => ({ default: m.EssCompensation })))

// ESS — new employee-facing pages
const EssApprovals             = lazy(() => import('@/pages/ess/EssApprovals').then(m => ({ default: m.EssApprovals })))
const EssLeaveBalance          = lazy(() => import('@/pages/ess/EssLeaveBalance').then(m => ({ default: m.EssLeaveBalance })))
const EssDocuments             = lazy(() => import('@/pages/ess/EssDocuments').then(m => ({ default: m.EssDocuments })))
const EssTeam                  = lazy(() => import('@/pages/ess/EssTeam').then(m => ({ default: m.EssTeam })))
const EssPolicies              = lazy(() => import('@/pages/ess/EssPolicies').then(m => ({ default: m.EssPolicies })))
const EssHRSupport             = lazy(() => import('@/pages/ess/EssHRSupport').then(m => ({ default: m.EssHRSupport })))
const EssAttendanceCalendar    = lazy(() => import('@/pages/ess/EssAttendanceCalendar').then(m => ({ default: m.EssAttendanceCalendar })))

// ── Attendance Intelligence (Phase 11) — admin-only, heavy data views ─────────
const ExceptionGovernance  = lazy(() => import('@/pages/attendance/ExceptionGovernance').then(m => ({ default: m.ExceptionGovernance })))
const AttendanceConfidence = lazy(() => import('@/pages/attendance/AttendanceConfidence').then(m => ({ default: m.AttendanceConfidence })))
const AttendanceRisk       = lazy(() => import('@/pages/attendance/AttendanceRisk').then(m => ({ default: m.AttendanceRisk })))
const HealthIndex          = lazy(() => import('@/pages/attendance/HealthIndex').then(m => ({ default: m.HealthIndex })))
const PolicyConflicts      = lazy(() => import('@/pages/attendance/PolicyConflicts').then(m => ({ default: m.PolicyConflicts })))
const PolicySimulation     = lazy(() => import('@/pages/attendance/PolicySimulation').then(m => ({ default: m.PolicySimulation })))

// System observability — admin only, data-heavy tables
const ObservabilityConsole = lazy(() => import('@/pages/system/ObservabilityConsole').then(m => ({ default: m.ObservabilityConsole })))
const AutomationsConsole   = lazy(() => import('@/pages/system/AutomationsConsole').then(m => ({ default: m.AutomationsConsole })))

// Payroll pages previously only accessible as workspace tabs
const PayrollReconciliation = lazy(() => import('@/pages/payroll/PayrollReconciliation').then(m => ({ default: m.PayrollReconciliation })))
const StatutoryDashboard    = lazy(() => import('@/pages/payroll/StatutoryDashboard').then(m => ({ default: m.StatutoryDashboard })))

// Sprint 12 — Workforce Optimization + Event Governance + Orchestration + Governance Evolution + Incidents + Webhooks + Integrations
const WorkforceOptimizationEngine = lazy(() => import('@/pages/attendance/WorkforceOptimizationEngine').then(m => ({ default: m.WorkforceOptimizationEngine })))
const ExecutiveIntelligence       = lazy(() => import('@/pages/analytics/ExecutiveIntelligence').then(m => ({ default: m.ExecutiveIntelligence })))
const EventGovernance             = lazy(() => import('@/pages/system/EventGovernance').then(m => ({ default: m.EventGovernance })))
const OrchestrationConsole        = lazy(() => import('@/pages/system/OrchestrationConsole').then(m => ({ default: m.OrchestrationConsole })))
const IncidentManagement          = lazy(() => import('@/pages/system/IncidentManagement').then(m => ({ default: m.IncidentManagement })))
const WebhookManagement           = lazy(() => import('@/pages/system/WebhookManagement').then(m => ({ default: m.WebhookManagement })))
const IntegrationRegistry         = lazy(() => import('@/pages/system/IntegrationRegistry').then(m => ({ default: m.IntegrationRegistry })))
const GovernanceMatrix            = lazy(() => import('@/pages/approvals/GovernanceMatrix').then(m => ({ default: m.GovernanceMatrix })))
const EssOperationalCenter        = lazy(() => import('@/pages/ess/EssOperationalCenter').then(m => ({ default: m.EssOperationalCenter })))

// Operational center pages — standalone fullscreen domain overviews
const AttendanceOperationsCenter  = lazy(() => import('@/pages/attendance/AttendanceOperationsCenter').then(m => ({ default: m.AttendanceOperationsCenter })))
const PayrollOperationsCenter     = lazy(() => import('@/pages/payroll/PayrollOperationsCenter').then(m => ({ default: m.PayrollOperationsCenter })))
const WorkforceOperationsCenter   = lazy(() => import('@/pages/workforce/WorkforceOperationsCenter').then(m => ({ default: m.WorkforceOperationsCenter })))

// Phase 13 — Enterprise Payroll Platform
const SalaryComponents      = lazy(() => import('@/pages/payroll/SalaryComponents').then(m => ({ default: m.SalaryComponents })))
const CompensationMaster    = lazy(() => import('@/pages/payroll/CompensationMaster').then(m => ({ default: m.CompensationMaster })))
const PayrollLedger         = lazy(() => import('@/pages/payroll/PayrollLedger').then(m => ({ default: m.PayrollLedger })))
const PayrollGovernance     = lazy(() => import('@/pages/payroll/PayrollGovernance').then(m => ({ default: m.PayrollGovernance })))
const PayrollValidation     = lazy(() => import('@/pages/payroll/PayrollValidation').then(m => ({ default: m.PayrollValidation })))
const AdvanceSalary         = lazy(() => import('@/pages/payroll/AdvanceSalary').then(m => ({ default: m.AdvanceSalary })))
const LoanManagement        = lazy(() => import('@/pages/payroll/LoanManagement').then(m => ({ default: m.LoanManagement })))
const Reimbursements        = lazy(() => import('@/pages/payroll/Reimbursements').then(m => ({ default: m.Reimbursements })))
const VariablePay           = lazy(() => import('@/pages/payroll/VariablePay').then(m => ({ default: m.VariablePay })))
const ArrearEngine          = lazy(() => import('@/pages/payroll/ArrearEngine').then(m => ({ default: m.ArrearEngine })))
// Statutory
const EPFManagement         = lazy(() => import('@/pages/payroll/statutory/EPFManagement').then(m => ({ default: m.EPFManagement })))
const ESIManagement         = lazy(() => import('@/pages/payroll/statutory/ESIManagement').then(m => ({ default: m.ESIManagement })))
const PTAXManagement        = lazy(() => import('@/pages/payroll/statutory/PTAXManagement').then(m => ({ default: m.PTAXManagement })))
const TDSManagement         = lazy(() => import('@/pages/payroll/statutory/TDSManagement').then(m => ({ default: m.TDSManagement })))
// Notifications
const NotificationTemplates = lazy(() => import('@/pages/notifications/NotificationTemplates').then(m => ({ default: m.NotificationTemplates })))
const OperationalInbox      = lazy(() => import('@/pages/notifications/OperationalInbox').then(m => ({ default: m.OperationalInbox })))
// ESS payroll
const TaxDeclarations       = lazy(() => import('@/pages/ess/TaxDeclarations').then(m => ({ default: m.TaxDeclarations })))
const EssReimbursements     = lazy(() => import('@/pages/ess/EssReimbursements').then(m => ({ default: m.EssReimbursements })))

// Masters / Settings — infrequently accessed
const Sites   = lazy(() => import('@/pages/masters/Sites').then(m => ({ default: m.Sites })))
const Rosters = lazy(() => import('@/pages/masters/Rosters').then(m => ({ default: m.Rosters })))

const Settings          = lazy(() => import('@/pages/settings/Settings').then(m => ({ default: m.Settings })))
const MastersConfig     = lazy(() => import('@/pages/settings/MastersConfig').then(m => ({ default: m.MastersConfig })))
const ApprovalWorkflows = lazy(() => import('@/pages/settings/ApprovalWorkflows').then(m => ({ default: m.ApprovalWorkflows })))
const RolesPermissions  = lazy(() => import('@/pages/settings/RolesPermissions').then(m => ({ default: m.RolesPermissions })))

// Letters
const LettersAdmin = lazy(() => import('@/pages/letters/LettersAdmin').then(m => ({ default: m.LettersAdmin })))
const EssLetters   = lazy(() => import('@/pages/letters/EssLetters').then(m => ({ default: m.EssLetters })))

// ── Page loading fallback ─────────────────────────────────────────────────────

/**
 * Minimal full-page spinner shown while a lazy chunk is loading.
 * Keeps the shell chrome visible so the app feels responsive.
 */
function PageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

// ── React Query client ────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

// ── Auth provider ─────────────────────────────────────────────────────────────

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setProfile, setTenant, setLoading, setAccessToken } = useAuthStore()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (
          event === 'SIGNED_IN' ||
          event === 'INITIAL_SESSION' ||
          event === 'TOKEN_REFRESHED'
        ) {
          if (session?.user) {
            setAccessToken(session.access_token)
            setLoading(true)
            try {
              const data = await api.get<{ profile: Profile; tenant: Tenant }>('/me')
              setProfile(data.profile)
              setTenant(data.tenant)
            } catch {
              // /me failed — profile not found or API down; clear auth state
              setAccessToken(null)
              setProfile(null)
              setTenant(null)
            } finally {
              setLoading(false)
            }
          } else {
            setAccessToken(null)
            setProfile(null)
            setTenant(null)
            setLoading(false)
          }
        } else if (event === 'SIGNED_OUT') {
          setAccessToken(null)
          setProfile(null)
          setTenant(null)
          setLoading(false)
        }
      },
    )
    return () => subscription.unsubscribe()
  }, [setProfile, setTenant, setLoading, setAccessToken])

  return <>{children}</>
}

// ── Role-aware root redirect ──────────────────────────────────────────────────

const ADMIN_ROLES: UserRole[] = ['super_admin', 'hr_admin', 'manager']

function RoleRedirect() {
  const { profile, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!profile) return <Navigate to="/login" replace />

  return ADMIN_ROLES.includes(profile.role)
    ? <Navigate to="/admin/dashboard" replace />
    : <Navigate to="/ess/dashboard"   replace />
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>

              {/* ── Public ─────────────────────────────────────────────────── */}
              <Route path="/login"         element={<Login />} />
              <Route path="/signup"        element={<Signup />} />
              <Route path="/auth/callback" element={<AuthCallback />} />

              {/* ── Admin portal: /admin/* ─────────────────────────────────── */}
              <Route element={<AdminShellV2 />}>

                {/* Dashboard */}
                <Route path="/admin/dashboard" element={<Dashboard />} />

                {/* ── Workspace shells consolidated — navigation moved to sidebar ── */}
                {/* Routes preserved as redirects so existing links don't break */}
                <Route path="/admin/workforce"            element={<Navigate to="/admin/employees" replace />} />
                <Route path="/admin/attendance-workspace" element={<Navigate to="/admin/attendance/center" replace />} />
                <Route path="/admin/payroll-workspace"    element={<Navigate to="/admin/payroll/center" replace />} />
                <Route path="/admin/operations"           element={<Navigate to="/admin/notifications/inbox" replace />} />

                {/* ── Operational center pages ─────────────────────────────────── */}
                <Route path="/admin/workforce/center"  element={<WorkforceOperationsCenter />} />
                <Route path="/admin/attendance/center" element={<AttendanceOperationsCenter />} />
                <Route path="/admin/payroll/center"    element={<PayrollOperationsCenter />} />

                {/* People */}
                <Route path="/admin/employees"        element={<EmployeeList />} />
                <Route path="/admin/employees/new"    element={<AddEmployee />} />
                <Route path="/admin/employees/:id"    element={<EmployeeProfile />} />
                <Route path="/admin/organization"     element={<Organization />} />
                <Route path="/admin/documents"        element={<Documents />} />

                {/* Data Onboarding */}
                <Route path="/admin/import"                       element={<ImportWorkspace />} />
                <Route path="/admin/onboarding"                   element={<OnboardingDashboard />} />
                <Route path="/admin/onboarding/:sessionId/review" element={<HRReviewWorkspace />} />

                {/* Attendance */}
                <Route path="/admin/attendance"                   element={<Attendance />} />
                <Route path="/admin/attendance/muster"            element={<MusterRoll />} />
                <Route path="/admin/attendance/audit"             element={<AttendanceAudit />} />
                <Route path="/admin/attendance/anomalies"         element={<AttendanceAnomalies />} />
                <Route path="/admin/attendance/regularisation"    element={<RegularisationApproval />} />
                <Route path="/admin/attendance/corrections"       element={<AttendanceCorrections />} />
                <Route path="/admin/attendance/upload"            element={<AttendanceUpload />} />
                <Route path="/admin/attendance/periods"           element={<AttendancePeriods />} />
                <Route path="/admin/attendance/policy"            element={<AttendancePolicy />} />
                <Route path="/admin/attendance/forensics"         element={<AttendanceTimeline />} />
                <Route path="/admin/shift-master"                 element={<ShiftMaster />} />
                <Route path="/admin/employee-shifts"              element={<EmployeeShifts />} />
                <Route path="/admin/roster"                       element={<ShiftRoster />} />
                <Route path="/admin/roster/intelligence"          element={<RosterIntelligence />} />

                {/* Reports */}
                <Route path="/admin/reports" element={<Reports />} />

                {/* Leave (admin) */}
                <Route path="/admin/holidays"                element={<Holidays />} />
                <Route path="/admin/leave-types"             element={<LeaveTypes />} />
                <Route path="/admin/leave-policy"            element={<LeavePolicy />} />
                <Route path="/admin/leave-jobs"              element={<LeaveJobs />} />
                <Route path="/admin/leave/ledger"            element={<LeaveAccrualLedger />} />
                <Route path="/admin/leave/accrual"           element={<LeaveAccrualAdmin />} />
                <Route path="/admin/leave/collision-log"     element={<CollisionLog />} />
                <Route path="/admin/leave/optional-holidays" element={<OptionalHolidayPool />} />
                <Route path="/admin/leave/policy-engine"     element={<LeavePolicyEngine />} />
                <Route path="/admin/comp-off"                element={<CompOff />} />
                <Route path="/admin/overtime"                element={<OvertimeManagement />} />
                <Route path="/admin/payroll-readiness"       element={<PayrollReadiness />} />
                <Route path="/admin/analytics/workforce"     element={<WorkforceAnalytics />} />
                <Route path="/admin/intelligence"            element={<WorkforceIntelligence />} />
                <Route path="/admin/operational-health"      element={<OperationalHealth />} />

                {/* Attendance Intelligence (Phase 11) */}
                <Route path="/admin/attendance/exceptions"     element={<ExceptionGovernance />} />
                <Route path="/admin/attendance/confidence"     element={<AttendanceConfidence />} />
                <Route path="/admin/attendance/risk"           element={<AttendanceRisk />} />
                <Route path="/admin/attendance/health-index"   element={<HealthIndex />} />
                <Route path="/admin/attendance/policy-conflicts" element={<PolicyConflicts />} />
                <Route path="/admin/attendance/simulate-policy"  element={<PolicySimulation />} />

                {/* Workforce Optimization Engine (Phase 1) */}
                <Route path="/admin/workforce/optimization"  element={<WorkforceOptimizationEngine />} />

                {/* Executive Intelligence (Phase 2) */}
                <Route path="/admin/analytics/executive"     element={<ExecutiveIntelligence />} />

                {/* Governance Evolution (Phase 6) */}
                <Route path="/admin/approvals/governance-matrix" element={<GovernanceMatrix />} />

                {/* System — Event Governance + Orchestration + Incidents + Webhooks + Integrations */}
                <Route path="/admin/system/observability"    element={<ObservabilityConsole />} />
                <Route path="/admin/system/event-governance" element={<EventGovernance />} />
                <Route path="/admin/system/orchestration"    element={<OrchestrationConsole />} />
                <Route path="/admin/system/automations"      element={<AutomationsConsole />} />
                <Route path="/admin/system/incidents"        element={<IncidentManagement />} />
                <Route path="/admin/system/webhooks"         element={<WebhookManagement />} />
                <Route path="/admin/system/integrations"     element={<IntegrationRegistry />} />

                {/* Payroll */}
                <Route path="/admin/payroll"                          element={<PayrollRuns />} />
                <Route path="/admin/payroll/investigate"              element={<PayrollInvestigation />} />
                <Route path="/admin/payroll/compensation-revisions"   element={<CompensationRevisions />} />
                <Route path="/admin/payroll/cost-intelligence"        element={<PayrollCostIntelligence />} />
                <Route path="/admin/payroll/forecast"                 element={<PayrollForecast />} />
                <Route path="/admin/payroll/simulation"               element={<PayrollSimulation />} />
                {/* Phase 13 Payroll */}
                <Route path="/admin/payroll/salary-components"        element={<SalaryComponents />} />
                <Route path="/admin/payroll/compensation"             element={<CompensationMaster />} />
                <Route path="/admin/payroll/ledger"                   element={<PayrollLedger />} />
                <Route path="/admin/payroll/governance"               element={<PayrollGovernance />} />
                <Route path="/admin/payroll/validation"               element={<PayrollValidation />} />
                <Route path="/admin/payroll/reconciliation"           element={<PayrollReconciliation />} />
                <Route path="/admin/payroll/statutory-dashboard"      element={<StatutoryDashboard />} />
                <Route path="/admin/payroll/advances"                 element={<AdvanceSalary />} />
                <Route path="/admin/payroll/loans"                    element={<LoanManagement />} />
                <Route path="/admin/payroll/reimbursements"           element={<Reimbursements />} />
                <Route path="/admin/payroll/variable-pay"             element={<VariablePay />} />
                <Route path="/admin/payroll/arrears"                  element={<ArrearEngine />} />
                {/* Statutory */}
                <Route path="/admin/payroll/statutory/epf"            element={<EPFManagement />} />
                <Route path="/admin/payroll/statutory/esi"            element={<ESIManagement />} />
                <Route path="/admin/payroll/statutory/ptax"           element={<PTAXManagement />} />
                <Route path="/admin/payroll/statutory/tds"            element={<TDSManagement />} />
                {/* Notifications */}
                <Route path="/admin/notifications/templates"          element={<NotificationTemplates />} />
                <Route path="/admin/notifications/inbox"              element={<OperationalInbox />} />

                <Route path="/admin/approvals/inbox"      element={<ApprovalInbox />} />
                <Route path="/admin/manager-dashboard"    element={<ManagerDashboard />} />

                {/* Masters sub-pages */}
                <Route path="/admin/masters/sites"         element={<Sites />} />
                <Route path="/admin/masters/rosters"       element={<Rosters />} />

                {/* Settings */}
                <Route path="/admin/settings"              element={<Settings />} />
                <Route path="/admin/settings/users"        element={<Settings />} />
                <Route path="/admin/settings/roles"        element={<RolesPermissions />} />
                <Route path="/admin/masters"               element={<MastersConfig />} />
                <Route path="/admin/approvals/workflows"   element={<ApprovalWorkflows />} />

                {/* Letters */}
                <Route path="/admin/letters"               element={<LettersAdmin />} />

              </Route>

              {/* ── ESS portal: /ess/* ─────────────────────────────────────── */}
              <Route element={<EssShell />}>

                <Route path="/ess/dashboard"              element={<EmployeeDashboard />} />
                <Route path="/ess/attendance"             element={<MyAttendance />} />
                <Route path="/ess/attendance/corrections" element={<EssCorrections />} />
                <Route path="/ess/schedule"               element={<EssSchedule />} />
                <Route path="/ess/leave"                  element={<MyLeaveRequests />} />
                <Route path="/ess/leave/apply"            element={<LeaveApply />} />
                <Route path="/ess/leave/ledger"           element={<LeaveAccrualLedger />} />
                <Route path="/ess/comp-off"               element={<EssCompOff />} />
                <Route path="/ess/issues"                 element={<EssIssues />} />
                <Route path="/ess/optional-holidays"      element={<EssOptionalHolidays />} />
                <Route path="/ess/payroll/my-slips"        element={<MyPayslips />} />
                <Route path="/ess/compensation"            element={<EssCompensation />} />
                <Route path="/ess/profile"                element={<EmployeeProfile />} />
                <Route path="/ess/letters"                element={<EssLetters />} />
                <Route path="/ess/operational-center"     element={<EssOperationalCenter />} />
                <Route path="/ess/declarations"           element={<TaxDeclarations />} />
                <Route path="/ess/reimbursements"         element={<EssReimbursements />} />
                <Route path="/ess/approvals"              element={<EssApprovals />} />
                <Route path="/ess/leave/balance"          element={<EssLeaveBalance />} />
                <Route path="/ess/documents"              element={<EssDocuments />} />
                <Route path="/ess/team"                   element={<EssTeam />} />
                <Route path="/ess/policies"               element={<EssPolicies />} />
                <Route path="/ess/hr-support"             element={<EssHRSupport />} />
                <Route path="/ess/attendance/calendar"    element={<EssAttendanceCalendar />} />

                {/* Catch-all for planned-but-not-yet-built ESS features */}
                <Route path="/ess/*"                      element={<EssComingSoon />} />

              </Route>

              {/* ── Legacy flat routes (backward-compat for internal Links) ── */}
              {/*   These keep existing <Link to="/employees/..."> etc. working. */}
              {/*   New code should use /admin/* or /ess/* paths.               */}
              <Route element={<AppShell />}>
                <Route path="/dashboard"                       element={<Dashboard />} />
                <Route path="/employees"                       element={<EmployeeList />} />
                <Route path="/employees/new"                   element={<AddEmployee />} />
                <Route path="/employees/:id"                   element={<EmployeeProfile />} />
                <Route path="/organization"                    element={<Organization />} />
                <Route path="/documents"                       element={<Documents />} />
                <Route path="/attendance"                      element={<Attendance />} />
                <Route path="/attendance/regularisation"       element={<RegularisationApproval />} />
                <Route path="/attendance/corrections"          element={<AttendanceCorrections />} />
                <Route path="/attendance/upload"               element={<AttendanceUpload />} />
                <Route path="/attendance/periods"              element={<AttendancePeriods />} />
                <Route path="/shift-master"                    element={<ShiftMaster />} />
                <Route path="/employee-shifts"                 element={<EmployeeShifts />} />
                <Route path="/roster"                          element={<ShiftRoster />} />
                <Route path="/roster/intelligence"             element={<RosterIntelligence />} />
                <Route path="/leave-types"                     element={<LeaveTypes />} />
                <Route path="/leave-policy"                    element={<LeavePolicy />} />
                <Route path="/leave-jobs"                      element={<LeaveJobs />} />
                <Route path="/attendance/policy"               element={<AttendancePolicy />} />
                <Route path="/comp-off"                        element={<CompOff />} />
                <Route path="/attendance/muster"               element={<MusterRoll />} />
                <Route path="/attendance/audit"                element={<AttendanceAudit />} />
                <Route path="/attendance/anomalies"            element={<AttendanceAnomalies />} />
                <Route path="/my-attendance"                   element={<MyAttendance />} />
                <Route path="/approvals/inbox"                 element={<ApprovalInbox />} />
                <Route path="/leave/apply"                     element={<LeaveApply />} />
                <Route path="/leave/my-requests"               element={<MyLeaveRequests />} />
                <Route path="/leave/ledger"                    element={<LeaveAccrualLedger />} />
                <Route path="/leave/accrual"                   element={<LeaveAccrualAdmin />} />
                <Route path="/leave/collision-log"             element={<CollisionLog />} />
                <Route path="/leave/optional-holidays"         element={<OptionalHolidayPool />} />
                <Route path="/leave/policy-engine"             element={<LeavePolicyEngine />} />
                <Route path="/attendance/forensics"            element={<AttendanceTimeline />} />
                <Route path="/operational-health"              element={<OperationalHealth />} />
                <Route path="/overtime"                        element={<OvertimeManagement />} />
                <Route path="/payroll"                           element={<PayrollRuns />} />
                <Route path="/payroll/investigate"             element={<PayrollInvestigation />} />
                <Route path="/payroll/compensation-revisions"  element={<CompensationRevisions />} />
                <Route path="/payroll/cost-intelligence"       element={<PayrollCostIntelligence />} />
                <Route path="/payroll/forecast"                element={<PayrollForecast />} />
                <Route path="/payroll/simulation"              element={<PayrollSimulation />} />
                <Route path="/ess/compensation"                element={<EssCompensation />} />
                <Route path="/payroll-readiness"               element={<PayrollReadiness />} />
                <Route path="/analytics/workforce"             element={<WorkforceAnalytics />} />
                <Route path="/intelligence"                    element={<WorkforceIntelligence />} />
                <Route path="/manager-dashboard"               element={<ManagerDashboard />} />
                <Route path="/reports"                         element={<Reports />} />
                <Route path="/holidays"                        element={<Holidays />} />
                <Route path="/settings"                        element={<Settings />} />
                <Route path="/settings/roles"                  element={<RolesPermissions />} />
                <Route path="/masters"                         element={<MastersConfig />} />
                <Route path="/masters/sites"                   element={<Sites />} />
                <Route path="/masters/rosters"                 element={<Rosters />} />
                <Route path="/approvals/workflows"             element={<ApprovalWorkflows />} />
                <Route path="/my-profile"                      element={<EmployeeProfile />} />
              </Route>

              {/* ── Root + catch-all: redirect by role ─────────────────────── */}
              <Route path="/"  element={<RoleRedirect />} />
              <Route path="*"  element={<RoleRedirect />} />

            </Routes>
          </Suspense>
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
