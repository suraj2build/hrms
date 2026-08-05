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
-- Each fix is a fully self-contained DO block (same style as 431) rather
-- than calls into a shared helper function — no cross-statement/session
-- dependency, so each block can be run independently and in any order.
-- Idempotent — safe to re-run.
-- ============================================================

-- ── profiles(id) attribution columns ────────────────────────────────────

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'muster_uploads'
    AND frel.relname = 'profiles' AND att.attname = 'uploaded_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE muster_uploads DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE muster_uploads
    ADD CONSTRAINT muster_uploads_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE CASCADE;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'absconding_cases'
    AND frel.relname = 'profiles' AND att.attname = 'chro_approved_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE absconding_cases DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE absconding_cases
    ADD CONSTRAINT absconding_cases_chro_approved_by_fkey
    FOREIGN KEY (chro_approved_by) REFERENCES profiles(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'absconding_cases'
    AND frel.relname = 'profiles' AND att.attname = 'assigned_to'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE absconding_cases DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE absconding_cases
    ADD CONSTRAINT absconding_cases_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'absconding_cases'
    AND frel.relname = 'profiles' AND att.attname = 'created_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE absconding_cases DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE absconding_cases
    ADD CONSTRAINT absconding_cases_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;
END $$;

-- the reported blocker
DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'absconding_communications'
    AND frel.relname = 'profiles' AND att.attname = 'sent_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE absconding_communications DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE absconding_communications
    ADD CONSTRAINT absconding_communications_sent_by_fkey
    FOREIGN KEY (sent_by) REFERENCES profiles(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'surveys'
    AND frel.relname = 'profiles' AND att.attname = 'created_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE surveys DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE surveys
    ADD CONSTRAINT surveys_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'calibration_changes'
    AND frel.relname = 'profiles' AND att.attname = 'changed_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE calibration_changes DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE calibration_changes
    ADD CONSTRAINT calibration_changes_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES profiles(id) ON DELETE CASCADE;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'employees'
    AND frel.relname = 'profiles' AND att.attname = 'profile_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE employees
    ADD CONSTRAINT employees_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'attendance_regularisation'
    AND frel.relname = 'profiles' AND att.attname = 'submitted_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE attendance_regularisation DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE attendance_regularisation
    ADD CONSTRAINT attendance_regularisation_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES profiles(id) ON DELETE SET NULL;
END $$;

-- ── employees(id) attribution columns ───────────────────────────────────

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'letter_templates'
    AND frel.relname = 'employees' AND att.attname = 'created_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE letter_templates DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE letter_templates
    ADD CONSTRAINT letter_templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'letter_templates'
    AND frel.relname = 'employees' AND att.attname = 'updated_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE letter_templates DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE letter_templates
    ADD CONSTRAINT letter_templates_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES employees(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'generated_letters'
    AND frel.relname = 'employees' AND att.attname = 'issued_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE generated_letters DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE generated_letters
    ADD CONSTRAINT generated_letters_issued_by_fkey
    FOREIGN KEY (issued_by) REFERENCES employees(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'generated_letters'
    AND frel.relname = 'employees' AND att.attname = 'created_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE generated_letters DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE generated_letters
    ADD CONSTRAINT generated_letters_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'letter_approval_log'
    AND frel.relname = 'employees' AND att.attname = 'actor_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE letter_approval_log DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE letter_approval_log
    ADD CONSTRAINT letter_approval_log_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES employees(id) ON DELETE CASCADE;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'letter_requests'
    AND frel.relname = 'employees' AND att.attname = 'processed_by'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE letter_requests DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE letter_requests
    ADD CONSTRAINT letter_requests_processed_by_fkey
    FOREIGN KEY (processed_by) REFERENCES employees(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'payroll_run_blockers'
    AND frel.relname = 'employees' AND att.attname = 'employee_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payroll_run_blockers DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE payroll_run_blockers
    ADD CONSTRAINT payroll_run_blockers_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'calibration_changes'
    AND frel.relname = 'employees' AND att.attname = 'employee_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE calibration_changes DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE calibration_changes
    ADD CONSTRAINT calibration_changes_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'survey_responses'
    AND frel.relname = 'employees' AND att.attname = 'employee_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE survey_responses DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE survey_responses
    ADD CONSTRAINT survey_responses_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
END $$;
