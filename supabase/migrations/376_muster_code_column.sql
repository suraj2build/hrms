-- Migration 376 — Add muster_code display column to attendance_daily
--
-- muster_code is the canonical muster roll display code (P, P_L, A, MIS, NP,
-- HL, WO, PWO, PHL, CL, EL, SL, ML, PAT, BL, CO, LWP and half-day variants).
-- It is separate from the internal `status` field used by the calculation engine.
--
-- Sources:
--   1. attendance processor  — sets punch-derived codes (P, P_L, A, MIS, etc.)
--   2. leave approval route  — overwrites with leave-type codes (CL, EL, SL …)
--
-- Payroll uses day_fraction directly; muster_code is for display and reporting.

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS muster_code TEXT;

-- Partial index — only rows that have a code (saves index space for NULL rows).
CREATE INDEX IF NOT EXISTS idx_attendance_daily_muster_code
  ON attendance_daily (tenant_id, muster_code)
  WHERE muster_code IS NOT NULL;

-- Back-fill existing rows with the default status-to-code mapping.
-- Leave rows keep 'CL' as the generic placeholder until the leave route
-- can supply the specific code.
UPDATE attendance_daily
SET muster_code = CASE
  WHEN worked_on_holiday    = TRUE  THEN 'PHL'
  WHEN worked_on_weekly_off = TRUE  THEN 'PWO'
  WHEN status = 'present'           THEN 'P'
  WHEN status = 'late'              THEN 'P_L'
  WHEN status = 'absent'            THEN 'A'
  WHEN status = 'half_day'          THEN 'HLF'
  WHEN status = 'holiday'           THEN 'HL'
  WHEN status IN ('weekend', 'weekly_off') THEN 'WO'
  WHEN status = 'leave'             THEN 'CL'
  WHEN status = 'overtime'          THEN 'P'
  WHEN status = 'missing_punch'     THEN 'MIS'
  WHEN status = 'no_punch'          THEN 'A'   -- no record = Absent on muster
  ELSE NULL
END
WHERE muster_code IS NULL;
