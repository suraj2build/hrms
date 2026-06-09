import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/lib/api/client'

// ── Layouts ──────────────────────────────────────────────────────────────────
import { AdminShellV2 }  from '@/components/layout/AdminShellV2'  // /admin/* — V2 shell with domain tabs
import { EssShell }      from '@/components/layout/EssShell'      // /ess/*   — all authenticated users
import { ManagerShell }  from '@/components/layout/ManagerShell'  // /manager/* — manager console

// ── Auth pages (always needed, keep eager) ────────────────────────────────────
import { Login }        from '@/pages/auth/Login'
import { Signup }       from '@/pages/auth/Signup'
import { AuthCallback } from '@/pages/auth/AuthCallback'

// ── Dashboard (eager — first page after login) ─────────────────────────────────
import { Dashboard }         from '@/pages/dashboard/Dashboard'
import { EmployeeDashboard } from '@/pages/dashboard/EmployeeDashboard'
import { ManagerDashboardPage }     from '@/pages/dashboard/ManagerDashboard'
import { ManagerTeamPerformance }   from '@/pages/dashboard/ManagerTeamPerformance'

// ── People — eager (frequent navigation targets) ──────────────────────────────
import { EmployeeList }    from '@/pages/employees/EmployeeList'
import { AddEmployee }     from '@/pages/employees/AddEmployee'
import { EmployeeProfile } from '@/pages/employees/EmployeeProfile'
import { ProfilePlatform } from '@/pages/profile/ProfilePlatform'

// ── Core attendance (eager — high-traffic admin views) ────────────────────────
import { Attendance }             from '@/pages/attendance/Attendance'
import { RegularisationApproval } from '@/pages/attendance/RegularisationApproval'
import { ApprovalInbox }          from '@/pages/attendance/ApprovalInbox'
import ManagerRegularisationQueue from '@/pages/admin/attendance/ManagerRegularisationQueue'

// ── ESS (eager — used by every employee daily) ────────────────────────────────
import { MyAttendance }    from '@/pages/attendance/MyAttendance'
import { MyLeaveRequests } from '@/pages/attendance/MyLeaveRequests'
import { LeaveApply }      from '@/pages/attendance/LeaveApply'
import { EssIssues }           from '@/pages/ess/EssIssues'
// EssCorrections retired — replaced by EssRegularization (/ess/attendance/regularization)
import { EssSchedule }         from '@/pages/ess/EssSchedule'
// EssCompOff merged into EssLeaveBalance (/ess/leave/balance → Comp-Off tab)
import { EssOptionalHolidays } from '@/pages/ess/EssOptionalHolidays'
import { EssCompanyHolidays } from '@/pages/ess/EssCompanyHolidays'
import { EssComingSoon }       from '@/pages/ess/EssComingSoon'
import { MyPayslips }          from '@/pages/payroll/MyPayslips'

import type { Profile, Tenant } from '@/types'

// ── Lazy-loaded: heavy admin pages (charts, large grids, complex UIs) ─────────
// Each uses .then(m => ({ default: m.X })) to unwrap named exports.

const Organization      = lazy(() => import('@/pages/organization/Organization').then(m => ({ default: m.Organization })))
const Documents         = lazy(() => import('@/pages/documents/Documents').then(m => ({ default: m.Documents })))
const Reports           = lazy(() => import('@/pages/reports/Reports').then(m => ({ default: m.Reports })))
const ReportingHub      = lazy(() => import('@/pages/reports/ReportingHub').then(m => ({ default: m.ReportingHub })))
const AnalyticsStudio   = lazy(() => import('@/pages/reports/AnalyticsStudio').then(m => ({ default: m.AnalyticsStudio })))

// Import + Onboarding
const ImportWorkspace      = lazy(() => import('@/pages/import/ImportWorkspace').then(m => ({ default: m.ImportWorkspace })))
const OnboardingDashboard  = lazy(() => import('@/pages/onboarding/OnboardingDashboard').then(m => ({ default: m.OnboardingDashboard })))
const OnboardingHub        = lazy(() => import('@/pages/onboarding/OnboardingHub').then(m => ({ default: m.OnboardingHub })))
const HRReviewWorkspace    = lazy(() => import('@/pages/onboarding/HRReviewWorkspace').then(m => ({ default: m.HRReviewWorkspace })))
const OnboardingModule     = lazy(() => import('@/pages/onboarding/OnboardingModule').then(m => ({ default: m.OnboardingModule })))
const PreOnboarding        = lazy(() => import('@/pages/onboarding/PreOnboarding').then(m => ({ default: m.PreOnboarding })))
const PreJoinPortal        = lazy(() => import('@/pages/onboarding/PreJoinPortal').then(m => ({ default: m.PreJoinPortal })))
const SeparationWorkflow   = lazy(() => import('@/pages/employees/SeparationWorkflow').then(m => ({ default: m.SeparationWorkflow })))

const MusterRoll             = lazy(() => import('@/pages/attendance/MusterRoll').then(m => ({ default: m.MusterRoll })))
const AttendanceAudit        = lazy(() => import('@/pages/attendance/AttendanceAudit').then(m => ({ default: m.AttendanceAudit })))
const AttendanceAnomalies    = lazy(() => import('@/pages/attendance/AttendanceAnomalies').then(m => ({ default: m.AttendanceAnomalies })))
const ShiftMaster            = lazy(() => import('@/pages/attendance/ShiftMaster').then(m => ({ default: m.ShiftMaster })))
const EmployeeShifts         = lazy(() => import('@/pages/attendance/EmployeeShifts').then(m => ({ default: m.EmployeeShifts })))
const ShiftRoster            = lazy(() => import('@/pages/attendance/ShiftRoster').then(m => ({ default: m.ShiftRoster })))
const WhoIsIn                = lazy(() => import('@/pages/attendance/WhoIsIn').then(m => ({ default: m.WhoIsIn })))
const AttendanceUpload           = lazy(() => import('@/pages/attendance/AttendanceUpload').then(m => ({ default: m.AttendanceUpload })))
const MusterUpload               = lazy(() => import('@/pages/attendance/MusterUpload').then(m => ({ default: m.MusterUpload })))
const AttendanceUploadWorkspace  = lazy(() => import('@/pages/attendance/AttendanceUploadWorkspace').then(m => ({ default: m.AttendanceUploadWorkspace })))
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
const TeamLeaveBalances   = lazy(() => import('@/pages/manager/TeamLeaveBalances').then(m => ({ default: m.TeamLeaveBalances })))
const CollisionLog        = lazy(() => import('@/pages/attendance/CollisionLog').then(m => ({ default: m.CollisionLog })))
const OptionalHolidayPool = lazy(() => import('@/pages/attendance/OptionalHolidayPool').then(m => ({ default: m.OptionalHolidayPool })))
const LeavePolicyEngine   = lazy(() => import('@/pages/attendance/LeavePolicyEngine').then(m => ({ default: m.LeavePolicyEngine })))
const LeaveGovernanceWorkspace = lazy(() => import('@/pages/leave/LeaveGovernanceWorkspace'))
const AttendanceTimeline  = lazy(() => import('@/pages/attendance/AttendanceTimeline').then(m => ({ default: m.AttendanceTimeline })))
const OperationalHealth   = lazy(() => import('@/pages/attendance/OperationalHealth').then(m => ({ default: m.OperationalHealth })))

// Heavy analytics / intelligence pages — always lazy
const WorkforceAnalytics    = lazy(() => import('@/pages/attendance/WorkforceAnalytics').then(m => ({ default: m.WorkforceAnalytics })))
const WorkforceIntelligence = lazy(() => import('@/pages/attendance/WorkforceIntelligence').then(m => ({ default: m.WorkforceIntelligence })))
const RosterIntelligence    = lazy(() => import('@/pages/attendance/RosterIntelligence').then(m => ({ default: m.RosterIntelligence })))

// Payroll — Recharts-heavy, HR-admin only
const PayrollRuns              = lazy(() => import('@/pages/payroll/PayrollRuns').then(m => ({ default: m.PayrollRuns })))
const PayrollResolutionCenter  = lazy(() => import('@/pages/payroll/PayrollResolutionCenter').then(m => ({ default: m.PayrollResolutionCenter })))
const PayrollInvestigation     = lazy(() => import('@/pages/payroll/PayrollInvestigation').then(m => ({ default: m.PayrollInvestigation })))
const CompensationRevisions    = lazy(() => import('@/pages/payroll/CompensationRevisions').then(m => ({ default: m.CompensationRevisions })))
const PayrollCostIntelligence  = lazy(() => import('@/pages/payroll/PayrollCostIntelligence').then(m => ({ default: m.PayrollCostIntelligence })))
const PayrollForecast          = lazy(() => import('@/pages/payroll/PayrollForecast').then(m => ({ default: m.PayrollForecast })))
const PayrollSimulation        = lazy(() => import('@/pages/payroll/PayrollSimulation').then(m => ({ default: m.PayrollSimulation })))

// ESS compensation
const EssCompensation          = lazy(() => import('@/pages/ess/EssCompensation').then(m => ({ default: m.EssCompensation })))

// ESS profile — employee self-service view (personal info only, no payroll/compensation data)
const EssMyProfile             = lazy(() => import('@/pages/ess/EssMyProfile').then(m => ({ default: m.EssMyProfile })))

// EssRegularization retired — regularization is now Tab 2 ("My Requests") inside MyAttendance (/ess/attendance)

// ESS — new employee-facing pages
const EssApprovals             = lazy(() => import('@/pages/ess/EssApprovals').then(m => ({ default: m.EssApprovals })))
const EssLeaveBalance          = lazy(() => import('@/pages/ess/EssLeaveBalance').then(m => ({ default: m.EssLeaveBalance })))
const EssDocuments             = lazy(() => import('@/pages/ess/EssDocuments').then(m => ({ default: m.EssDocuments })))
const EssTeam                  = lazy(() => import('@/pages/ess/EssTeam').then(m => ({ default: m.EssTeam })))
const EssPolicies              = lazy(() => import('@/pages/ess/EssPolicies').then(m => ({ default: m.EssPolicies })))
const EssHRSupport             = lazy(() => import('@/pages/ess/EssHRSupport').then(m => ({ default: m.EssHRSupport })))
// EssAttendanceCalendar retired — calendar view is embedded inside MyAttendance (/ess/attendance).
// Route /ess/attendance/calendar → Navigate to /ess/attendance (see below).

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
const FilingPackCenter      = lazy(() => import('@/pages/payroll/FilingPackCenter').then(m => ({ default: m.FilingPackCenter })))

// Sprint 12 — Workforce Optimization + Event Governance + Orchestration + Governance Evolution + Incidents + Webhooks + Integrations
const WorkforceOptimizationEngine = lazy(() => import('@/pages/attendance/WorkforceOptimizationEngine').then(m => ({ default: m.WorkforceOptimizationEngine })))
const EventGovernance             = lazy(() => import('@/pages/system/EventGovernance').then(m => ({ default: m.EventGovernance })))
const OrchestrationConsole        = lazy(() => import('@/pages/system/OrchestrationConsole').then(m => ({ default: m.OrchestrationConsole })))
const IncidentManagement          = lazy(() => import('@/pages/system/IncidentManagement').then(m => ({ default: m.IncidentManagement })))
const WebhookManagement           = lazy(() => import('@/pages/system/WebhookManagement').then(m => ({ default: m.WebhookManagement })))
const IntegrationRegistry         = lazy(() => import('@/pages/system/IntegrationRegistry').then(m => ({ default: m.IntegrationRegistry })))
const GovernanceMatrix            = lazy(() => import('@/pages/approvals/GovernanceMatrix').then(m => ({ default: m.GovernanceMatrix })))
const EssOperationalCenter        = lazy(() => import('@/pages/ess/EssOperationalCenter').then(m => ({ default: m.EssOperationalCenter })))

// Operational center pages — standalone fullscreen domain overviews
const AttendanceOperationsCenter  = lazy(() => import('@/pages/attendance/AttendanceOperationsCenter').then(m => ({ default: m.AttendanceOperationsCenter })))
const WorkforceOperationsCenter   = lazy(() => import('@/pages/workforce/WorkforceOperationsCenter').then(m => ({ default: m.WorkforceOperationsCenter })))

// Phase 14 — Enterprise Payroll Operationalization
const PayrollFinalizationCenter    = lazy(() => import('@/pages/payroll/PayrollFinalizationCenter').then(m => ({ default: m.PayrollFinalizationCenter })))
const PayrollVarianceCenter        = lazy(() => import('@/pages/payroll/PayrollVarianceCenter').then(m => ({ default: m.PayrollVarianceCenter })))
const StatutoryReconciliationCenter = lazy(() => import('@/pages/payroll/StatutoryReconciliationCenter').then(m => ({ default: m.StatutoryReconciliationCenter })))
const PayrollPayoutCenter          = lazy(() => import('@/pages/payroll/PayrollPayoutCenter').then(m => ({ default: m.PayrollPayoutCenter })))
const PayrollForensics             = lazy(() => import('@/pages/payroll/PayrollForensics').then(m => ({ default: m.PayrollForensics })))
const PayrollApprovalWorkflow      = lazy(() => import('@/pages/payroll/PayrollApprovalWorkflow').then(m => ({ default: m.PayrollApprovalWorkflow })))
// Phase 15 — Immutable Snapshot & Replay Engine
const PayrollExplainabilityPanel   = lazy(() => import('@/pages/payroll/PayrollExplainabilityPanel').then(m => ({ default: m.PayrollExplainabilityPanel })))
// Payroll Run Console — operational run visibility
const PayrollRunConsole            = lazy(() => import('@/pages/payroll/PayrollRunConsole'))

// Advanced Roster & Weekly-Off Engine

// Phase 16 — Attendance Session Intelligence & Temporal Ownership Engine
const AttendanceIntelligenceCenter = lazy(() => import('@/pages/attendance/AttendanceIntelligenceCenter').then(m => ({ default: m.AttendanceIntelligenceCenter })))

// Phase UX-1 — Consolidated workspace pages
const AttendanceWorkspace = lazy(() => import('@/pages/attendance/AttendanceWorkspace').then(m => ({ default: m.AttendanceWorkspace })))

// Admin Control Center — primary admin home
const ControlCenter            = lazy(() => import('@/pages/admin/ControlCenter').then(m => ({ default: m.ControlCenter })))

// Enterprise Control Center (lazy — admin-only intelligence console)
const EnterpriseControlCenter = lazy(() => import('@/pages/enterprise/EnterpriseControlCenter'))

// Trust & Fabric workspaces (lazy — super_admin platform surfaces)
const TrustWorkspace  = lazy(() => import('@/pages/trust/TrustWorkspace'))
const FabricWorkspace = lazy(() => import('@/pages/fabric/FabricWorkspace'))

// Executive Intelligence Center (lazy — CEO/CHRO strategic read-only intelligence)
const ExecutiveIntelligenceCenter = lazy(() => import('@/pages/executive/ExecutiveIntelligenceCenter'))
const ExecChroView       = lazy(() => import('@/pages/executive/ChroView'))
const ExecWorkforceView  = lazy(() => import('@/pages/executive/WorkforceView'))
const ExecFinancialView  = lazy(() => import('@/pages/executive/FinancialView'))
const ExecComplianceView = lazy(() => import('@/pages/executive/ComplianceView'))
const ExecTrendsView     = lazy(() => import('@/pages/executive/TrendsView'))

// Phase UX-6 — Payroll-First IA
const DailyOperationsWorkspace = lazy(() => import('@/pages/workspace/DailyOperationsWorkspace').then(m => ({ default: m.DailyOperationsWorkspace })))
const PayrollControlCenter     = lazy(() => import('@/pages/payroll/PayrollControlCenter').then(m => ({ default: m.PayrollControlCenter })))
// Phase UX-7 — Queue-Driven Workforce Operations
const MyWorkQueue              = lazy(() => import('@/pages/workspace/MyWorkQueue').then(m => ({ default: m.MyWorkQueue })))

// Phase 16 — Financial Ledger & Accounting Engine
const PayrollAccountingCenter            = lazy(() => import('@/pages/payroll/PayrollAccountingCenter').then(m => ({ default: m.PayrollAccountingCenter })))
const PayrollPayoutReconciliationCenter  = lazy(() => import('@/pages/payroll/PayrollPayoutReconciliationCenter').then(m => ({ default: m.PayrollPayoutReconciliationCenter })))

// Phase 13 — Enterprise Payroll Platform
const SalaryComponents      = lazy(() => import('@/pages/payroll/SalaryComponents').then(m => ({ default: m.SalaryComponents })))
const CompensationMaster    = lazy(() => import('@/pages/payroll/CompensationMaster').then(m => ({ default: m.CompensationMaster })))
const CompensationSetup     = lazy(() => import('@/pages/payroll/CompensationSetup').then(m => ({ default: m.CompensationSetup })))
const FbpReconciliation     = lazy(() => import('@/pages/payroll/FbpReconciliation').then(m => ({ default: m.FbpReconciliation })))
const EssFBP                = lazy(() => import('@/pages/ess/EssFBP').then(m => ({ default: m.EssFBP })))
const PayrollLedger         = lazy(() => import('@/pages/payroll/PayrollLedger').then(m => ({ default: m.PayrollLedger })))
const PayrollGovernance     = lazy(() => import('@/pages/payroll/PayrollGovernance').then(m => ({ default: m.PayrollGovernance })))
const PayrollValidation     = lazy(() => import('@/pages/payroll/PayrollValidation').then(m => ({ default: m.PayrollValidation })))
const LoansAndAdvances      = lazy(() => import('@/pages/payroll/LoansAndAdvances').then(m => ({ default: m.LoansAndAdvances })))
const Reimbursements        = lazy(() => import('@/pages/payroll/Reimbursements').then(m => ({ default: m.Reimbursements })))
const VariablePay           = lazy(() => import('@/pages/payroll/VariablePay').then(m => ({ default: m.VariablePay })))
const ArrearEngine          = lazy(() => import('@/pages/payroll/ArrearEngine').then(m => ({ default: m.ArrearEngine })))
// Statutory
const EPFManagement         = lazy(() => import('@/pages/payroll/statutory/EPFManagement').then(m => ({ default: m.EPFManagement })))
const ESIManagement         = lazy(() => import('@/pages/payroll/statutory/ESIManagement').then(m => ({ default: m.ESIManagement })))
const PTAXManagement        = lazy(() => import('@/pages/payroll/statutory/PTAXManagement').then(m => ({ default: m.PTAXManagement })))
const TDSManagement         = lazy(() => import('@/pages/payroll/statutory/TDSManagement').then(m => ({ default: m.TDSManagement })))
const LWFManagement         = lazy(() => import('@/pages/payroll/statutory/LWFManagement').then(m => ({ default: m.LWFManagement })))
// Notifications
const NotificationTemplates = lazy(() => import('@/pages/notifications/NotificationTemplates').then(m => ({ default: m.NotificationTemplates })))
const OperationalInbox      = lazy(() => import('@/pages/notifications/OperationalInbox').then(m => ({ default: m.OperationalInbox })))
// ESS payroll
const EssReimbursements     = lazy(() => import('@/pages/ess/EssReimbursements').then(m => ({ default: m.EssReimbursements })))

// ESS tax tools (IT Tax Planner, IT Statement, YTD Statement, Phase 2)
const TaxPlanner            = lazy(() => import('@/pages/ess/TaxPlanner').then(m => ({ default: m.TaxPlanner })))
const ITStatement           = lazy(() => import('@/pages/ess/ITStatement').then(m => ({ default: m.ITStatement })))
const YTDStatement          = lazy(() => import('@/pages/ess/YTDStatement').then(m => ({ default: m.YTDStatement })))
const PreviousEmployer      = lazy(() => import('@/pages/ess/PreviousEmployer').then(m => ({ default: m.PreviousEmployer })))
const HRADeclarations       = lazy(() => import('@/pages/ess/HRADeclarations').then(m => ({ default: m.HRADeclarations })))
const TDSRecovery           = lazy(() => import('@/pages/ess/TDSRecovery').then(m => ({ default: m.TDSRecovery })))

// Admin payroll — Tax Governance
const TaxGovernance         = lazy(() => import('@/pages/payroll/TaxGovernance').then(m => ({ default: m.TaxGovernance })))
const TaxGovernanceAdmin    = lazy(() => import('@/pages/payroll/TaxGovernanceAdmin').then(m => ({ default: m.TaxGovernanceAdmin })))

// Readiness Dashboard
const ReadinessDashboard   = lazy(() => import('@/pages/readiness/ReadinessDashboard').then(m => ({ default: m.ReadinessDashboard })))

// Masters / Settings — infrequently accessed
const Sites                = lazy(() => import('@/pages/masters/Sites').then(m => ({ default: m.Sites })))
const WorkLocations        = lazy(() => import('@/pages/masters/WorkLocations').then(m => ({ default: m.WorkLocations })))
const CostCenters          = lazy(() => import('@/pages/masters/CostCenters').then(m => ({ default: m.CostCenters })))
const RosterPolicies       = lazy(() => import('@/pages/masters/RosterPolicies').then(m => ({ default: m.RosterPolicies })))
const RosterPolicyEditor   = lazy(() => import('@/pages/masters/RosterPolicyEditor').then(m => ({ default: m.RosterPolicyEditor })))
const RotationPolicies     = lazy(() => import('@/pages/masters/RotationPolicies'))
const RotationPolicyEditor = lazy(() => import('@/pages/masters/RotationPolicyEditor'))
const Grades               = lazy(() => import('@/pages/masters/Grades').then(m => ({ default: m.Grades })))
const PayrollGroups        = lazy(() => import('@/pages/masters/PayrollGroups').then(m => ({ default: m.PayrollGroups })))
const SalaryStructures     = lazy(() => import('@/pages/masters/SalaryStructures').then(m => ({ default: m.SalaryStructures })))
const EmploymentCategories = lazy(() => import('@/pages/masters/EmploymentCategories').then(m => ({ default: m.EmploymentCategories })))
const StatutoryGroups      = lazy(() => import('@/pages/masters/StatutoryGroups').then(m => ({ default: m.StatutoryGroups })))
const AssetCategories      = lazy(() => import('@/pages/masters/AssetCategories').then(m => ({ default: m.AssetCategories })))
const AssetMaster          = lazy(() => import('@/pages/assets/AssetMaster').then(m => ({ default: m.AssetMaster })))
const AdminComingSoon      = lazy(() => import('@/pages/admin/AdminComingSoon').then(m => ({ default: m.AdminComingSoon })))
// Intelligence — AI Workforce OS Phase 1
const WorkforceCommand     = lazy(() => import('@/pages/intelligence/WorkforceCommand').then(m => ({ default: m.WorkforceCommand })))
const OrgHealth            = lazy(() => import('@/pages/intelligence/OrgHealth').then(m => ({ default: m.OrgHealth })))
const ExecutiveNarrative   = lazy(() => import('@/pages/intelligence/ExecutiveNarrative').then(m => ({ default: m.NarrativesPage })))
const ActionCenter         = lazy(() => import('@/pages/intelligence/ActionCenter').then(m => ({ default: m.ActionCenter })))
const WorkforceDigest      = lazy(() => import('@/pages/intelligence/WorkforceDigest').then(m => ({ default: m.WorkforceDigest })))
const WorkforceSearch      = lazy(() => import('@/pages/intelligence/WorkforceSearch').then(m => ({ default: m.WorkforceSearch })))
const UATCertification     = lazy(() => import('@/pages/intelligence/UATCertification').then(m => ({ default: m.UATCertification })))
// Insights Hub — single front door for all read-only intelligence/analytics surfaces
const InsightsHub          = lazy(() => import('@/pages/insights/InsightsHub').then(m => ({ default: m.InsightsHub })))

const Settings          = lazy(() => import('@/pages/settings/Settings').then(m => ({ default: m.Settings })))
const MastersConfig     = lazy(() => import('@/pages/settings/MastersConfig').then(m => ({ default: m.MastersConfig })))
const ApprovalWorkflows = lazy(() => import('@/pages/settings/ApprovalWorkflows').then(m => ({ default: m.ApprovalWorkflows })))
const RolesPermissions  = lazy(() => import('@/pages/settings/RolesPermissions').then(m => ({ default: m.RolesPermissions })))
const UsersManagement   = lazy(() => import('@/pages/settings/UsersManagement').then(m => ({ default: m.UsersManagement })))

// Letters
const LettersAdmin = lazy(() => import('@/pages/letters/LettersAdmin').then(m => ({ default: m.LettersAdmin })))
const EssLetters   = lazy(() => import('@/pages/letters/EssLetters').then(m => ({ default: m.EssLetters })))

// ── Owner Panel (platform admin — completely separate from tenant app) ─────────
import { OwnerLogin }        from '@/pages/owner/OwnerLogin'
import { OwnerLayout }       from '@/pages/owner/OwnerLayout'
import { OwnerDashboard }    from '@/pages/owner/OwnerDashboard'
import { OwnerTenants }      from '@/pages/owner/OwnerTenants'
import { OwnerTenantDetail } from '@/pages/owner/OwnerTenantDetail'
import { OwnerRequests }     from '@/pages/owner/OwnerRequests'
import { OwnerApiKeys }      from '@/pages/owner/OwnerApiKeys'
import { OwnerBilling }      from '@/pages/owner/OwnerBilling'
import { OwnerAdmins }       from '@/pages/owner/OwnerAdmins'

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
      // ── Refetch governance ──────────────────────────────────────────────
      // refetchOnWindowFocus: false — prevents the single biggest storm source:
      // every tab-switch refetching all active queries. Already set; preserved.
      refetchOnWindowFocus: false,

      // refetchOnReconnect: false — network reconnect would otherwise fire
      // simultaneous refetches for every active polling query on the page.
      // Operational dashboards will catch up on their next poll interval instead.
      refetchOnReconnect: false,

      // staleTime: 30 s global default — data stays fresh for 30 s after fetch.
      // Individual queries override this where needed (faster polling pages use
      // shorter values; slow-changing masters use longer values).
      staleTime: 30_000,

      // retry: 1 — one retry on failure is sufficient. More retries compound
      // storms when a backend endpoint is temporarily unavailable.
      retry: 1,

      // retryDelay: exponential backoff capped at 10 s.
      // Default React Query backoff reaches 30 s; cap at 10 s for operational UX.
      retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 10_000),
    },
    mutations: {
      // Do NOT retry mutations — they are not idempotent by default.
      retry: 0,
    },
  },
})

// ── Auth provider ─────────────────────────────────────────────────────────────

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setProfile, setTenant, setLoading, setAccessToken, setBootstrapping } = useAuthStore()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // ── Silent token refresh ─────────────────────────────────────────────
        // Supabase fires TOKEN_REFRESHED whenever it silently rotates the JWT
        // (e.g. on tab focus after ~1 hour). The profile/tenant are already
        // loaded and have not changed — we only need to store the new token.
        // Do NOT call setLoading(true) here; doing so would cause a full-screen
        // spinner every time the user returns to the browser tab.
        if (event === 'TOKEN_REFRESHED') {
          if (session?.access_token) {
            setAccessToken(session.access_token)
          }
          return
        }

        // ── First bootstrap: initial session check + explicit sign-in ────────
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          if (session?.user) {
            setAccessToken(session.access_token)

            // Owner panel routes handle their own auth — skip tenant /me fetch
            // to avoid 401 spam when the platform owner logs in.
            if (window.location.pathname.startsWith('/owner')) {
              setLoading(false)
              setBootstrapping(false)
              return
            }

            setLoading(true)
            try {
              const data = await api.get<{ profile: Profile; tenant: Tenant }>('/me')
              setProfile(data.profile)
              setTenant(data.tenant)
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Could not load your profile.'
              const is404 = msg.includes('404')
              const isNetworkError = msg.includes('fetch') || msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('502') || msg.includes('503') || msg.includes('500')

              if (isNetworkError) {
                // API is temporarily down (restart/deploy) — do NOT sign out.
                // Keep the session alive and show a retry-friendly message.
                toast.error('Server temporarily unavailable', {
                  description: 'The server is restarting. Please refresh in a few seconds.',
                  action: { label: 'Retry', onClick: () => window.location.reload() },
                })
                // Don't clear auth state — user can retry
              } else {
                // Genuine profile-not-found or auth error — clear session
                setAccessToken(null)
                setProfile(null)
                setTenant(null)
                toast.error('Sign-in failed', {
                  description: is404
                    ? 'Your account profile was not found. Contact your administrator.'
                    : `Unable to sign in. Please try again. (${msg})`,
                })
              }
            } finally {
              setLoading(false)
              setBootstrapping(false)
            }
          } else {
            setAccessToken(null)
            setProfile(null)
            setTenant(null)
            setLoading(false)
            setBootstrapping(false)
          }
        } else if (event === 'SIGNED_OUT') {
          setAccessToken(null)
          setProfile(null)
          setTenant(null)
          setLoading(false)
          setBootstrapping(false)
        }
      },
    )
    return () => subscription.unsubscribe()
  }, [setProfile, setTenant, setLoading, setAccessToken, setBootstrapping])

  return <>{children}</>
}

// ── Role-aware root redirect ──────────────────────────────────────────────────

/**
 * LegacyAdminRedirect — catches any old flat-path route (e.g. /masters/cost-centers)
 * and redirects to its /admin/ equivalent, preserving path + search params.
 * This replaces the old AppShell block entirely.
 */
function LegacyAdminRedirect() {
  const { pathname, search } = useLocation()

  // Guard against infinite /admin/admin/... loops and never hijack public or
  // role-scoped paths. If the path is already under /admin (or a known public
  // / scoped prefix), don't re-prepend — send to the role landing instead.
  const PROTECTED_PREFIXES = ['/admin', '/ess', '/manager', '/owner', '/pre-join', '/login', '/signup', '/auth']
  if (PROTECTED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return <RoleRedirect />
  }
  return <Navigate to={`/admin${pathname}${search}`} replace />
}

function RoleRedirect() {
  const { profile, isBootstrapping } = useAuthStore()

  // Only block on the very first auth resolution — not on silent token refreshes.
  if (isBootstrapping) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!profile) return <Navigate to="/login" replace />

  // Managers get their own dedicated console; hr_admin/super_admin get the admin portal.
  if (profile.role === 'manager')     return <Navigate to="/manager/dashboard" replace />
  if (profile.role === 'employee')    return <Navigate to="/ess/dashboard"      replace />
  return <Navigate to="/admin/dashboard" replace />
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>

              {/* ── Owner Panel (platform admin) ───────────────────────────── */}
              <Route path="/owner/login"   element={<OwnerLogin />} />
              <Route path="/owner" element={<OwnerLayout />}>
                <Route index                element={<Navigate to="/owner/dashboard" replace />} />
                <Route path="dashboard"     element={<OwnerDashboard />} />
                <Route path="tenants"       element={<OwnerTenants />} />
                <Route path="tenants/:id"   element={<OwnerTenantDetail />} />
                <Route path="requests"      element={<OwnerRequests />} />
                <Route path="api-keys"      element={<OwnerApiKeys />} />
                <Route path="billing"       element={<OwnerBilling />} />
                <Route path="admins"        element={<OwnerAdmins />} />
              </Route>

              {/* ── Public ─────────────────────────────────────────────────── */}
              <Route path="/login"         element={<Login />} />
              <Route path="/signup"        element={<Signup />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/pre-join/:token" element={<PreJoinPortal />} />

              {/* ── Admin portal: /admin/* ─────────────────────────────────── */}
              <Route element={<AdminShellV2 />}>

                {/* Control Center — primary admin home */}
                <Route path="/admin/control-center" element={<ControlCenter />} />

                {/* Dashboard — redirects to primary admin home (Control Center) */}
                <Route path="/admin/dashboard" element={<Navigate to="/admin/control-center" replace />} />

                {/* ── Workspace shells consolidated — navigation moved to sidebar ── */}
                {/* Routes preserved as redirects so existing links don't break */}
                <Route path="/admin/workforce"         element={<Navigate to="/admin/employees" replace />} />
                <Route path="/admin/payroll-workspace" element={<Navigate to="/admin/payroll/center" replace />} />
                <Route path="/admin/operations"        element={<Navigate to="/admin/notifications/inbox" replace />} />

                {/* Phase UX-1 — Consolidated workspace pages */}
                <Route path="/admin/attendance-workspace" element={<AttendanceWorkspace />} />
                <Route path="/admin/roster-workspace"     element={<Navigate to="/admin/masters/rosters" replace />} />
                {/* Phase UX-6 — Payroll-First IA */}
                <Route path="/admin/daily-ops"            element={<DailyOperationsWorkspace />} />
                {/* Phase UX-7 — Queue-Driven Workforce Operations */}
                <Route path="/admin/my-work-queue"        element={<MyWorkQueue />} />

                {/* ── Operational center pages ─────────────────────────────────── */}
                <Route path="/admin/workforce/center"  element={<WorkforceOperationsCenter />} />
                <Route path="/admin/attendance/center" element={<AttendanceOperationsCenter />} />
                <Route path="/admin/payroll/center"    element={<PayrollControlCenter />} />

                {/* Readiness */}
                <Route path="/admin/readiness"        element={<ReadinessDashboard />} />

                {/* People */}
                <Route path="/admin/employees"        element={<EmployeeList />} />
                <Route path="/admin/employees/new"    element={<AddEmployee />} />
                <Route path="/admin/employees/:id"    element={<ProfilePlatform />} />
                <Route path="/admin/organization"     element={<Organization />} />
                <Route path="/admin/documents"        element={<Documents />} />

                {/* Data Onboarding */}
                <Route path="/admin/import"                       element={<ImportWorkspace />} />
                <Route path="/admin/onboarding"                   element={<OnboardingHub />} />
                {/* Legacy direct links → unified hub tabs */}
                <Route path="/admin/onboarding/pre-joinee"        element={<Navigate to="/admin/onboarding?tab=invites" replace />} />
                <Route path="/admin/onboarding/:sessionId/review" element={<HRReviewWorkspace />} />
                <Route path="/admin/onboarding/module"            element={<OnboardingModule />} />
                <Route path="/admin/employees/separation"         element={<SeparationWorkflow />} />

                {/* Attendance */}
                <Route path="/admin/attendance"                   element={<Navigate to="/admin/attendance/center" replace />} />
                <Route path="/admin/attendance/muster"            element={<MusterRoll />} />
                <Route path="/admin/attendance/audit"             element={<AttendanceAudit />} />
                <Route path="/admin/attendance/anomalies"         element={<AttendanceAnomalies />} />
                <Route path="/admin/attendance/regularisation"    element={<ManagerRegularisationQueue />} />
                {/* Redirect legacy corrections URL → regularisation */}
                <Route path="/admin/attendance/corrections"       element={<Navigate to="/admin/attendance/regularisation" replace />} />
                <Route path="/admin/attendance/muster-upload"     element={<MusterUpload />} />
                <Route path="/admin/attendance/upload"            element={<Navigate to="/admin/attendance/upload-workspace" replace />} />
                <Route path="/admin/attendance/upload-workspace" element={<AttendanceUploadWorkspace />} />
                <Route path="/admin/attendance/periods"           element={<AttendancePeriods />} />
                <Route path="/admin/attendance/policy"            element={<AttendancePolicy />} />
                <Route path="/admin/attendance/forensics"         element={<AttendanceTimeline />} />
                <Route path="/admin/attendance/who-is-in"        element={<WhoIsIn />} />
                <Route path="/admin/shift-master"                 element={<ShiftMaster />} />
                <Route path="/admin/employee-shifts"              element={<EmployeeShifts />} />
                <Route path="/admin/roster"                       element={<ShiftRoster />} />
                <Route path="/admin/roster/intelligence"          element={<RosterIntelligence />} />
                <Route path="/admin/roster/simulation"            element={<Navigate to="/admin/masters/rosters" replace />} />
                {/* Phase 16 — Attendance Session Intelligence */}
                <Route path="/admin/attendance/intelligence-center" element={<AttendanceIntelligenceCenter />} />

                {/* Reports */}
                <Route path="/admin/reports"             element={<ReportingHub />} />
                <Route path="/admin/reports/analytics"   element={<AnalyticsStudio />} />
                <Route path="/admin/reports/operational" element={<Reports />} />

                {/* Leave (admin) */}
                <Route path="/admin/holidays"                element={<Holidays />} />
                <Route path="/admin/leave-types"             element={<LeaveTypes />} />
                <Route path="/admin/leave-policy"            element={<LeavePolicy />} />
                <Route path="/admin/leave-jobs"              element={<LeaveJobs />} />
                <Route path="/admin/leave/ledger"            element={<LeaveAccrualLedger />} />
                <Route path="/admin/leave/accrual"           element={<LeaveAccrualAdmin />} />
                <Route path="/admin/leave/approvals"         element={<ApprovalInbox />} />
                <Route path="/admin/leave/balances"          element={<LeaveAccrualAdmin />} />
                <Route path="/admin/leave/transactions"      element={<LeaveAccrualLedger />} />
                <Route path="/admin/leave/collision-log"     element={<CollisionLog />} />
                <Route path="/admin/leave/optional-holidays" element={<OptionalHolidayPool />} />
                <Route path="/admin/leave/policy-engine"     element={<LeavePolicyEngine />} />
                <Route path="/admin/leave/governance"        element={<LeaveGovernanceWorkspace />} />
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

                {/* Executive Intelligence — consolidated to the canonical /admin/executive landing */}
                <Route path="/admin/analytics/executive"     element={<Navigate to="/admin/executive" replace />} />

                {/* Governance Evolution (Phase 6) */}
                <Route path="/admin/approvals/governance-matrix" element={<GovernanceMatrix />} />

                {/* System — Event Governance + Orchestration + Incidents + Webhooks + Integrations */}
                <Route path="/admin/system/observability"    element={<ObservabilityConsole />} />
                <Route path="/admin/system/event-governance" element={<EventGovernance />} />
                <Route path="/admin/system/orchestration"    element={<OrchestrationConsole />} />
                <Route path="/admin/enterprise"              element={<EnterpriseControlCenter />} />
                <Route path="/admin/trust"                  element={<TrustWorkspace />} />
                <Route path="/admin/fabric"                 element={<FabricWorkspace />} />
                <Route path="/admin/executive"              element={<ExecutiveIntelligenceCenter />} />
                <Route path="/admin/executive/chro"          element={<ExecChroView />} />
                <Route path="/admin/executive/workforce"     element={<ExecWorkforceView />} />
                <Route path="/admin/executive/financial"     element={<ExecFinancialView />} />
                <Route path="/admin/executive/compliance"    element={<ExecComplianceView />} />
                <Route path="/admin/executive/trends"        element={<ExecTrendsView />} />
                <Route path="/admin/system/automations"      element={<AutomationsConsole />} />
                <Route path="/admin/system/incidents"        element={<IncidentManagement />} />
                <Route path="/admin/system/webhooks"         element={<WebhookManagement />} />
                <Route path="/admin/system/integrations"     element={<IntegrationRegistry />} />

                {/* Payroll */}
                <Route path="/admin/payroll/run-console"              element={<PayrollRunConsole />} />
                <Route path="/admin/payroll"                          element={<PayrollRuns />} />
                <Route path="/admin/payroll/investigate"              element={<PayrollInvestigation />} />
                <Route path="/admin/payroll/compensation-revisions"   element={<CompensationRevisions />} />
                <Route path="/admin/payroll/revisions"               element={<CompensationRevisions />} />
                <Route path="/admin/payroll/cost-intelligence"        element={<PayrollCostIntelligence />} />
                <Route path="/admin/payroll/forecast"                 element={<PayrollForecast />} />
                <Route path="/admin/payroll/simulation"               element={<PayrollSimulation />} />
                {/* Payroll Resolution Center */}
                <Route path="/admin/payroll/blockers/:runId"          element={<PayrollResolutionCenter />} />
                {/* Phase 13 Payroll */}
                {/* Compensation Setup hub — single front door (embeds the surfaces below as tabs) */}
                <Route path="/admin/payroll/setup"                    element={<CompensationSetup />} />
                <Route path="/admin/payroll/salary-components"        element={<SalaryComponents />} />
                <Route path="/admin/payroll/compensation"             element={<CompensationMaster />} />
                <Route path="/admin/payroll/ledger"                   element={<PayrollLedger />} />
                <Route path="/admin/payroll/governance"               element={<PayrollGovernance />} />
                <Route path="/admin/payroll/validation"               element={<PayrollValidation />} />
                <Route path="/admin/payroll/reconciliation"           element={<PayrollReconciliation />} />
                <Route path="/admin/payroll/statutory-dashboard"      element={<StatutoryDashboard />} />
                <Route path="/admin/payroll/filing-pack"             element={<FilingPackCenter />} />
                <Route path="/admin/payroll/advances"                 element={<LoansAndAdvances />} />
                <Route path="/admin/payroll/loans"                    element={<LoansAndAdvances />} />
                <Route path="/admin/payroll/reimbursements"           element={<Reimbursements />} />
                <Route path="/admin/payroll/fbp"                      element={<FbpReconciliation />} />
                <Route path="/admin/payroll/variable-pay"             element={<VariablePay />} />
                <Route path="/admin/payroll/arrears"                  element={<ArrearEngine />} />
                {/* Statutory */}
                <Route path="/admin/payroll/statutory/epf"            element={<EPFManagement />} />
                <Route path="/admin/payroll/statutory/esi"            element={<ESIManagement />} />
                <Route path="/admin/payroll/statutory/ptax"           element={<PTAXManagement />} />
                <Route path="/admin/payroll/statutory/tds"            element={<TDSManagement />} />
                <Route path="/admin/payroll/statutory/lwf"            element={<LWFManagement />} />
                <Route path="/admin/payroll/tax-governance"           element={<TaxGovernance />} />
                <Route path="/admin/payroll/tax-governance-admin"    element={<TaxGovernanceAdmin />} />
                {/* Phase 14 — Enterprise Payroll Operationalization */}
                <Route path="/admin/payroll/finalize"                 element={<PayrollFinalizationCenter />} />
                <Route path="/admin/payroll/variance"                 element={<PayrollVarianceCenter />} />
                <Route path="/admin/payroll/statutory-reconciliation" element={<StatutoryReconciliationCenter />} />
                <Route path="/admin/payroll/payout"                   element={<PayrollPayoutCenter />} />
                <Route path="/admin/payroll/forensics"                element={<PayrollForensics />} />
                <Route path="/admin/payroll/approvals"                element={<PayrollApprovalWorkflow />} />
                {/* Phase 15 — Snapshot & Replay */}
                <Route path="/admin/payroll/runs/:runId/explain"      element={<PayrollExplainabilityPanel />} />
                {/* Phase 16 — Financial Ledger & Accounting Engine */}
                <Route path="/admin/payroll/accounting"               element={<PayrollAccountingCenter />} />
                <Route path="/admin/payroll/payout-reconciliation"    element={<PayrollPayoutReconciliationCenter />} />
                {/* Notifications */}
                <Route path="/admin/notifications/templates"          element={<NotificationTemplates />} />
                <Route path="/admin/notifications/inbox"              element={<OperationalInbox />} />

                <Route path="/admin/approvals/inbox"      element={<ApprovalInbox />} />
                {/* Legacy admin manager-dashboard redirect → proper Manager shell */}
                <Route path="/admin/manager-dashboard"    element={<Navigate to="/manager/dashboard" replace />} />

                {/* Masters sub-pages */}
                {/* Nav items that redirect to nearest relevant section */}
                <Route path="/admin/masters/designations"      element={<Navigate to="/admin/organization" replace />} />
                <Route path="/admin/attendance/groups"         element={<AttendancePolicy />} />
                <Route path="/admin/masters/salary-structures" element={<Navigate to="/admin/payroll/compensation" replace />} />
                <Route path="/admin/masters/sites"                   element={<Sites />} />
                <Route path="/admin/masters/work-locations"          element={<WorkLocations />} />
                <Route path="/admin/masters/cost-centers"            element={<CostCenters />} />
                <Route path="/admin/masters/rosters"                        element={<RosterPolicies />} />
                <Route path="/admin/masters/rosters/:id"                  element={<RosterPolicyEditor />} />
                <Route path="/admin/masters/rotation-policies"            element={<RotationPolicies />} />
                <Route path="/admin/masters/rotation-policies/:id"        element={<RotationPolicyEditor />} />
                <Route path="/admin/masters/grades"                       element={<Grades />} />
                <Route path="/admin/masters/payroll-groups"          element={<PayrollGroups />} />
                <Route path="/admin/masters/employment-categories"   element={<EmploymentCategories />} />
                <Route path="/admin/masters/statutory-groups"        element={<StatutoryGroups />} />
                <Route path="/admin/masters/asset-categories"        element={<AssetCategories />} />
                <Route path="/admin/assets"                          element={<AssetMaster />} />
                <Route path="/admin/recruitment"                     element={<AdminComingSoon />} />
                {/* AI Workforce OS — Intelligence Layer */}
                <Route path="/admin/intelligence/workforce-command"  element={<WorkforceCommand />} />
                <Route path="/admin/intelligence/org-health"        element={<OrgHealth />} />
                <Route path="/admin/intelligence/action-center"     element={<ActionCenter />} />
                <Route path="/admin/intelligence/digest"            element={<WorkforceDigest />} />
                <Route path="/admin/intelligence/search"            element={<WorkforceSearch />} />
                <Route path="/admin/intelligence/uat-certification"  element={<UATCertification />} />
                <Route path="/admin/intelligence/narratives"         element={<ExecutiveNarrative />} />
                <Route path="/admin/insights"                        element={<InsightsHub />} />

                {/* Settings */}
                <Route path="/admin/settings"              element={<Settings />} />
                <Route path="/admin/settings/users"        element={<UsersManagement />} />
                <Route path="/admin/settings/roles"        element={<RolesPermissions />} />
                <Route path="/admin/masters"               element={<MastersConfig />} />
                <Route path="/admin/approvals/workflows"   element={<ApprovalWorkflows />} />

                {/* Letters */}
                <Route path="/admin/letters"               element={<LettersAdmin />} />

              </Route>

              {/* ── Manager console: /manager/* ───────────────────────────── */}
              {/* Accessible by role=manager (their primary workspace).       */}
              {/* hr_admin/super_admin reach manager pages via RoleSwitcher.  */}
              <Route element={<ManagerShell />}>

                <Route path="/manager/dashboard"             element={<ManagerDashboardPage />} />

                {/* My Team */}
                <Route path="/manager/approvals"             element={<ApprovalInbox />} />
                <Route path="/manager/team/roster"           element={<ShiftRoster />} />
                <Route path="/manager/team/attendance"       element={<Attendance />} />
                <Route path="/manager/team/calendar"         element={<ShiftRoster />} />
                <Route path="/manager/team/leave-balances"   element={<TeamLeaveBalances />} />
                <Route path="/manager/team/who-is-in"        element={<WhoIsIn />} />
                <Route path="/manager/team/performance"      element={<ManagerTeamPerformance />} />

                {/* Self Service (legacy paths — kept for backward compat) */}
                <Route path="/manager/my-attendance"         element={<MyAttendance />} />
                <Route path="/manager/leave/apply"           element={<LeaveApply />} />
                <Route path="/manager/payroll/my-slips"      element={<MyPayslips />} />
                <Route path="/manager/reimbursements"        element={<EssReimbursements />} />

                {/* Employee self-service — /manager/self/* stays inside ManagerShell */}
                {/* Prevents shell/sidebar switch when manager clicks Employee section items */}
                <Route path="/manager/self/dashboard"                    element={<EmployeeDashboard />} />
                <Route path="/manager/self/attendance"                   element={<MyAttendance />} />
                <Route path="/manager/self/attendance/regularization"    element={<Navigate to="/manager/self/attendance" replace />} />
                <Route path="/manager/self/leave/balance"                element={<EssLeaveBalance />} />
                <Route path="/manager/self/company-holidays"             element={<EssCompanyHolidays />} />
                <Route path="/manager/self/compensation"                 element={<EssCompensation />} />
                <Route path="/manager/self/declarations"                 element={<Navigate to="/manager/self/salary/tax-planner" replace />} />
                <Route path="/manager/self/reimbursements"               element={<EssReimbursements />} />
                <Route path="/manager/self/documents"                    element={<EssDocuments />} />
                <Route path="/manager/self/letters"                      element={<EssLetters />} />
                <Route path="/manager/self/policies"                     element={<EssPolicies />} />
                <Route path="/manager/self/hr-support"                   element={<EssHRSupport />} />
                {/* Tax tools — rendered inside ManagerShell so sidebar stays amber */}
                <Route path="/manager/self/salary/tax-planner"        element={<TaxPlanner />} />
                <Route path="/manager/self/salary/it-statement"        element={<ITStatement />} />
                <Route path="/manager/self/salary/ytd"                 element={<YTDStatement />} />
                <Route path="/manager/self/salary/previous-employer"   element={<PreviousEmployer />} />
                <Route path="/manager/self/salary/hra"                 element={<HRADeclarations />} />
                <Route path="/manager/self/salary/tds-recovery"        element={<TDSRecovery />} />

                {/* Reports */}
                <Route path="/manager/reports/team"          element={<Reports />} />
                <Route path="/manager/reports/exports"       element={<Reports />} />

              </Route>

              {/* ── ESS portal: /ess/* ─────────────────────────────────────── */}
              <Route element={<EssShell />}>

                <Route path="/ess/dashboard"              element={<EmployeeDashboard />} />
                <Route path="/ess/attendance"             element={<MyAttendance />} />
                {/* Regularization merged into MyAttendance — redirect old deep-link */}
                <Route path="/ess/attendance/regularization" element={<Navigate to="/ess/attendance" replace />} />
                {/* Redirect legacy /corrections URL → new /regularization */}
                <Route path="/ess/attendance/corrections"    element={<Navigate to="/ess/attendance/regularization" replace />} />
                <Route path="/ess/schedule"               element={<EssSchedule />} />
                <Route path="/ess/leave"                  element={<MyLeaveRequests />} />
                <Route path="/ess/leave/apply"            element={<LeaveApply />} />
                {/* /ess/leave/ledger merged into /ess/leave/balance (Ledger tab) */}
                <Route path="/ess/leave/ledger"           element={<Navigate to="/ess/leave/balance" replace />} />
                {/* /ess/comp-off merged into /ess/leave/balance (Comp-Off tab) */}
                <Route path="/ess/comp-off"               element={<Navigate to="/ess/leave/balance" replace />} />
                <Route path="/ess/issues"                 element={<EssIssues />} />
                <Route path="/ess/optional-holidays"      element={<EssOptionalHolidays />} />
                <Route path="/ess/company-holidays"       element={<EssCompanyHolidays />} />
                {/* /ess/payroll/my-slips merged into /ess/compensation (Pay Slips tab) */}
                <Route path="/ess/payroll/my-slips"        element={<Navigate to="/ess/compensation" replace />} />
                <Route path="/ess/compensation"            element={<EssCompensation />} />
                <Route path="/ess/fbp"                     element={<EssFBP />} />
                <Route path="/ess/profile"                element={<EssMyProfile />} />
                <Route path="/ess/letters"                element={<EssLetters />} />
                <Route path="/ess/operational-center"     element={<EssOperationalCenter />} />
                <Route path="/ess/declarations"           element={<Navigate to="/ess/salary/tax-planner" replace />} />
                <Route path="/ess/salary/tax-planner"         element={<TaxPlanner />} />
                <Route path="/ess/salary/it-statement"        element={<ITStatement />} />
                <Route path="/ess/salary/ytd"                 element={<YTDStatement />} />
                <Route path="/ess/salary/previous-employer"   element={<PreviousEmployer />} />
                <Route path="/ess/salary/hra"                 element={<HRADeclarations />} />
                <Route path="/ess/salary/tds-recovery"        element={<TDSRecovery />} />
                <Route path="/ess/reimbursements"         element={<EssReimbursements />} />
                <Route path="/ess/approvals"              element={<EssApprovals />} />
                <Route path="/ess/leave/balance"          element={<EssLeaveBalance />} />
                <Route path="/ess/documents"              element={<EssDocuments />} />
                <Route path="/ess/team"                   element={<EssTeam />} />
                <Route path="/ess/policies"               element={<EssPolicies />} />
                <Route path="/ess/hr-support"             element={<EssHRSupport />} />
                {/* Attendance Calendar retired — redirect to unified My Attendance workspace */}
                <Route path="/ess/attendance/calendar"    element={<Navigate to="/ess/attendance" replace />} />

                {/* Catch-all for planned-but-not-yet-built ESS features */}
                <Route path="/ess/*"                      element={<EssComingSoon />} />

              </Route>

              {/* ── Legacy flat routes (backward-compat for internal Links) ── */}
              {/*   These keep existing <Link to="/employees/..."> etc. working. */}
              {/* ── Legacy flat routes → redirect to /admin/* (V2 shell) ─────── */}
              {/* ESS-specific old paths redirect to ESS shell instead          */}
              <Route path="/my-attendance"     element={<Navigate to="/ess/attendance"        replace />} />
              <Route path="/leave/apply"       element={<Navigate to="/ess/leave/apply"        replace />} />
              <Route path="/leave/my-requests" element={<Navigate to="/ess/leave/my-requests" replace />} />
              <Route path="/my-profile"        element={<Navigate to="/ess/profile"           replace />} />
              <Route path="/ess/compensation"  element={<Navigate to="/ess/payroll/my-slips"  replace />} />
              <Route path="/manager-dashboard" element={<Navigate to="/manager/dashboard"     replace />} />
              {/* All other legacy paths: prepend /admin/ and land in V2 shell */}
              <Route path="/*" element={<LegacyAdminRedirect />} />

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
