-- ============================================================
-- 432_fix_profile_employee_attribution_fks.sql
--
-- Follow-up to 431 — that migration fixed 3 tables whose tenant_id FK
-- didn't cascade. Live testing (a rolled-back DELETE FROM tenants) surfaced
-- a bigger, related pattern: "who did this" attribution columns
-- (created_by/updated_by/approved_by/assigned_to/sent_by/processed_by/
-- actor_id/changed_by/uploaded_by/submitted_by/profile_id/employee_id)
-- pointing at profiles(id) or employees(id) across ~10 different tables,
-- almost none of which had an ON DELETE action set. Cascading a tenant
-- delete removes its profiles/employees rows, which in turn requires
-- every column referencing profiles(id)/employees(id) to resolve cleanly —
-- one single unresolved attribution FK anywhere in the schema is enough to
-- abort the whole tenant delete with a foreign-key-violation, exactly as
-- hit live: "absconding_communications_sent_by_fkey" on absconding_communications.
--
-- Policy (same as migrations 196/431): NOT NULL column -> CASCADE (the
-- row is meaningless without its actor and already tenant-scoped some
-- other way); nullable column -> SET NULL (preserve the audit-trail row,
-- just drop the "who did it" reference).
--
-- A local helper function does the drop-if-exists + re-add so this stays
-- readable across the ~18 constraints fixed here instead of copy-pasting
-- near-identical DO blocks. Dropped again at the end of the migration —
-- it's a one-off tool for this file, not permanent schema.
-- ============================================================

CREATE OR REPLACE FUNCTION _pin432_fix_fk(
  p_table  TEXT, p_column TEXT, p_target TEXT, p_action TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel     ON rel.oid = con.conrelid
  JOIN pg_class frel    ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = p_table
    AND frel.relname = p_target AND att.attname = p_column
    AND array_length(con.conkey, 1) = 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, v_conname);
  END IF;

  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s',
    p_table, p_table || '_' || p_column || '_fkey', p_column, p_target, p_action
  );
END;
$$;

-- ── profiles(id) attribution columns ────────────────────────────────────
SELECT _pin432_fix_fk('muster_uploads',           'uploaded_by',    'profiles',  'CASCADE');   -- NOT NULL
SELECT _pin432_fix_fk('absconding_cases',         'chro_approved_by','profiles', 'SET NULL');
SELECT _pin432_fix_fk('absconding_cases',         'assigned_to',    'profiles',  'SET NULL');
SELECT _pin432_fix_fk('absconding_cases',         'created_by',     'profiles',  'CASCADE');   -- NOT NULL
SELECT _pin432_fix_fk('absconding_communications','sent_by',        'profiles',  'SET NULL');  -- the reported blocker
SELECT _pin432_fix_fk('surveys',                  'created_by',     'profiles',  'SET NULL');
SELECT _pin432_fix_fk('calibration_changes',      'changed_by',     'profiles',  'CASCADE');   -- NOT NULL
SELECT _pin432_fix_fk('employees',                'profile_id',     'profiles',  'SET NULL');
SELECT _pin432_fix_fk('attendance_regularisation','submitted_by',   'profiles',  'SET NULL');

-- ── employees(id) attribution columns ───────────────────────────────────
SELECT _pin432_fix_fk('letter_templates',    'created_by',   'employees', 'SET NULL');
SELECT _pin432_fix_fk('letter_templates',    'updated_by',   'employees', 'SET NULL');
SELECT _pin432_fix_fk('generated_letters',   'issued_by',    'employees', 'SET NULL');
SELECT _pin432_fix_fk('generated_letters',   'created_by',   'employees', 'SET NULL');
SELECT _pin432_fix_fk('letter_approval_log', 'actor_id',     'employees', 'CASCADE');  -- NOT NULL
SELECT _pin432_fix_fk('letter_requests',     'processed_by', 'employees', 'SET NULL');
SELECT _pin432_fix_fk('payroll_run_blockers','employee_id',  'employees', 'SET NULL');
SELECT _pin432_fix_fk('calibration_changes', 'employee_id',  'employees', 'SET NULL');
SELECT _pin432_fix_fk('survey_responses',    'employee_id',  'employees', 'SET NULL');

DROP FUNCTION _pin432_fix_fk(TEXT, TEXT, TEXT, TEXT);
