import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

// Plugins
import supabasePlugin    from './plugins/supabase.js'
import authPlugin        from './plugins/auth.js'
import correlationPlugin from './plugins/correlation.js'

// Event handlers — register once at startup so notification handlers are wired
// before the first HTTP request arrives.
import { registerNotificationHandlers } from './lib/notification-service.js'
import { registerAnomalyHandlers }       from './lib/anomaly-handler.js'
import { registerLeaveScheduler }        from './lib/leave-scheduler.js'
import { registerEventBusAutomation }    from './lib/event-bus-automation.js'
import { registerSlaScanner }            from './lib/sla-scanner.js'
import { registerIntelligenceScanner }   from './lib/intelligence-scanner.js'
import { jobQueue }                      from './lib/job-queue.js'
import { eventBus }                      from './lib/event-bus.js'
registerNotificationHandlers()
// Note: registerAnomalyHandlers(supabase) is called below inside start(), AFTER
// the supabase plugin is registered, because it needs the Supabase client.

// Routes — Sprint 1
import employeeOptionsRoute from './routes/employees/options.js'
import employeeRoutes from './routes/employees/index.js'
import orgRoutes from './routes/departments/index.js'
import documentRoutes from './routes/documents/index.js'
import analyticsRoutes              from './routes/analytics/index.js'
import reportsRoutes                from './routes/analytics/reports.js'
import workforceIntelligenceRoutes  from './routes/analytics/workforce-intelligence.js'
import workforceDrillRoutes         from './routes/analytics/workforce-drill.js'
import rosterIntelligenceRoutes     from './routes/analytics/roster-intelligence.js'

// Routes — Sprint 2: Masters
import mastersRoutes from './routes/masters/index.js'

// Routes — Sprint 2: Employee Modules
import personalInfoRoutes      from './routes/employees/personal-info.js'
import bankStatutoryRoutes     from './routes/employees/bank-statutory.js'
import previousEmploymentRoutes from './routes/employees/previous-employment.js'
import identityRoutes          from './routes/employees/identity.js'
import contractsRoutes         from './routes/employees/contracts.js'
import familyRoutes            from './routes/employees/family.js'
import nominationsRoutes       from './routes/employees/nominations.js'
import emergencyContactsRoutes from './routes/employees/emergency-contacts.js'
import addressesRoutes         from './routes/employees/addresses.js'
import separationRoutes        from './routes/employees/separation.js'
import accessCardsRoutes       from './routes/employees/access-cards.js'
import jobHistoryRoutes        from './routes/employees/job-history.js'
import compensationRoutes      from './routes/employees/compensation.js'
import fullProfileRoute        from './routes/employees/full-profile.js'
import fullCreateRoute         from './routes/employees/full-create.js'
import passportVisaRoutes      from './routes/employees/passport-visa.js'
import employeeDocumentsRoutes from './routes/employees/employee-documents.js'
import employeeManagerRoutes   from './routes/employees/manager.js'
import employeeOrgContextRoutes from './routes/employees/org-context.js'

// Routes — Attendance
import attendanceIngestRoute          from './routes/attendance/ingest.js'
import attendanceProcessRoute         from './routes/attendance/process.js'
import attendanceFetchRoute           from './routes/attendance/fetch.js'
import attendanceStatusRoute          from './routes/attendance/status.js'
import attendanceLastRunRoute         from './routes/attendance/last-run.js'
import attendanceRunExportRoute       from './routes/attendance/run-export.js'
import attendanceRunDetailsRoute      from './routes/attendance/run-details.js'
import attendanceRegularisationRoute  from './routes/attendance/regularisation.js'
import attendanceLeaveRoute           from './routes/attendance/leave.js'
import attendanceMusterRoute          from './routes/attendance/muster.js'
import attendanceRosterRoute          from './routes/attendance/roster-api.js'
import attendanceAuditRoute           from './routes/attendance/audit.js'
import attendancePayrollSummaryRoute  from './routes/attendance/payroll-summary.js'
import leaveRequestsRoute             from './routes/attendance/leave-requests.js'
import leaveEmployeeRoute             from './routes/attendance/leave-employee.js'
import attendanceRecomputeRoute       from './routes/attendance/recompute.js'
import attendancePunchRoute           from './routes/attendance/punch.js'
import attendanceAnomaliesRoute       from './routes/attendance/anomalies.js'
import attendanceSampleCsvRoute       from './routes/attendance/sample-csv.js'
import attendanceUploadRoute          from './routes/attendance/upload.js'
import leaveEntitlementRoute          from './routes/attendance/leave-entitlement.js'
import leaveJobsRoute                 from './routes/attendance/leave-jobs.js'
import managerDashboardRoute          from './routes/attendance/manager-dashboard.js'
import attendanceCorrectionsRoute     from './routes/attendance/corrections.js'
import approvalWorkflowsRoute         from './routes/approvals/workflows.js'
import leavePolicyResolveRoute        from './routes/attendance/leave-policy-resolve.js'
import compOffRoute                   from './routes/attendance/comp-off.js'
import overtimeRoutes                 from './routes/attendance/overtime.js'
import leaveCollisionRoutes               from './routes/attendance/leave-collision.js'
import notificationsRoutes                from './routes/notifications/index.js'
import periodLocksRoutes                  from './routes/attendance/period-locks.js'
import regularisationPolicyRoutes         from './routes/attendance/regularisation-policy.js'
import leaveAccrualRoutes                 from './routes/attendance/leave-accrual.js'
import attendanceIntelligenceRoute        from './routes/attendance/intelligence.js'
import attendanceForensicsRoute          from './routes/attendance/forensics.js'

// Routes — Attendance Intelligence (Phase 11)
import attendanceExceptionsRoute         from './routes/attendance/exceptions.js'
import attendanceConfidenceRoute         from './routes/attendance/confidence.js'
import attendanceInferenceRoute          from './routes/attendance/inference.js'
import attendancePolicyConflictsRoute    from './routes/attendance/policy-conflicts.js'
import attendanceRetroactiveRoute        from './routes/attendance/retroactive.js'
import attendanceRiskRoute               from './routes/attendance/risk.js'
import attendanceHealthIndexRoute        from './routes/attendance/health-index.js'
import attendanceSimulatePolicyRoute     from './routes/attendance/simulate-policy.js'
import attendanceTimelineIntelligenceRoute from './routes/attendance/timeline-intelligence.js'

// Routes — Payroll
import payrollRoutes                       from './routes/payroll/index.js'
import payrollInvestigateRoute             from './routes/payroll/investigate.js'
import payrollLedgerRoute                  from './routes/payroll/ledger.js'
import payrollCostRoute                    from './routes/payroll/cost.js'
import payrollForecastRoute                from './routes/payroll/forecast.js'
import payrollSimulateRoute                from './routes/payroll/simulate.js'

// Routes — Compensation Intelligence
import compensationRevisionsRoute          from './routes/compensation/revisions.js'

// Routes — Letter Generation
import lettersRoutes                       from './routes/letters/index.js'

// Routes — Universal Master Import Framework
import importRoutes                        from './routes/import/index.js'
import onboardingSessionRoutes             from './routes/onboarding/sessions.js'
import onboardingDraftRoutes               from './routes/onboarding/drafts.js'
import onboardingDashboardRoute            from './routes/onboarding/dashboard.js'

// Routes — System health + observability
import healthRoutes                        from './routes/system/health.js'
import jobQueueRoutes                      from './routes/system/jobs.js'

// Routes — Phase 13: Enterprise Payroll Platform
import payrollCompensationMasterRoute      from './routes/payroll/compensation-master.js'
import payrollCompensationRevisionsRoute   from './routes/payroll/compensation-revisions.js'
import payrollStatutoryEpfRoute            from './routes/payroll/statutory/epf.js'
import payrollStatutoryEsiRoute            from './routes/payroll/statutory/esi.js'
import payrollStatutoryPtaxRoute           from './routes/payroll/statutory/ptax.js'
import payrollStatutoryTdsRoute            from './routes/payroll/statutory/tds.js'
import payrollAdvancesRoute                from './routes/payroll/advances.js'
import payrollLoansRoute                   from './routes/payroll/loans.js'
import payrollReimbursementsRoute          from './routes/payroll/reimbursements.js'
import payrollVariablePayRoute             from './routes/payroll/variable-pay.js'
import payrollArrearsRoute                 from './routes/payroll/arrears.js'
import payrollGovernanceRoute              from './routes/payroll/governance.js'
import payrollValidationRoute              from './routes/payroll/validation.js'
import notificationTemplatesRoute          from './routes/notifications/templates.js'
import notificationInboxRoute              from './routes/notifications/inbox.js'

// Routes — Workspace aggregated stats (command headers + intelligence panels)
import workspaceStatsRoutes                from './routes/workspace/stats.js'

// Routes — Sprint 12: Workforce Optimization + Event Governance + Orchestration + Governance Evolution + Incidents + Webhooks + Integrations + ESS Operational + Executive Intelligence
import workforceOptimizationRoute          from './routes/attendance/workforce-optimization.js'
import eventGovernanceRoute                from './routes/system/event-governance.js'
import orchestrationRoute                  from './routes/system/orchestration.js'
import incidentsRoute                      from './routes/system/incidents.js'
import webhooksRoute                       from './routes/system/webhooks.js'
import integrationsRoute                   from './routes/system/integrations.js'
import governanceEvolutionRoute            from './routes/approvals/governance-evolution.js'
import executiveIntelligenceRoute          from './routes/analytics/executive-intelligence.js'
import essOperationalRoute                 from './routes/notifications/ess-operational.js'

// Routes — Public (no JWT required)
import setupRoute from './routes/setup.js'

// Platform health + startup checks
import { startupHealthChecks, safeRegisterModule } from './lib/startup-health.js'

const fastify = Fastify({
  logger: process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : true,
})

async function start() {
  // Security
  await fastify.register(helmet, { global: true })
  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? [process.env.WEB_URL ?? 'https://app.hrms.in']
      : ['http://localhost:2000'],
    credentials: true,
  })
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: 'RATE_LIMIT', message: 'Too many requests' }),
  })

  // Plugins
  await fastify.register(supabasePlugin)

  // ── Correlation ID / request tracing (must be before auth so logs carry ID) ─
  await fastify.register(correlationPlugin)

  // ── Wire loggers into in-process infrastructure ──────────────────────────────
  jobQueue.setLogger(fastify.log as any)
  eventBus.setLogger(fastify.log as any)

  // ── Startup health checks — run before serving any traffic ────────────────
  // Required checks (env-vars, database, auth) will process.exit(1) if they fail.
  // Optional module checks degrade gracefully and disable the module.
  await startupHealthChecks(fastify.supabase, fastify.log)

  // Anomaly handler — optional module, isolated from critical path
  await safeRegisterModule('anomaly-handler', async () => {
    registerAnomalyHandlers(fastify.supabase)
  }, fastify.log)

  // Phase 2 event bus automation subscribers — SLA monitoring, balance alerts,
  // escalation logging, coverage gap handling, payroll observability
  await safeRegisterModule('event-bus-automation', async () => {
    registerEventBusAutomation(fastify.supabase)
  }, fastify.log)

  // Leave scheduler — optional module, isolated from critical path
  await safeRegisterModule('leave-scheduler', async () => {
    registerLeaveScheduler(fastify.supabase)
  }, fastify.log)

  // SLA scanner — proactively checks for overdue leave/correction requests every 4 hours
  await safeRegisterModule('sla-scanner', async () => {
    registerSlaScanner(fastify.supabase)
  }, fastify.log)

  // Intelligence scanner — emits Phase 4 operational events every 6 hours
  await safeRegisterModule('intelligence-scanner', async () => {
    registerIntelligenceScanner(fastify.supabase)
  }, fastify.log)

  // Public routes — NO JWT required (must be before authPlugin)
  await fastify.register(setupRoute)            // POST /setup (tenant + profile creation on signup)
  await fastify.register(attendanceIngestRoute) // POST /attendance/ingest (device api_key auth)
  await fastify.register(authPlugin)

  // ── Sprint 1 Routes ─────────────────────────────────────────
  // Static sub-paths MUST come before /:id to avoid route shadowing
  await fastify.register(fullCreateRoute)       // POST /employees/full-create  ← atomic creation
  await fastify.register(fullProfileRoute)      // /employees/:id/full-profile
  await fastify.register(employeeOptionsRoute)  // /employees/options
  await fastify.register(employeeRoutes)
  await fastify.register(orgRoutes)
  await fastify.register(documentRoutes)
  await fastify.register(analyticsRoutes)
  await fastify.register(reportsRoutes)
  await fastify.register(workforceIntelligenceRoutes)  // GET /analytics/workforce/*
  await fastify.register(workforceDrillRoutes)         // GET /analytics/workforce/drill
  await fastify.register(rosterIntelligenceRoutes)     // GET /analytics/roster/*

  // ── Sprint 2: Master Routes ──────────────────────────────────
  await fastify.register(mastersRoutes, { prefix: '/masters' })

  // ── Universal Master Import Framework ────────────────────────
  await fastify.register(importRoutes, { prefix: '/import' })

  // ── AI-Assisted Employee Onboarding ──────────────────────────
  await fastify.register(onboardingSessionRoutes,  { prefix: '/onboarding' })  // sessions + documents + extract
  await fastify.register(onboardingDraftRoutes,    { prefix: '/onboarding' })  // draft review + validate + approve
  await fastify.register(onboardingDashboardRoute, { prefix: '/onboarding' })  // dashboard stats

  // ── Notifications ─────────────────────────────────────────────
  await fastify.register(notificationsRoutes, { prefix: '/notifications' })

  // ── Sprint 2: Employee Module Routes ────────────────────────
  // These all register /employees/:id/... patterns
  await fastify.register(personalInfoRoutes)
  await fastify.register(bankStatutoryRoutes)
  await fastify.register(previousEmploymentRoutes)
  await fastify.register(identityRoutes)
  await fastify.register(contractsRoutes)
  await fastify.register(familyRoutes)
  await fastify.register(nominationsRoutes)
  await fastify.register(emergencyContactsRoutes)
  await fastify.register(addressesRoutes)
  await fastify.register(separationRoutes)
  await fastify.register(accessCardsRoutes)
  await fastify.register(jobHistoryRoutes)
  await fastify.register(compensationRoutes)
  await fastify.register(passportVisaRoutes)       // /employees/:id/passport-visa/*
  await fastify.register(employeeDocumentsRoutes)  // /employees/:id/documents/*
  await fastify.register(employeeManagerRoutes)    // /employees/:id/manager
  await fastify.register(employeeOrgContextRoutes) // /employees/:id/org-context

  // ── Attendance Routes ────────────────────────────────────────
  // Registration order: most-specific static paths first; wildcard /:id LAST.
  await fastify.register(attendanceStatusRoute)          // GET  /attendance/process/status
  await fastify.register(attendanceLastRunRoute)         // GET  /attendance/process/last
  await fastify.register(attendanceRunExportRoute)       // GET  /attendance/process/runs/:runId/export
  await fastify.register(attendanceRunDetailsRoute)      // GET  /attendance/process/runs/:runId
  await fastify.register(attendanceProcessRoute)         // POST /attendance/process
  await fastify.register(attendanceMusterRoute)          // GET  /attendance/muster
  await fastify.register(attendanceRosterRoute)          // /attendance/roster/*
  await fastify.register(attendanceAuditRoute)           // GET /attendance/audit
  await fastify.register(attendancePayrollSummaryRoute)  // GET /attendance/payroll-summary
  await fastify.register(leaveRequestsRoute)             // /leave-requests/* + /approvals/pending
  await fastify.register(leaveEmployeeRoute)             // /leave/apply  /leave/my-requests  /leave/:id/cancel
  await fastify.register(regularisationPolicyRoutes)      // /attendance/regularisation/policy + /sla-report
  await fastify.register(attendanceRegularisationRoute)  // /attendance/regularisation/*
  await fastify.register(attendanceLeaveRoute)           // /attendance/leave/*
  await fastify.register(attendanceRecomputeRoute)       // POST /attendance/recompute
  await fastify.register(attendancePunchRoute)           // POST /attendance/punch
  await fastify.register(attendanceAnomaliesRoute)       // GET /attendance/anomalies/* + POST /resolve
  await fastify.register(attendanceSampleCsvRoute)       // GET  /attendance/sample-csv
  await fastify.register(attendanceUploadRoute)          // POST /attendance/upload
  await fastify.register(leaveEntitlementRoute)          // POST /leave/entitlement/*
  await fastify.register(leaveJobsRoute)                 // GET/POST /leave/jobs/*
  await fastify.register(managerDashboardRoute)          // GET  /manager/dashboard
  await fastify.register(attendanceCorrectionsRoute)     // /attendance/corrections/*
  await fastify.register(approvalWorkflowsRoute)         // /approvals/workflows/*
  await fastify.register(leavePolicyResolveRoute)        // GET /leave/policy/resolve/*
  await fastify.register(compOffRoute)                   // /attendance/comp-off/*
  await fastify.register(overtimeRoutes)                 // /overtime/*
  await fastify.register(leaveCollisionRoutes)           // /leave/collision/* + /leave/optional-holidays/*
  await fastify.register(leaveAccrualRoutes)             // /leave/accrual/* + /leave/encashment/*
  await fastify.register(attendanceIntelligenceRoute)    // /attendance/intelligence/*
  await fastify.register(periodLocksRoutes)              // /attendance/period-locks/*
  await fastify.register(attendanceForensicsRoute)       // GET  /attendance/forensics/:employeeId/:date

  // ── Attendance Intelligence Routes (Phase 11) ────────────────────────────────
  await fastify.register(attendanceExceptionsRoute)           // GET/POST /attendance/exceptions, PUT /attendance/exceptions/:id
  await fastify.register(attendanceConfidenceRoute)           // GET /attendance/confidence/*
  await fastify.register(attendanceInferenceRoute)            // GET/POST /attendance/inference/*
  await fastify.register(attendancePolicyConflictsRoute)      // GET /attendance/policy-conflicts/*
  await fastify.register(attendanceRetroactiveRoute)          // GET/POST/PUT /attendance/retroactive/*
  await fastify.register(attendanceRiskRoute)                 // GET/POST /attendance/risk/*
  await fastify.register(attendanceHealthIndexRoute)          // GET/POST /attendance/health-index/*
  await fastify.register(attendanceSimulatePolicyRoute)       // POST /attendance/simulate-policy
  await fastify.register(attendanceTimelineIntelligenceRoute) // GET /attendance/timeline-intelligence/*

  await fastify.register(attendanceFetchRoute)           // GET  /attendance/:employeeId  ← last

  // ── Payroll Routes ───────────────────────────────────────────
  await fastify.register(payrollRoutes)                  // POST /payroll/runs, GET /payroll/runs, etc.
  await fastify.register(payrollLedgerRoute)             // GET/POST /payroll/ledger/*
  await fastify.register(payrollInvestigateRoute)        // GET /payroll/investigate/:employeeId
  await fastify.register(payrollCostRoute)               // GET /analytics/payroll/cost, /trends, /insights, /departments
  await fastify.register(payrollForecastRoute)           // GET/POST /analytics/payroll/forecast
  await fastify.register(payrollSimulateRoute)           // POST /analytics/payroll/simulate

  // ── Compensation Intelligence Routes ─────────────────────────
  await fastify.register(compensationRevisionsRoute)     // GET/POST /compensation/revisions/*

  // ── Letter Generation Routes (optional — isolated) ──────────────────────
  await safeRegisterModule('letters', async () => {
    await fastify.register(lettersRoutes)                // /letters/templates, /letters/generate, /letters/ess/*, etc.
  }, fastify.log)

  // ── Phase 13: Enterprise Payroll Platform ─────────────────────────────────
  await fastify.register(payrollCompensationMasterRoute,    { prefix: '/payroll/compensation' })    // GET/POST /payroll/compensation/*
  await fastify.register(payrollCompensationRevisionsRoute, { prefix: '/payroll/revisions' })       // GET/POST /payroll/revisions/*
  await fastify.register(payrollStatutoryEpfRoute,          { prefix: '/payroll/statutory/epf' })   // GET/POST /payroll/statutory/epf/*
  await fastify.register(payrollStatutoryEsiRoute,          { prefix: '/payroll/statutory/esi' })   // GET/POST /payroll/statutory/esi/*
  await fastify.register(payrollStatutoryPtaxRoute,         { prefix: '/payroll/statutory/ptax' })  // GET/POST /payroll/statutory/ptax/*
  await fastify.register(payrollStatutoryTdsRoute,          { prefix: '/payroll/statutory/tds' })   // GET/POST /payroll/statutory/tds/*
  await fastify.register(payrollAdvancesRoute,              { prefix: '/payroll/advances' })         // GET/POST /payroll/advances/*
  await fastify.register(payrollLoansRoute,                 { prefix: '/payroll/loans' })            // GET/POST /payroll/loans/*
  await fastify.register(payrollReimbursementsRoute,        { prefix: '/payroll/reimbursements' })  // GET/POST /payroll/reimbursements/*
  await fastify.register(payrollVariablePayRoute,           { prefix: '/payroll/variable-pay' })    // GET/POST /payroll/variable-pay/*
  await fastify.register(payrollArrearsRoute,               { prefix: '/payroll/arrears' })          // GET/POST /payroll/arrears/*
  await fastify.register(payrollGovernanceRoute,            { prefix: '/payroll/governance' })       // GET/POST /payroll/governance/*
  await fastify.register(payrollValidationRoute,            { prefix: '/payroll/validation' })       // GET/POST /payroll/validation/*
  await fastify.register(notificationTemplatesRoute,        { prefix: '/notifications/templates' })  // GET/POST /notifications/templates/*
  await fastify.register(notificationInboxRoute,            { prefix: '/notifications/inbox' })        // GET/POST /notifications/inbox/*

  // ── Workspace aggregated stats (must precede individual resource routes) ──
  await fastify.register(workspaceStatsRoutes)          // GET /onboarding/stats|events, /employees/overview, /attendance/stats|events, /payroll/runs/stats|events, /payroll/compliance/stats, /payroll/reconciliation, /ops/health|events

  // ── Workforce Optimization Engine ────────────────────────────────────────
  await fastify.register(workforceOptimizationRoute)    // GET/POST /attendance/workforce-optimization/*

  // ── Executive Intelligence ────────────────────────────────────────────────
  await fastify.register(executiveIntelligenceRoute)    // GET /analytics/executive/*

  // ── Governance Evolution ──────────────────────────────────────────────────
  await fastify.register(governanceEvolutionRoute)      // GET/POST /approvals/governance/*

  // ── ESS Operational Experience ────────────────────────────────────────────
  await fastify.register(essOperationalRoute)           // GET /ess/*

  // ── System: Event Governance + Orchestration + Incidents + Webhooks + Integrations ──
  await fastify.register(eventGovernanceRoute)          // GET/POST /system/event-governance/*
  await fastify.register(orchestrationRoute)            // GET/POST /system/orchestration/*
  await fastify.register(incidentsRoute)                // GET/POST /system/incidents/*
  await fastify.register(webhooksRoute)                 // GET/POST /system/webhooks/*
  await fastify.register(integrationsRoute)             // GET/POST /system/integrations/*

  // ── System health endpoints (unauthenticated — orchestration probes) ─────
  await fastify.register(healthRoutes)                   // GET /health, GET /ready

  // ── System observability endpoints (authenticated) ────────────────────────
  await fastify.register(jobQueueRoutes)                 // GET/DELETE /system/jobs, /system/jobs/dead/*

  const port = parseInt(process.env.PORT ?? '2001')
  await fastify.listen({ port, host: '0.0.0.0' })
  console.log(`🚀 HRMS API running at http://localhost:${port}`)
}

start().catch((err) => {
  fastify.log.error(err)
  process.exit(1)
})
