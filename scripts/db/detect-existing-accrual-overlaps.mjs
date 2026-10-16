#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 — one-time (safe to re-run) scan for
 * PRE-EXISTING employee+leave_type+period double-credits: tenants that had
 * BOTH leave_accrual_rules (System A) and leave_policy_rules (System B)
 * configured for the same employee/leave-type BEFORE migration 470's
 * execution-time conflict guard existed. Migration 470 only prevents NEW
 * double-credits going forward — it cannot see history. This script finds
 * employee+leave_type+year combinations with ledger rows from BOTH systems
 * (distinguished by their notes prefix, the only reliable marker left by
 * the pre-470 code) and records them into leave_accrual_conflicts with
 * detected_by='detection_scan' for HR review.
 *
 * Deliberately NOT automatic reversal: per the user's explicit instruction
 * ("Preserve audit history; do not automatically reverse historical
 * credits without reconciliation"), this script is READ-ONLY against
 * leave_accrual_ledger/employee_leave_balance/leave_balance_ledger — it
 * only ever INSERTs into leave_accrual_conflicts (ON CONFLICT DO NOTHING,
 * safe to re-run) and otherwise just prints a report. A human reviews each
 * finding and decides the correction (which, if any, of the two credits to
 * reverse) — this script does not and must not make that call.
 *
 * Usage: node scripts/db/detect-existing-accrual-overlaps.mjs [--apply]
 *   (no flag)  dry run — prints findings, does not write to the DB at all.
 *   --apply    also inserts the findings into leave_accrual_conflicts.
 */
import pg from 'pg'

const DB_URL = process.env.DETECT_DB_URL || 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: DB_URL })

async function main() {
  console.log(`=== Scanning for pre-existing dual-system accrual overlaps (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)

  // A "System A" credit's notes always start with 'Monthly accrual — ' or
  // 'Yearly accrual — ' (accrual-engine.ts); a "System B" (engine) credit's
  // notes always start with 'Engine ' (leave-entitlement-service.ts). Two
  // rows for the same (tenant, employee, leave_type, year) with one of each
  // prefix is a pre-existing overlap — both systems credited the same
  // entitlement independently, which migration 470 would now block.
  const { rows: overlaps } = await pool.query(`
    SELECT
      tenant_id, employee_id, leave_type_id, year,
      array_agg(DISTINCT CASE WHEN notes LIKE 'Engine %' THEN 'system_b' ELSE 'system_a' END) AS systems,
      count(*) AS ledger_row_count,
      sum(days) AS total_days_credited,
      array_agg(id) AS ledger_row_ids
    FROM leave_accrual_ledger
    WHERE accrual_type IN ('monthly', 'quarterly', 'yearly', 'upfront')
    GROUP BY tenant_id, employee_id, leave_type_id, year
    HAVING count(DISTINCT CASE WHEN notes LIKE 'Engine %' THEN 'system_b' ELSE 'system_a' END) > 1
  `)

  if (!overlaps.length) {
    console.log('No pre-existing overlaps found.')
    await pool.end()
    return
  }

  console.log(`Found ${overlaps.length} employee+leave_type+year combination(s) with credits from BOTH systems:\n`)
  for (const row of overlaps) {
    console.log(`  tenant=${row.tenant_id} employee=${row.employee_id} leave_type=${row.leave_type_id} year=${row.year}`)
    console.log(`    systems=${row.systems.join(',')} ledger_rows=${row.ledger_row_count} total_days_credited=${row.total_days_credited}`)
    console.log(`    ledger_row_ids=${row.ledger_row_ids.join(',')}`)
  }

  if (!APPLY) {
    console.log('\nDry run — no rows written. Re-run with --apply to record these into leave_accrual_conflicts for HR review.')
    await pool.end()
    return
  }

  console.log('\n=== Recording findings into leave_accrual_conflicts (read-only against ledger/balance data) ===')
  let inserted = 0
  for (const row of overlaps) {
    const period = String(row.year)
    const { rowCount } = await pool.query(
      `INSERT INTO leave_accrual_conflicts (tenant_id, employee_id, leave_type_id, period, detected_by)
       VALUES ($1, $2, $3, $4, 'detection_scan')
       ON CONFLICT (tenant_id, employee_id, leave_type_id, period) DO NOTHING`,
      [row.tenant_id, row.employee_id, row.leave_type_id, period],
    )
    inserted += rowCount
  }
  console.log(`Recorded ${inserted} new conflict row(s) (${overlaps.length - inserted} already existed, matched a period from an execution-time block instead).`)
  console.log('No leave_accrual_ledger, employee_leave_balance, or leave_balance_ledger row was modified by this scan — review each finding above and decide corrections manually.')

  await pool.end()
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
