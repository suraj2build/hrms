import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

// Plugins
import supabasePlugin    from './plugins/supabase.js'
import authPlugin        from './plugins/auth.js'
import ownerAuthPlugin   from './plugins/owner-auth.js'
import correlationPlugin from './plugins/correlation.js'

// Event handlers — register once at startup so notification handlers are wired
// before the first HTTP request arrives.
import { registerNotificationHandlers } from './lib/notification-service.js'
import { registerOnboardingHandlers }    from './lib/onboarding-orchestrator.js'
import { registerAnomalyHandlers }       from './lib/anomaly-handler.js'
import { registerLeaveScheduler }            from './lib/leave-scheduler.js'
import { registerAttendanceApiScheduler }    from './lib/attendance-api-scheduler.js'
import { registerEventBusAutomation }    from './lib/event-bus-automation.js'
import { registerSlaScanner }            from './lib/sla-scanner.js'
import { registerIntelligenceScanner }   from './lib/intelligence-scanner.js'
import { registerDigestScheduler }       from './lib/digest-scheduler.js'
import { registerWoCreditScheduler }     from './lib/wo-credit-reconciler.js'
import { jobQueue }                      from './lib/job-queue.js'
import { eventBus }                      from './lib/event-bus.js'
import type { HrmsEventType }            from './lib/event-bus.js'
import { durableQueue }                  from './lib/durable-queue.js'
import { WebhookService }                from './lib/webhook-service.js'
registerNotificationHandlers()
// Note: registerAnomalyHandlers(supabase) is called below inside start(), AFTER
// the supabase plugin is registered, because it needs the Supabase client.

// Routes — Sprint 1
import employeeOptionsRoute from './routes/employees/options.js'
import employeeRoutes from './routes/employees/index.js'
import orgRoutes from './routes/departments/index.js'
import positionsRoutes from './routes/positions/index.js'
import documentRoutes from './routes/documents/index.js'
import analyticsRoutes              from './routes/analytics/index.js'
import reportsRoutes                from './routes/analytics/reports.js'
import reportExportRoutes           from './routes/reports/export.js'
import datasetsRoutes               from './routes/datasets/index.js'
import workforceIntelligenceRoutes  from './routes/analytics/workforce-intelligence.js'
import workforceDrillRoutes         from './routes/analytics/workforce-drill.js'
import rosterIntelligenceRoutes     from './routes/analytics/roster-intelligence.js'

// Routes — Sprint 2: Masters
import mastersRoutes from './routes/masters/index.js'

// Routes — Sprint 2: Employee Modules
import personalInfoRoutes      from './routes/employees/personal-info.js'
import bankStatutoryRoutes     from './routes/employees/bank-statutory.js'
import previousEmploymentRoutes from './routes/employees/previous-employment.js'
import educationRoutes         from './routes/employees/education.js'
import identityRoutes          from './routes/employees/identity.js'
import contractsRoutes         from './routes/employees/contracts.js'
import familyRoutes            from './routes/employees/family.js'
import nominationsRoutes       from './routes/employees/nominations.js'
import emergencyContactsRoutes from './routes/employees/emergency-contacts.js'
import addressesRoutes         from './routes/employees/addresses.js'
import separationRoutes         from './routes/employees/separation.js'
import separationWorkflowRoutes from './routes/employees/separation-workflow.js'
import exitInterviewRoutes      from './routes/employees/exit-interview.js'
import assetsRoutes              from './routes/assets/index.js'
import intelligenceRoutes        from './routes/intelligence/index.js'
import complianceRoutes          from './routes/compliance/index.js'
import workforceRoutes           from './routes/workforce/index.js'
import accessCardsRoutes       from './routes/employees/access-cards.js'
import jobHistoryRoutes        from './routes/employees/job-history.js'
import compensationRoutes      from './routes/employees/compensation.js'
import fullProfileRoute        from './routes/employees/full-profile.js'
import fullCreateRoute         from './routes/employees/full-create.js'
import passportVisaRoutes      from './routes/employees/passport-visa.js'
import employeeDocumentsRoutes from './routes/employees/employee-documents.js'
import employeeManagerRoutes   from './routes/employees/manager.js'
import employeeOrgContextRoutes from './routes/employees/org-context.js'
import shiftHistoryRoutes       from './routes/employees/shift-history.js'
import onboardingStatusRoutes   from './routes/employees/onboarding-status.js'
import employeeTrustRoutes      from './routes/employees/trust.js'
import userAccountRoutes        from './routes/employees/user-account.js'
import employeeImportantDatesRoutes from './routes/employees/important-dates.js'
import employeeContextDataRoutes    from './routes/employees/context-data.js'

// Routes — Attendance
import attendanceIngestRoute          from './routes/attendance/ingest.js'
import attendanceProcessRoute         from './routes/attendance/process.js'
import attendanceForceUnlockRoute     from './routes/attendance/force-unlock.js'
import attendanceFetchRoute           from './routes/attendance/fetch.js'
import attendanceStatusRoute          from './routes/attendance/status.js'
import attendanceLastRunRoute         from './routes/attendance/last-run.js'
import attendanceRunExportRoute       from './routes/attendance/run-export.js'
import attendanceRunDetailsRoute      from './routes/attendance/run-details.js'
import attendanceRegularisationRoute  from './routes/attendance/regularisation.js'
import wfhRoutes                       from './routes/attendance/wfh.js'
import recognitionRoutes               from './routes/recognition/index.js'
import communityRoutes                  from './routes/community/index.js'
import attendanceLeaveRoute           from './routes/attendance/leave.js'
import attendanceMusterRoute          from './routes/attendance/muster.js'
import attendanceMusterUploadRoute    from './routes/attendance/muster-upload.js'
import attendanceRosterRoute          from './routes/attendance/roster-api.js'
import rosterCalendarRoute            from './routes/attendance/roster-calendar.js'
import attendanceAuditRoute           from './routes/attendance/audit.js'
import attendancePayrollSummaryRoute  from './routes/attendance/payroll-summary.js'
import leaveRequestsRoute             from './routes/attendance/leave-requests.js'
import leaveEmployeeRoute             from './routes/attendance/leave-employee.js'
import attendanceRecomputeRoute       from './routes/attendance/recompute.js'
import attendancePunchRoute           from './routes/attendance/punch.js'
import attendanceAnomaliesRoute       from './routes/attendance/anomalies.js'
import attendanceSampleCsvRoute       from './routes/attendance/sample-csv.js'
import attendanceUploadRoute          from './routes/attendance/upload.js'
import attendanceUploadHealthRoute    from './routes/attendance/upload-health.js'
import attendancePipelineStatsRoute   from './routes/attendance/pipeline-stats.js'
import leaveEntitlementRoute          from './routes/attendance/leave-entitlement.js'
import leaveJobsRoute                 from './routes/attendance/leave-jobs.js'
import leaveSchedulerStatusRoutes     from './routes/attendance/leave-scheduler-status.js'
import managerDashboardRoute          from './routes/attendance/manager-dashboard.js'
import whoIsInRoute                  from './routes/attendance/who-is-in.js'
import attendanceCorrectionsRoute     from './routes/attendance/corrections.js'
import approvalWorkflowsRoute         from './routes/approvals/workflows.js'
import leavePolicyResolveRoute        from './routes/attendance/leave-policy-resolve.js'
import compOffRoute                   from './routes/attendance/comp-off.js'
import woCreditRoutes                 from './routes/attendance/wo-credit.js'
import overtimeRoutes                 from './routes/attendance/overtime.js'
import leaveCollisionRoutes               from './routes/attendance/leave-collision.js'
import attendanceQueueActionsRoute        from './routes/attendance/queue-actions.js'
import attendanceContextRoutes           from './routes/attendance/context.js'
import rosterContextRoutes               from './routes/attendance/roster-context.js'
import leaveDurationRoutes               from './routes/attendance/leave-duration.js'
import leaveAccrualLifecycleRoutes       from './routes/attendance/leave-accrual-lifecycle.js'
import notificationsRoutes                from './routes/notifications/index.js'
import periodLocksRoutes                  from './routes/attendance/period-locks.js'
import regularisationPolicyRoutes         from './routes/attendance/regularisation-policy.js'
import leaveAccrualRoutes                 from './routes/attendance/leave-accrual.js'
import attendanceIntelligenceRoute        from './routes/attendance/intelligence.js'
import attendanceForensicsRoute          from './routes/attendance/forensics.js'
import workSessionsRoute                 from './routes/attendance/work-sessions.js'

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
import attendanceDebugRawRoute             from './routes/attendance/debug-raw.js'
import attendanceReconcileValidateRoute   from './routes/attendance/reconciliation-validate.js'
import anomalyReconcileRoute              from './routes/attendance/anomaly-reconcile.js'
import attendanceApiSourcesRoute          from './routes/attendance/api-sources.js'

// Routes — Payroll
import payrollRoutes                       from './routes/payroll/index.js'
import payrollContextRoutes                from './routes/payroll/context.js'
import payrollInvestigateRoute             from './routes/payroll/investigate.js'
import payrollLedgerRoute                  from './routes/payroll/ledger.js'
import payrollCostRoute                    from './routes/payroll/cost.js'
import payrollForecastRoute                from './routes/payroll/forecast.js'
import payrollSimulateRoute                from './routes/payroll/simulate.js'

// Routes — Compensation Intelligence
import compensationRevisionsRoute          from './routes/compensation/revisions.js'
import managerCompensationRoute            from './routes/compensation/manager-compensation.js'
import managerTeamLifecycleRoute           from './routes/manager/team-lifecycle.js'
import managerTeamAssetsRoute              from './routes/manager/team-assets.js'
import managerTeamHelpdeskRoute            from './routes/manager/team-helpdesk.js'
import managerTeamPayrollCostRoute         from './routes/manager/team-payroll-cost.js'
import managerTeamLeaveContextRoute        from './routes/manager/team-leave-context.js'
import managerTeamRegularisationContextRoute from './routes/manager/team-regularisation-context.js'

// Routes — Letter Generation
import lettersRoutes                       from './routes/letters/index.js'

// Routes — Universal Master Import Framework
import importRoutes                        from './routes/import/index.js'
import onboardingSessionRoutes             from './routes/onboarding/sessions.js'
import onboardingDraftRoutes               from './routes/onboarding/drafts.js'
import onboardingDashboardRoute            from './routes/onboarding/dashboard.js'
import onboardingChecklistRoutes           from './routes/onboarding/checklist.js'
import seedOnboardingTemplatesRoutes       from './routes/onboarding/seed-templates.js'
import preJoineeRoutes                     from './routes/onboarding/pre-joinee.js'
import onboardingTimelineRoutes            from './routes/onboarding/timeline.js'
import onboardingReadinessRoutes           from './routes/onboarding/readiness.js'
import helpdeskRoutes                      from './routes/helpdesk/index.js'
import benefitsRoutes                      from './routes/benefits/index.js'
import recruitmentRoutes                   from './routes/recruitment/index.js'
import certificationRoutes                 from './routes/certifications/index.js'
import securityRoutes                      from './routes/security/index.js'

// Routes — Upload session lifecycle management
import uploadSessionRoutes                 from './routes/uploads/index.js'

// Routes — System health + observability
import healthRoutes                        from './routes/system/health.js'
import jobQueueRoutes                      from './routes/system/jobs.js'
import operationalHealthRoutes             from './routes/system/operational-health.js'

// Routes — Sprint 3: Reconciliation
import attendanceReconciliationRoutes      from './routes/attendance/reconciliation.js'
import leaveReconciliationRoutes           from './routes/attendance/leave-reconciliation.js'

// Routes — Phase 13: Enterprise Payroll Platform
import payrollCompensationMasterRoute      from './routes/payroll/compensation-master.js'
import payrollCompensationRevisionsRoute   from './routes/payroll/compensation-revisions.js'
import payrollStatutoryEpfRoute            from './routes/payroll/statutory/epf.js'
import payrollStatutoryEsiRoute            from './routes/payroll/statutory/esi.js'
import payrollStatutoryPtaxRoute           from './routes/payroll/statutory/ptax.js'
import payrollStatutoryLwfRoute            from './routes/payroll/statutory/lwf.js'
import payrollStatutoryTdsRoute            from './routes/payroll/statutory/tds.js'
import tdsBulkRoute                        from './routes/payroll/statutory/tds-bulk.js'
import payrollStatutoryGovernanceRoute     from './routes/payroll/statutory/governance.js'
import tdsComponentsRoute                  from './routes/payroll/statutory/tds-components.js'
import tdsPlansRoute                       from './routes/payroll/statutory/tds-plans.js'
import itStatementRoute                    from './routes/payroll/statutory/it-statement.js'
import ytdStatementRoute                   from './routes/payroll/statutory/ytd-statement.js'
import taxGovernanceRoute                  from './routes/payroll/statutory/tax-governance.js'
import tdsPreviousEmploymentRoute          from './routes/payroll/statutory/previous-employment.js'
import tdsHraDeclarationsRoute             from './routes/payroll/statutory/hra-declarations.js'
import tdsRecoveryRoute                    from './routes/payroll/statutory/tds-recovery.js'
import payrollAdvancesRoute                from './routes/payroll/advances.js'
import payrollLoansRoute                   from './routes/payroll/loans.js'
import payrollEssLoansRoute               from './routes/payroll/ess-loans.js'
import payrollReimbursementsRoute          from './routes/payroll/reimbursements.js'
import payrollFbpRoute                      from './routes/payroll/fbp.js'
import payrollVariablePayRoute             from './routes/payroll/variable-pay.js'
import payrollArrearsRoute                 from './routes/payroll/arrears.js'
import payrollGovernanceRoute              from './routes/payroll/governance.js'
import payrollValidationRoute              from './routes/payroll/validation.js'
import payrollReconciliationRoute          from './routes/payroll/reconciliation.js'
import payrollAdjustmentsRoute            from './routes/payroll/adjustments.js'
import payrollExportsRoute                from './routes/payroll/exports.js'
import payrollFilingPackRoute             from './routes/payroll/filing-pack.js'
import payrollOpsDashboardRoute           from './routes/payroll/ops-dashboard.js'
import payrollBulkOpsRoute               from './routes/payroll/bulk-ops.js'
import payrollSchedulerMonitorRoute       from './routes/payroll/scheduler-monitor.js'
import notificationTemplatesRoute          from './routes/notifications/templates.js'
import notificationInboxRoute              from './routes/notifications/inbox.js'

// Routes — Workspace aggregated stats (command headers + intelligence panels)
import workspaceStatsRoutes                from './routes/workspace/stats.js'
import workspaceCompanyRoutes             from './routes/workspace/company-settings.js'
import workspaceSetupChecklistRoutes      from './routes/workspace/setup-checklist.js'
import workspaceGuidanceRoutes            from './routes/workspace/guidance.js'

// Routes — Sprint 12: Workforce Optimization + Event Governance + Orchestration + Governance Evolution + Incidents + Webhooks + Integrations + ESS Operational + Executive Intelligence
import workforceOptimizationRoute          from './routes/attendance/workforce-optimization.js'
import eventGovernanceRoute                from './routes/system/event-governance.js'
import orchestrationRoute                  from './routes/system/orchestration.js'
import incidentsRoute                      from './routes/system/incidents.js'
import webhooksRoute                       from './routes/system/webhooks.js'
import integrationsRoute                   from './routes/system/integrations.js'
import governanceEvolutionRoute            from './routes/approvals/governance-evolution.js'
import executiveIntelligenceRoute          from './routes/analytics/executive-intelligence.js'
import executiveRoutes                     from './routes/executive/index.js'
import essOperationalRoute                 from './routes/notifications/ess-operational.js'
import essSelfServiceRoute                  from './routes/ess/self-service.js'
import essHomeRoute                         from './routes/ess/home.js'
import essSignalsRoute                      from './routes/ess/signals.js'
import essActivityRoute                     from './routes/ess/activity.js'
import essProgressRoute                     from './routes/ess/progress.js'
import essReflectionRoute                   from './routes/ess/reflection.js'
import essEventsRoute                        from './routes/ess/events.js'
import essTimelineRoute                      from './routes/ess/timeline.js'
import essIdentityRoute                      from './routes/ess/identity.js'
import essTeamRoute                          from './routes/ess/team.js'
import essCompanyRoute                       from './routes/ess/company.js'
import assistantRoutes                      from './routes/assistant/index.js'

// Routes — Governance Intelligence (Sprint 2)
import governanceRoutes from './routes/governance/index.js'

// Routes — Trust & Compliance Intelligence (Sprint 3)
import trustRoutes from './routes/trust/index.js'

// Routes — Operational Intelligence (Sprint 4)
import operationsRoutes from './routes/operations/index.js'

// Routes — Enterprise Orchestration Fabric (Sprint 5)
import fabricRoutes from './routes/fabric/index.js'

// Routes — Public (no JWT required)
import setupRoute from './routes/setup.js'
import billingRoutes from './routes/billing/index.js'
import supportRoutes from './routes/support/index.js'
import ownerErrorReportRoutes from './routes/owner/error-reports.js'

// Routes — Owner Panel (platform admin only — separate auth)
import ownerRoutes from './routes/owner/index.js'

// Governance Intelligence — Sprint 2
import { governanceEvaluator }              from './platform/governance/evaluators/event-evaluator.js'
import { complianceGovernanceListener }     from './platform/governance/listeners/compliance-governance-listener.js'
import { trustGovernanceListener }          from './platform/governance/listeners/trust-governance-listener.js'
import { operationalIntelligenceListener }  from './platform/governance/listeners/operational-intelligence-listener.js'
import { fabricOrchestrationListener }      from './platform/governance/listeners/fabric-orchestration-listener.js'

// Sprint 4: Built-in automation triggers (side-effect import — registers triggers)
import './platform/operations/automation/built-in-triggers.js'

// Platform health + startup checks
import { startupHealthChecks, safeRegisterModule } from './lib/startup-health.js'

const fastify = Fastify({
  logger: process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : true,
  // Bulk imports (muster/attendance/master spreadsheets parsed to JSON client-side)
  // can exceed Fastify's 1 MB default. 16 MB is generous for those payloads while
  // still bounding request size to prevent unbounded-body DoS.
  bodyLimit: 16 * 1024 * 1024,
})

async function start() {
  // Security
  await fastify.register(helmet, { global: true })
  // CORS — allow the configured web URL(s), this project's own *.vercel.app
  // deploys (production + preview/branch), and localhost in dev. Uses a function
  // so a stray WEB_URL='*' can't break it. Auth is Bearer-token based.
  //
  // We deliberately do NOT allow *every* *.vercel.app origin (that let any
  // third-party Vercel site issue credentialed requests). Instead we match only
  // subdomains belonging to this project's deploys, configurable via
  // VERCEL_PROJECT_PREFIXES (comma-separated), defaulting to hrms-web/hrms-website.
  const allowedExact = new Set(
    (process.env.WEB_URL ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s && s !== '*'),
  )
  const projectPrefixes = (process.env.VERCEL_PROJECT_PREFIXES ?? 'hrms-web,hrms-website')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isOwnVercelDeploy = (hostname: string): boolean => {
    if (!hostname.endsWith('.vercel.app')) return false
    const sub = hostname.slice(0, -'.vercel.app'.length).toLowerCase()
    return projectPrefixes.some(p => sub === p || sub.startsWith(p + '-'))
  }
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Non-browser / same-origin / curl (no Origin header) → allow
      if (!origin) return cb(null, true)
      let ok = false
      try {
        const hostname = new URL(origin).hostname
        ok =
          allowedExact.has(origin) ||
          isOwnVercelDeploy(hostname) ||
          /^https?:\/\/localhost(:\d+)?$/.test(origin)
      } catch {
        ok = false
      }
      cb(null, ok)
    },
    credentials: true,
  })
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: 'RATE_LIMIT', message: 'Too many requests' }),
  })

  // Plugins
  await fastify.register(supabasePlugin)
  await fastify.register(import('./plugins/event-publisher.js'))

  // ── Governance Intelligence: register passive compliance listener ─────────
  governanceEvaluator.register(complianceGovernanceListener)
  governanceEvaluator.register(trustGovernanceListener)

  // Sprint 4: inject supabase into operational intelligence listener
  operationalIntelligenceListener.setSupabase(fastify.supabase)
  governanceEvaluator.register(operationalIntelligenceListener)

  // Sprint 5: Fabric orchestration listener
  fabricOrchestrationListener.setSupabase(fastify.supabase)
  governanceEvaluator.register(fabricOrchestrationListener)

  // ── Correlation ID / request tracing (must be before auth so logs carry ID) ─
  await fastify.register(correlationPlugin)

  // ── Global error handler — structured errors, no stack traces in responses ──
  fastify.setErrorHandler((err, req, reply) => {
    const reqAny      = req as any
    const statusCode  = (err as any).statusCode ?? 500

    fastify.log.error({
      err:           err.message,
      stack:         err.stack,              // server-side only
      correlationId: reqAny.correlationId ?? null,
      tenantId:      reqAny.tenantId      ?? null,
      route:         (req as any).routeOptions?.url ?? req.url,
      requestId:     req.id,
      statusCode,
    }, 'unhandled request error')

    return reply.code(statusCode).send({
      success: false,
      error: {
        code:    (err as any).code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
        // Never leak internals for 5xx; surface the message for 4xx (validation etc.)
        message: statusCode >= 500
          ? 'An unexpected error occurred. Please try again later.'
          : err.message,
      },
    })
  })

  // ── Wire loggers into in-process infrastructure ──────────────────────────────
  jobQueue.setLogger(fastify.log as any)
  eventBus.setLogger(fastify.log as any)

  // ── Startup health checks — run before serving any traffic ────────────────
  // Required checks (env-vars, database, auth) will process.exit(1) if they fail.
  // Optional module checks degrade gracefully and disable the module.
  await startupHealthChecks(fastify.supabase, fastify.log)

  // Onboarding orchestrator — wires onboarding → events, trust, notifications, checklist
  await safeRegisterModule('onboarding', async () => {
    registerOnboardingHandlers(fastify.supabase)
  }, fastify.log)

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

  // Attendance API scheduler — polls external punch-data sources on their configured intervals
  await safeRegisterModule('attendance-api-scheduler', async () => {
    registerAttendanceApiScheduler(fastify.supabase)
  }, fastify.log)

  // SLA scanner — proactively checks for overdue leave/correction requests every 4 hours
  await safeRegisterModule('sla-scanner', async () => {
    registerSlaScanner(fastify.supabase)
  }, fastify.log)

  // Intelligence scanner — emits Phase 4 operational events every 6 hours
  await safeRegisterModule('intelligence-scanner', async () => {
    registerIntelligenceScanner(fastify.supabase)
  }, fastify.log)

  // Digest scheduler (R9) — pushes daily/weekly/monthly workforce digests to HR admins
  await safeRegisterModule('digest-scheduler', async () => {
    registerDigestScheduler(fastify.supabase)
  }, fastify.log)

  // WO-credit reconciler — retail floating weekly-off accounting (per-tenant, idempotent)
  await safeRegisterModule('wo-credit-reconciler', async () => {
    registerWoCreditScheduler(fastify.supabase)
  }, fastify.log)

  // Durable job queue — Postgres-backed, crash-safe, multi-instance ready.
  // Must start AFTER supabase plugin is registered (needs the client).
  await safeRegisterModule('durable-queue', async () => {
    await durableQueue.start(fastify.supabase, fastify.log as any)
  }, fastify.log)

  // Webhook service — fans out all platform events to tenant-registered webhooks.
  // Must be registered AFTER supabase plugin (needs the client for DB lookups).
  await safeRegisterModule('webhook-service', async () => {
    const webhookSvc = new WebhookService(fastify.supabase)

    // Subscribe to every meaningful platform event so tenants can react to them
    // via registered webhooks. Fire-and-forget: delivery failures never affect callers.
    const WEBHOOK_EVENT_TYPES: HrmsEventType[] = [
      'payroll.run.started', 'payroll.run.completed', 'payroll.run.failed', 'payroll.blocked',
      'leave.applied', 'leave.approved', 'leave.rejected',
      'attendance.processing.completed', 'attendance.processing.failed', 'attendance.recomputed',
      'attendance.anomaly.detected',
      'correction.submitted', 'correction.approved', 'correction.rejected',
      'compensation.revised',
      'sla.breached',
      'roster.updated',
      'attendance.risk.detected',
      'burnout.risk.detected',
      'payroll.variance.detected',
      'staffing.shortage.detected',
      'policy.changed',
    ]

    eventBus.onMany(WEBHOOK_EVENT_TYPES, (event) => {
      webhookSvc.dispatchEvent(
        event.tenantId,
        event.type,
        event.payload as Record<string, unknown>,
        event.correlationId,
      ).catch((err) => {
        fastify.log.error({ err, eventType: event.type }, '[webhook-service] dispatch error')
      })
    })
  }, fastify.log)

  // Public routes — NO JWT required (must be before authPlugin)
  await fastify.register(setupRoute)            // POST /setup (tenant + profile creation on signup)
  await fastify.register(attendanceIngestRoute) // POST /attendance/ingest (device api_key auth)
  await fastify.register(authPlugin)
  await fastify.register(ownerAuthPlugin)       // platform_admins JWT check (separate from tenant auth)

  // Raw-body capture (opt-in per route via config.rawBody) — needed for Razorpay
  // webhook signature verification. global:false leaves all other routes untouched.
  await fastify.register(import('fastify-raw-body'), {
    field: 'rawBody', global: false, runFirst: true, encoding: 'utf8',
  })
  await fastify.register(billingRoutes)         // /billing/status|checkout|webhook (Razorpay)
  await fastify.register(supportRoutes)         // POST /support/error-reports (in-product error reporting)

  // ── Sprint 1 Routes ─────────────────────────────────────────
  // Static sub-paths MUST come before /:id to avoid route shadowing
  await fastify.register(fullCreateRoute)       // POST /employees/full-create  ← atomic creation
  await fastify.register(fullProfileRoute)      // /employees/:id/full-profile
  await fastify.register(employeeOptionsRoute)  // /employees/options
  await fastify.register(employeeRoutes)
  await fastify.register(orgRoutes)
  await fastify.register(positionsRoutes, { prefix: '/positions' })   // R7 — position management
  await fastify.register(documentRoutes)
  await fastify.register(analyticsRoutes)
  await fastify.register(reportsRoutes)
  await fastify.register(reportExportRoutes)
  await fastify.register(datasetsRoutes, { prefix: '/datasets' })
  await fastify.register(workforceIntelligenceRoutes)  // GET /analytics/workforce/*
  await fastify.register(workforceDrillRoutes)         // GET /analytics/workforce/drill
  await fastify.register(rosterIntelligenceRoutes)     // GET /analytics/roster/*

  // ── Sprint 2: Master Routes ──────────────────────────────────
  await fastify.register(mastersRoutes, { prefix: '/masters' })

  // ── Universal Master Import Framework ────────────────────────
  await fastify.register(importRoutes, { prefix: '/import' })

  // ── AI-Assisted Employee Onboarding ──────────────────────────
  await fastify.register(onboardingSessionRoutes,    { prefix: '/onboarding' })  // sessions + documents + extract
  await fastify.register(onboardingDraftRoutes,      { prefix: '/onboarding' })  // draft review + validate + approve
  await fastify.register(onboardingDashboardRoute,   { prefix: '/onboarding' })  // dashboard stats
  await fastify.register(onboardingChecklistRoutes,       { prefix: '/onboarding' })  // onboarding checklist
  await fastify.register(seedOnboardingTemplatesRoutes)   // routes already include full /onboarding/... path (no prefix → avoid double-prefix)
  await fastify.register(preJoineeRoutes)  // pre-joinee — routes already include full /onboarding/... paths (no prefix to avoid double-prefix)
  await fastify.register(onboardingTimelineRoutes)   // O2: /onboarding/sessions/:id/timeline + /employees/:id/onboarding-timeline
  await fastify.register(onboardingReadinessRoutes)  // O3: /onboarding/sessions/:id/readiness + /employees/:id/readiness

  // ── Notifications ─────────────────────────────────────────────
  await fastify.register(notificationsRoutes, { prefix: '/notifications' })

  // ── Sprint 2: Employee Module Routes ────────────────────────
  // These all register /employees/:id/... patterns
  await fastify.register(personalInfoRoutes)
  await fastify.register(bankStatutoryRoutes)
  await fastify.register(previousEmploymentRoutes)
  await fastify.register(educationRoutes)
  await fastify.register(identityRoutes)
  await fastify.register(contractsRoutes)
  await fastify.register(familyRoutes)
  await fastify.register(nominationsRoutes)
  await fastify.register(emergencyContactsRoutes)
  await fastify.register(addressesRoutes)
  await fastify.register(separationRoutes)
  await fastify.register(separationWorkflowRoutes)
  await fastify.register(exitInterviewRoutes)
  await fastify.register(assetsRoutes)             // /assets/* + /employees/:id/assets[/outstanding-count]
  await fastify.register(intelligenceRoutes, { prefix: '/intelligence' }) // AI Workforce OS — read-only intelligence
  await fastify.register(complianceRoutes, { prefix: '/compliance' })     // P2.1 statutory deadline calendar
  await fastify.register(workforceRoutes, { prefix: '/workforce' })       // P3.4 lifecycle expiry register
  await fastify.register(accessCardsRoutes)
  await fastify.register(jobHistoryRoutes)
  await fastify.register(compensationRoutes)
  await fastify.register(passportVisaRoutes)       // /employees/:id/passport-visa/*
  await fastify.register(employeeDocumentsRoutes)  // /employees/:id/documents/*
  await fastify.register(employeeManagerRoutes)    // /employees/:id/manager
  await fastify.register(employeeOrgContextRoutes) // /employees/:id/org-context
  await fastify.register(shiftHistoryRoutes)       // /employees/:id/shift-history
  await fastify.register(onboardingStatusRoutes)   // /employees/:id/onboarding-status
  await fastify.register(employeeTrustRoutes)      // O5.3: /employees/:id/trust + /onboarding/sessions/:id/trust
  await fastify.register(userAccountRoutes)        // /employees/:id/user-account
  await fastify.register(employeeImportantDatesRoutes) // /employees/:id/important-dates/*
  await fastify.register(employeeContextDataRoutes)    // /employees/:id/attendance | overtime | payroll-summary | activity-log

  // ── Attendance Routes ────────────────────────────────────────
  // Registration order: most-specific static paths first; wildcard /:id LAST.
  await fastify.register(attendanceStatusRoute)          // GET  /attendance/process/status
  await fastify.register(attendanceLastRunRoute)         // GET  /attendance/process/last
  await fastify.register(attendanceRunExportRoute)       // GET  /attendance/process/runs/:runId/export
  await fastify.register(attendanceRunDetailsRoute)      // GET  /attendance/process/runs/:runId
  await fastify.register(attendanceForceUnlockRoute)     // POST /attendance/process/force-unlock
  await fastify.register(attendanceProcessRoute)         // POST /attendance/process
  await fastify.register(attendanceMusterUploadRoute)    // GET/POST /attendance/muster/upload/* + GET /attendance/muster/uploads/*
  await fastify.register(attendanceMusterRoute)          // GET  /attendance/muster
  await fastify.register(attendanceRosterRoute)          // /attendance/roster/*
  await fastify.register(rosterCalendarRoute)            // /roster-calendar/*, /roster-weekly-off-rules/*, /shift-segments/*, /roster-rotation-groups/*, /roster-rotation-members/*, /roster-holiday-groups/*, /roster-simulation/*
  await fastify.register(attendanceAuditRoute)           // GET /attendance/audit
  await fastify.register(attendancePayrollSummaryRoute)  // GET /attendance/payroll-summary
  await fastify.register(leaveRequestsRoute)             // /leave-requests/* + /approvals/pending
  await fastify.register(leaveEmployeeRoute)             // /leave/apply  /leave/my-requests  /leave/requests  /leave/:id/cancel
  await fastify.register(regularisationPolicyRoutes)      // /attendance/regularisation/policy + /sla-report
  await fastify.register(wfhRoutes)                       // /attendance/wfh/* — proactive WFH requests
  await fastify.register(recognitionRoutes)               // /recognition/* — ESS 2.0 Rewards pillar
  await fastify.register(communityRoutes)                 // /community/* — ESS 2.0 Community feed
  await fastify.register(attendanceRegularisationRoute)  // /attendance/regularisation/*
  await fastify.register(attendanceLeaveRoute)           // /attendance/leave/*
  await fastify.register(attendanceRecomputeRoute)       // POST /attendance/recompute
  await fastify.register(attendancePunchRoute)           // POST /attendance/punch
  await fastify.register(attendanceAnomaliesRoute)       // GET /attendance/anomalies/* + POST /resolve
  await fastify.register(attendanceSampleCsvRoute)       // GET  /attendance/sample-csv
  await fastify.register(attendanceUploadRoute)          // POST /attendance/upload
  await fastify.register(attendanceUploadHealthRoute)    // GET  /attendance/upload-health
  await fastify.register(attendancePipelineStatsRoute)  // GET  /attendance/pipeline-stats
  await fastify.register(leaveEntitlementRoute)          // POST /leave/entitlement/*
  await fastify.register(leaveJobsRoute)                 // GET/POST /leave/jobs/*
  await fastify.register(leaveSchedulerStatusRoutes)     // GET /leave/scheduler/status|history|reconciliation
  await fastify.register(managerDashboardRoute)          // GET  /manager/dashboard
  await fastify.register(whoIsInRoute)                  // GET  /attendance/who-is-in
  await fastify.register(attendanceCorrectionsRoute)     // /attendance/corrections/*
  await fastify.register(approvalWorkflowsRoute)         // /approvals/workflows/*
  await fastify.register(leavePolicyResolveRoute)        // GET /leave/policy/resolve/*
  await fastify.register(compOffRoute)                   // /attendance/comp-off/*
  await fastify.register(woCreditRoutes)                 // /attendance/wo-credit/* (retail floating weekly-off)
  await fastify.register(overtimeRoutes)                 // /overtime/*
  await fastify.register(leaveCollisionRoutes)           // /leave/collision/* + /leave/optional-holidays/*
  await fastify.register(attendanceContextRoutes)        // GET /attendance/active-now|missing-punches/today|ot-spike-employees
  await fastify.register(rosterContextRoutes)            // GET /roster/uncovered-shifts|weekly-off-conflicts, GET /holidays
  await fastify.register(attendanceQueueActionsRoute)    // POST /attendance/queue/:id/(resolve|escalate|snooze)
  await fastify.register(leaveDurationRoutes)            // POST /leave/duration/preview + GET /leave/duration/explain/:id
  await fastify.register(leaveAccrualLifecycleRoutes)    // /leave/lifecycle/status + /leave/lifecycle/freeze + /leave/lifecycle/tiers
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
  await fastify.register(attendanceDebugRawRoute)             // GET  /attendance/debug/raw?month=YYYY-MM
  await fastify.register(attendanceReconcileValidateRoute)    // GET  /attendance/validate/reconcile?month=YYYY-MM
  await fastify.register(anomalyReconcileRoute)               // POST /attendance/anomalies/reconcile
  await fastify.register(attendanceApiSourcesRoute)           // CRUD + test + fetch /attendance/api-sources

  // ── Phase 16: Attendance Session Intelligence ────────────────────────────────
  await fastify.register(workSessionsRoute)              // GET/POST /attendance/sessions/*, /work-session-anomalies/*

  await fastify.register(attendanceFetchRoute)           // GET  /attendance/:employeeId  ← last

  // ── Payroll Routes ───────────────────────────────────────────
  await fastify.register(payrollRoutes)                  // POST /payroll/runs, GET /payroll/runs, etc.
  await fastify.register(payrollContextRoutes)           // GET /payroll/blockers|variance-summary|readiness|pending-locks
  await fastify.register(payrollLedgerRoute)             // GET/POST /payroll/ledger/*
  await fastify.register(payrollInvestigateRoute)        // GET /payroll/investigate/:employeeId
  await fastify.register(payrollCostRoute)               // GET /analytics/payroll/cost, /trends, /insights, /departments
  await fastify.register(payrollForecastRoute)           // GET/POST /analytics/payroll/forecast
  await fastify.register(payrollSimulateRoute)           // POST /analytics/payroll/simulate

  // ── Compensation Intelligence Routes ─────────────────────────
  await fastify.register(compensationRevisionsRoute)     // GET/POST /compensation/revisions/* (+ /bulk increment cycle)
  await fastify.register(managerCompensationRoute)        // GET /manager/team/compensation (P5.3)
  await fastify.register(managerTeamLifecycleRoute)        // GET /manager/team/lifecycle (P6.1/P6.2)
  await fastify.register(managerTeamAssetsRoute)           // GET /manager/team/assets (P6.7)
  await fastify.register(managerTeamHelpdeskRoute)         // GET /manager/team/helpdesk (P6.8)
  await fastify.register(managerTeamPayrollCostRoute)      // GET /manager/team/payroll-cost (P6.11)
  await fastify.register(managerTeamLeaveContextRoute)     // GET /manager/team/leave-context
  await fastify.register(managerTeamRegularisationContextRoute) // GET /manager/team/regularisation-context

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
  await fastify.register(payrollStatutoryLwfRoute,          { prefix: '/payroll/statutory/lwf' })   // GET/POST /payroll/statutory/lwf/*
  await fastify.register(payrollStatutoryTdsRoute,          { prefix: '/payroll/statutory/tds' })        // GET/POST /payroll/statutory/tds/*
  await fastify.register(tdsBulkRoute,                     { prefix: '/payroll/statutory/tds' })          // bulk verify/reject/lock + reconciliation + ESS completion
  await fastify.register(payrollStatutoryGovernanceRoute,  { prefix: '/payroll/statutory/governance' })  // GET/POST /payroll/statutory/governance/*
  await fastify.register(tdsComponentsRoute,               { prefix: '/payroll/statutory/tds' })          // GET /payroll/statutory/tds/components
  await fastify.register(tdsPlansRoute,                    { prefix: '/payroll/statutory/tds' })          // GET/POST /payroll/statutory/tds/plans/my
  await fastify.register(itStatementRoute,                 { prefix: '/payroll/statutory/tds' })          // GET /payroll/statutory/tds/it-statement/my
  await fastify.register(ytdStatementRoute,                { prefix: '/payroll/statutory/tds' })          // GET /payroll/statutory/tds/ytd/my
  await fastify.register(taxGovernanceRoute,               { prefix: '/payroll/statutory/tds' })          // GET/PUT /payroll/statutory/tds/governance
  await fastify.register(tdsPreviousEmploymentRoute,       { prefix: '/payroll/statutory/tds' })          // GET/POST/PUT/DELETE /payroll/statutory/tds/previous-employment/*
  await fastify.register(tdsHraDeclarationsRoute,          { prefix: '/payroll/statutory/tds' })          // GET/POST/PUT/DELETE /payroll/statutory/tds/hra/*
  await fastify.register(tdsRecoveryRoute,                 { prefix: '/payroll/statutory/tds' })          // GET/POST /payroll/statutory/tds/recovery/*
  await fastify.register(payrollAdvancesRoute,              { prefix: '/payroll/advances' })         // GET/POST /payroll/advances/*
  await fastify.register(payrollLoansRoute,                 { prefix: '/payroll/loans' })            // GET/POST /payroll/loans/*
  await fastify.register(payrollEssLoansRoute,              { prefix: '/payroll/ess' })              // ESS + manager approval endpoints
  await fastify.register(payrollReimbursementsRoute,        { prefix: '/payroll/reimbursements' })  // GET/POST /payroll/reimbursements/*
  await fastify.register(payrollFbpRoute,                   { prefix: '/payroll/fbp' })             // FBP quarterly reconciliation
  await fastify.register(payrollVariablePayRoute,           { prefix: '/payroll/variable-pay' })    // GET/POST /payroll/variable-pay/*
  await fastify.register(payrollArrearsRoute,               { prefix: '/payroll/arrears' })          // GET/POST /payroll/arrears/*
  await fastify.register(payrollGovernanceRoute,            { prefix: '/payroll/governance' })       // GET/POST /payroll/governance/*
  await fastify.register(payrollValidationRoute,            { prefix: '/payroll/validation' })       // GET/POST /payroll/validation/*
  await fastify.register(payrollReconciliationRoute)                                                 // POST /payroll/reconciliation/:id/acknowledge|escalate
  await fastify.register(payrollAdjustmentsRoute,           { prefix: '/payroll/adjustments' })      // GET/POST /payroll/adjustments/*
  await fastify.register(payrollExportsRoute,               { prefix: '/payroll/exports' })           // GET /payroll/exports/epf|esi|ptax|tds|challan|statutory-reconciliation
  await fastify.register(payrollFilingPackRoute,            { prefix: '/payroll/filing-pack' })        // GET/POST/PATCH /payroll/filing-pack/*
  await fastify.register(payrollOpsDashboardRoute,          { prefix: '/payroll/ops' })               // GET /payroll/ops/dashboard|issues|validate
  await fastify.register(payrollBulkOpsRoute,              { prefix: '/payroll/bulk' })              // POST /payroll/bulk/tds-approve|tds-reject|proof-verify|leave-approve|remind|statutory-update
  await fastify.register(payrollSchedulerMonitorRoute,      { prefix: '/payroll/scheduler' })         // GET /payroll/scheduler/jobs|status, POST /payroll/scheduler/retry/:jobId
  await fastify.register(notificationTemplatesRoute,        { prefix: '/notifications/templates' })  // GET/POST /notifications/templates/*
  await fastify.register(notificationInboxRoute,            { prefix: '/notifications/inbox' })        // GET/POST /notifications/inbox/*
  await fastify.register(helpdeskRoutes,                     { prefix: '/helpdesk' })                  // ESS-05 HR helpdesk tickets — employee + HR-admin endpoints
  await fastify.register(benefitsRoutes,                     { prefix: '/benefits' })                  // ESS-05 benefits enrolment — plans + employee enrolments
  await fastify.register(recruitmentRoutes,                  { prefix: '/recruitment' })                // RCT-01+ Recruitment & ATS — requisitions, candidates, applications, interviews
  await fastify.register(certificationRoutes,               { prefix: '' })                            // Certification Governance — /certifications/*
  await fastify.register(securityRoutes,                    { prefix: '/security' })                   // Security Operations Workspace — /security/*

  // ── Workspace aggregated stats (must precede individual resource routes) ──
  await fastify.register(workspaceStatsRoutes)          // GET /onboarding/stats|events, /employees/overview, /attendance/stats|events, /payroll/runs/stats|events, /payroll/compliance/stats, /payroll/reconciliation, /ops/health|events
  await fastify.register(workspaceCompanyRoutes)        // GET|PATCH /workspace/company, GET|PATCH /workspace/employee-code
  await fastify.register(workspaceSetupChecklistRoutes) // GET /workspace/setup-checklist
  await fastify.register(workspaceGuidanceRoutes)       // GET|PUT /workspace/guidance/config, GET /workspace/guidance/content

  // ── Owner Panel (platform admin — separate from tenant auth) ─────────────────
  await fastify.register(ownerRoutes)                   // GET|POST|PATCH /owner/*
  await fastify.register(ownerErrorReportRoutes)        // GET|PATCH /owner/error-reports (triage)

  // ── Workforce Optimization Engine ────────────────────────────────────────
  await fastify.register(workforceOptimizationRoute)    // GET/POST /attendance/workforce-optimization/*

  // ── Executive Intelligence (existing analytics routes) ───────────────────
  await fastify.register(executiveIntelligenceRoute)    // GET /analytics/executive/*

  // ── Executive Intelligence Center (new strategic aggregation layer) ───────
  await fastify.register(executiveRoutes)               // GET /executive/ceo|chro|workforce|financial|compliance|trends

  // ── Governance Evolution ──────────────────────────────────────────────────
  await fastify.register(governanceEvolutionRoute)      // GET/POST /approvals/governance/*

  // ── ESS Operational Experience ────────────────────────────────────────────
  await fastify.register(essOperationalRoute, { prefix: '/ess' })   // GET /ess/* (routes defined relative)
  await fastify.register(essHomeRoute,        { prefix: '/ess' })   // GET /ess/home (aggregated home payload)
  await fastify.register(essSignalsRoute,     { prefix: '/ess' })   // GET /ess/signals (Experience Core — "what needs you")
  await fastify.register(essActivityRoute,    { prefix: '/ess' })   // GET /ess/activity (Experience Core — "what happened")
  await fastify.register(essProgressRoute,    { prefix: '/ess' })   // GET /ess/progress (Experience Core — "am I doing well")
  await fastify.register(essReflectionRoute,  { prefix: '/ess' })   // GET /ess/reflection (Experience Core — memory-aware insight)
  await fastify.register(essEventsRoute,       { prefix: '/ess' })   // GET /ess/events (Experience Core — THE canonical Event stream)
  await fastify.register(essTimelineRoute,     { prefix: '/ess' })   // GET /ess/timeline (Story lens over canonical Events — employee memory)
  await fastify.register(essIdentityRoute,     { prefix: '/ess' })   // GET /ess/identity (Growth lens — My Growth: who I am & how I've grown)
  await fastify.register(essTeamRoute,         { prefix: '/ess' })   // GET /ess/team (People-near lens — My Team: how are my people)
  await fastify.register(essCompanyRoute,      { prefix: '/ess' })   // GET /ess/company (People-far lens — My Company: our shared world)
  await fastify.register(essSelfServiceRoute)                       // GET/POST/PUT/DELETE /ess/me/* (P4.1 data ownership)
  await fastify.register(assistantRoutes)                           // AI Assistant: /assistant/chat + /assistant/config

  // ── System: Event Governance + Orchestration + Incidents + Webhooks + Integrations ──
  await fastify.register(eventGovernanceRoute)          // GET/POST /system/event-governance/*
  await fastify.register(orchestrationRoute)            // GET/POST /system/orchestration/*
  await fastify.register(incidentsRoute)                // GET/POST /system/incidents/*
  await fastify.register(webhooksRoute)                 // GET/POST /system/webhooks/*
  await fastify.register(integrationsRoute)             // GET/POST /system/integrations/*

  // ── Sprint 2: Governance Intelligence Routes ─────────────────────────────
  await fastify.register(governanceRoutes)               // GET /governance/events|compliance/alerts|risk/summary|incidents

  // ── Sprint 3: Reconciliation routes ──────────────────────────────────────
  await fastify.register(attendanceReconciliationRoutes) // POST/GET /attendance/reconciliation/*
  await fastify.register(leaveReconciliationRoutes)      // POST/GET /leave/reconciliation/*

  // ── Sprint 3: Trust & Compliance Intelligence ─────────────────────────────
  await fastify.register(import('./routes/trust/index.js'))  // POST /trust/evaluate, GET /trust/*, /trust/regulatory/*

  // ── Sprint 4: Operational Intelligence ───────────────────────────────────
  await fastify.register(operationsRoutes)                   // GET/POST /operations/*

  // ── Sprint 5: Enterprise Orchestration Fabric ─────────────────────────────
  await fastify.register(fabricRoutes)                       // GET/POST /fabric/*

  // ── Phase 2: Signal Intelligence Layer ────────────────────────────────────
  await fastify.register(import('./routes/signal-intelligence/index.js'))  // POST /signals/*, GET /signals/explain/:eventType

  // ── Phase 3+9: Observability Trace & Operational Clarity ─────────────────
  await fastify.register(import('./routes/observability/index.js'))        // GET /observability/trace/:id, POST /observability/summary|heatmap, GET /observability/clusters

  // ── Phase 8+10: Enterprise Readiness + Production Reliability ────────────
  await fastify.register(import('./routes/enterprise/index.js'))           // GET/POST /enterprise/audit/*, /enterprise/queue, /enterprise/health, /enterprise/sla/*, /enterprise/listeners/*

  // ── Phase 7: Integration Hardening ────────────────────────────────────────
  await fastify.register(import('./routes/integrations/index.js'))         // GET /integrations/status, POST /integrations/pan/verify, GET /integrations/ifsc/:ifsc, POST /integrations/accounting/export

  // ── System health endpoints (unauthenticated — orchestration probes) ─────
  await fastify.register(healthRoutes)                   // GET /health, GET /ready

  // ── Upload session lifecycle (audit trail + orphan detection) ────────────
  await fastify.register(uploadSessionRoutes)            // GET/POST /uploads/sessions, PATCH /uploads/sessions/:id/complete|fail, GET /uploads/sessions/:id/url

  // ── System observability endpoints (authenticated) ────────────────────────
  await fastify.register(jobQueueRoutes)                 // GET/DELETE /system/jobs, /system/jobs/dead/*
  await fastify.register(operationalHealthRoutes)        // GET /system/operational-health, /attendance/freshness/*

  const port = parseInt(process.env.PORT ?? '2001')
  await fastify.listen({ port, host: '0.0.0.0' })
  console.log(`🚀 HRMS API running at http://localhost:${port}`)
}

start().catch((err) => {
  fastify.log.error(err)
  process.exit(1)
})
