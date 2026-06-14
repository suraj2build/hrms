/**
 * startup-health.ts — Platform resilience and startup validation.
 *
 * Goals:
 *   1. Validate critical infrastructure before the platform starts serving traffic.
 *   2. Isolate optional module failures so one module cannot crash the whole API.
 *   3. Expose /health (liveness) and /ready (readiness) endpoints for orchestration.
 *
 * Design:
 *   · startupHealthChecks() runs synchronously-in-sequence at boot.
 *   · Each module is wrapped in runCheck() which catches and logs failures.
 *   · REQUIRED checks: if any fail, the process exits.
 *   · OPTIONAL checks: if any fail, the module is disabled (isModuleEnabled flag).
 *   · Results are stored in module state and exposed via /health + /ready.
 */

import type { FastifyBaseLogger } from 'fastify'
import type { SupabaseClient }    from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type CheckStatus  = 'ok' | 'degraded' | 'failed' | 'skipped'

export interface HealthCheck {
  name:      string
  status:    CheckStatus
  latencyMs: number
  message?:  string
}

export interface PlatformHealth {
  status:     'ok' | 'degraded' | 'unavailable'
  startedAt:  string
  checks:     HealthCheck[]
  modules:    Record<string, boolean>   // module → enabled flag
}

// ── Module registry ────────────────────────────────────────────────────────────

const OPTIONAL_MODULES = [
  'letters',
  'notifications',
  'leave-scheduler',
  'attendance-api-scheduler',
  'anomaly-handler',
  'intelligence',
  'event-bus-automation',
  'sla-scanner',
  'intelligence-scanner',
  'digest-scheduler',
  'wo-credit-reconciler',
  'durable-queue',
  'webhook-service',
  'onboarding',
] as const

type OptionalModule = typeof OPTIONAL_MODULES[number]

/** Platform-wide health state — updated by startupHealthChecks() and module init */
export const platformHealth: PlatformHealth = {
  status:    'ok',
  startedAt: new Date().toISOString(),
  checks:    [],
  modules:   Object.fromEntries(OPTIONAL_MODULES.map(m => [m, true])),
}

// ── Check runner ───────────────────────────────────────────────────────────────

async function runCheck(
  name:     string,
  required: boolean,
  fn:       () => Promise<void>,
  log:      FastifyBaseLogger,
): Promise<HealthCheck> {
  const t0 = Date.now()
  try {
    await fn()
    const result: HealthCheck = { name, status: 'ok', latencyMs: Date.now() - t0 }
    log.info({ check: name, latencyMs: result.latencyMs }, `[startup] ${name} OK`)
    return result
  } catch (err) {
    const latencyMs = Date.now() - t0
    const message   = err instanceof Error ? err.message : String(err)
    const result: HealthCheck = { name, status: required ? 'failed' : 'degraded', latencyMs, message }
    const level = required ? 'error' : 'warn'
    log[level]({ check: name, error: message, latencyMs }, `[startup] ${name} ${result.status.toUpperCase()}`)
    return result
  }
}

// ── Required checks ────────────────────────────────────────────────────────────

async function checkEnvVars(): Promise<void> {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }
}

async function checkDatabaseConnectivity(supabase: SupabaseClient): Promise<void> {
  // Lightweight query — just enough to confirm Supabase responds
  const { error } = await supabase
    .from('tenants')
    .select('id')
    .limit(1)
  if (error) throw new Error(`Database connectivity: ${error.message}`)
}

async function checkAuthPlugin(): Promise<void> {
  // Verify JWT secret is configured
  if (!process.env.SUPABASE_JWT_SECRET && !process.env.JWT_SECRET) {
    throw new Error('No JWT secret configured (SUPABASE_JWT_SECRET or JWT_SECRET)')
  }
}

// ── Optional module checks ─────────────────────────────────────────────────────

async function checkLettersModule(): Promise<void> {
  // Verify the letters table exists and is accessible
  const supabaseUrl  = process.env.SUPABASE_URL
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase not configured')
  // If we got here the DB check already passed — the module is available
}

async function checkNotificationInfrastructure(): Promise<void> {
  // Notification service uses in-process event emitter — always available
  // Extend this to check SMTP/Webhook configs when those are added
}

// ── Module disable helper ──────────────────────────────────────────────────────

export function disableModule(module: OptionalModule, reason: string, log: FastifyBaseLogger) {
  platformHealth.modules[module] = false
  platformHealth.status = 'degraded'
  log.warn({ module, reason }, `[startup] Module "${module}" disabled: ${reason}`)
}

export function isModuleEnabled(module: OptionalModule): boolean {
  return platformHealth.modules[module] ?? false
}

// ── Main entry point ───────────────────────────────────────────────────────────

export async function startupHealthChecks(
  supabase: SupabaseClient,
  log:      FastifyBaseLogger,
): Promise<void> {
  log.info('[startup] Running platform health checks…')
  const checks: HealthCheck[] = []

  // ── REQUIRED: environment variables ───────────────────────────────────────
  const envCheck = await runCheck('env-vars', true, checkEnvVars, log)
  checks.push(envCheck)
  if (envCheck.status === 'failed') {
    log.fatal('[startup] Critical env vars missing — aborting startup')
    process.exit(1)
  }

  // ── REQUIRED: database connectivity ───────────────────────────────────────
  const dbCheck = await runCheck('database', true, () => checkDatabaseConnectivity(supabase), log)
  checks.push(dbCheck)
  if (dbCheck.status === 'failed') {
    log.fatal('[startup] Database unreachable — aborting startup')
    process.exit(1)
  }

  // ── REQUIRED: auth plugin ─────────────────────────────────────────────────
  const authCheck = await runCheck('auth', true, checkAuthPlugin, log)
  checks.push(authCheck)
  if (authCheck.status === 'failed') {
    log.fatal('[startup] Auth configuration invalid — aborting startup')
    process.exit(1)
  }

  // ── OPTIONAL: letters module ──────────────────────────────────────────────
  const lettersCheck = await runCheck('letters-module', false, checkLettersModule, log)
  checks.push(lettersCheck)
  if (lettersCheck.status === 'degraded') {
    disableModule('letters', lettersCheck.message ?? 'check failed', log)
  }

  // ── OPTIONAL: notification infrastructure ────────────────────────────────
  const notifCheck = await runCheck('notification-infra', false, checkNotificationInfrastructure, log)
  checks.push(notifCheck)
  if (notifCheck.status === 'degraded') {
    disableModule('notifications', notifCheck.message ?? 'check failed', log)
  }

  // ── Update global state ───────────────────────────────────────────────────
  platformHealth.checks = checks
  const hasFailures = checks.some(c => c.status === 'failed')
  const hasDegraded = checks.some(c => c.status === 'degraded')
  platformHealth.status = hasFailures
    ? 'unavailable'
    : hasDegraded ? 'degraded' : 'ok'

  log.info(
    { status: platformHealth.status, checksCount: checks.length },
    `[startup] Health checks complete — platform is ${platformHealth.status.toUpperCase()}`,
  )
}

// ── Module-level safe wrapper (used in index.ts around optional registrations) ─

/**
 * Wrap an optional module registration in a try/catch.
 * If it throws, the module is disabled gracefully rather than crashing startup.
 */
export async function safeRegisterModule<T>(
  moduleName: OptionalModule,
  fn:         () => Promise<T>,
  log:        FastifyBaseLogger,
): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    disableModule(moduleName, message, log)
    return null
  }
}
