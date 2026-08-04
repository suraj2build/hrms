/**
 * notice-overdue-scanner.ts
 *
 * Fresh-audit F3 — the only place auth access gets revoked for a separating
 * employee via the normal flow is the manual "relieve" step in
 * separation-workflow.ts, gated on clearance_done AND F&F paid. If either
 * drags past the employee's own last_working_date, they keep full live
 * login access for as long as HR takes to finish paperwork — no automatic
 * backstop existed.
 *
 * Daily scan: for every employee whose employees.status is still 'on_notice'
 * but employee_separation.last_working_date has already passed (tenant-local
 * "today") and the separation record hasn't reached 'relieved'/'archived',
 * auto-revoke login access via the same revokeEmployeeAuth() primitive the
 * relieve step itself uses — WITHOUT touching employees.status or
 * lifecycle_stage, so the normal clearance/F&F/relieve workflow still
 * completes exactly as before; this only closes the live-access gap while
 * that workflow is still in flight. Idempotent via
 * employee_separation.access_auto_revoked_at (migration 426) — never
 * re-revokes (or re-notifies) the same row twice.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows }        from './supabase-paginate.js'
import { fetchTenantTz }       from './attendance-engine.js'
import { getLocalDate }        from './org-context.js'
import { revokeEmployeeAuth }  from './user-account-service.js'
import { notifyHrAdmins }      from './notify.js'

interface MinimalLogger {
  error: (obj: unknown, msg?: string) => void
  warn:  (obj: unknown, msg?: string) => void
}

interface OverdueRow {
  id:                 string
  employee_id:        string
  last_working_date:  string
  lifecycle_stage:    string
  // PostgREST returns the `!inner`-joined single row as a one-element array.
  employees: { first_name: string; last_name: string; employee_code: string }[] | null
}

export async function scan(supabase: SupabaseClient, log: MinimalLogger = console): Promise<void> {
  const tenants = await fetchAllRows<{ id: string }>((from, to) =>
    supabase.from('tenants').select('id').in('status', ['active', 'trial']).range(from, to),
  )

  for (const tenant of tenants) {
    const tenantId = tenant.id
    // Mirrors sla-scanner.ts/poll-scheduler.ts (SYSCERT High #25) — one
    // tenant's failure must not abort the scan for every subsequent tenant.
    try {
      const tz       = await fetchTenantTz(supabase, tenantId)
      const todayStr = getLocalDate(new Date().toISOString(), tz)

      const overdue = await fetchAllRows<OverdueRow>((from, to) =>
        supabase
          .from('employee_separation')
          .select('id, employee_id, last_working_date, lifecycle_stage, employees!inner(first_name, last_name, employee_code, status)')
          .eq('tenant_id', tenantId)
          .eq('employees.status', 'on_notice')
          .not('last_working_date', 'is', null)
          .lt('last_working_date', todayStr)
          .not('lifecycle_stage', 'in', '("relieved","archived")')
          .is('access_auto_revoked_at', null)
          .range(from, to),
      )

      for (const row of overdue) {
        try {
          // Claim this row first (idempotent guard) — if the UPDATE matches 0
          // rows, another concurrent scan tick already claimed it; skip.
          const { data: claimed } = await supabase
            .from('employee_separation')
            .update({ access_auto_revoked_at: new Date().toISOString() })
            .eq('id', row.id)
            .eq('tenant_id', tenantId)
            .is('access_auto_revoked_at', null)
            .select('id')
            .maybeSingle()
          if (!claimed) continue

          const revoked = await revokeEmployeeAuth(supabase, row.employee_id, tenantId, log)
          if (!revoked) {
            log.error(
              { tenantId, employeeId: row.employee_id, separationId: row.id },
              'notice-overdue-scanner: revokeEmployeeAuth did not fully succeed — employee may retain live access',
            )
          }

          const emp     = row.employees?.[0]
          const empName = emp ? `${emp.first_name} ${emp.last_name} (${emp.employee_code})` : row.employee_id

          await notifyHrAdmins(supabase, {
            tenantId,
            item_type:    'general',
            title:        'Access auto-revoked — separation overdue',
            summary:      `${empName}'s last working date (${row.last_working_date}) has passed but clearance/relieving was not yet complete. Login access has been automatically revoked; please finish the separation workflow.`,
            severity:     'critical',
            entity_type:  'employee_separation',
            entity_id:    row.id,
            action_route: `/admin/employees/${row.employee_id}/separation`,
          })
        } catch (e) {
          log.error({ tenantId, separationId: row.id, err: e }, 'notice-overdue-scanner: row processing failed')
        }
      }
    } catch (e) {
      log.error({ tenantId, err: e }, 'notice-overdue-scanner: tenant scan failed')
    }
  }
}
