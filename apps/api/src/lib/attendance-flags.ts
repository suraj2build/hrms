/**
 * attendance-flags.ts — runtime feature flags for the attendance engine.
 *
 * AHI-1 rollout lever. The unified shift-resolution-engine always runs (it is a
 * correctness fix — single authoritative resolver, temporal employee_shifts,
 * rotation policies honoured everywhere). What this flag gates is the NEW
 * behaviour layered on top: persisting the shift-attribution snapshot to
 * attendance_daily and stamping it into the compute log.
 *
 * Default: ENABLED. Set ATTENDANCE_SHIFT_ATTRIBUTION to one of
 * off | false | 0 | disabled | no to roll the persistence back instantly
 * without a redeploy. Shift resolution and payroll are unaffected either way —
 * payroll never reads the attribution columns.
 */

const OFF_VALUES = new Set(['off', 'false', '0', 'disabled', 'no'])

/**
 * Whether the engine should persist the shift-attribution snapshot
 * (expected_shift_id + companion columns) and include it in compute logs.
 */
export function isShiftAttributionEnabled(): boolean {
  const raw = process.env['ATTENDANCE_SHIFT_ATTRIBUTION']
  if (raw == null) return true            // default on
  return !OFF_VALUES.has(raw.trim().toLowerCase())
}
