-- ============================================================
-- 431_fix_tenant_delete_blocking_fks.sql
--
-- Hard-delete-a-tenant bug: DELETE /owner/tenants/:id (apps/api/src/routes/
-- owner/index.ts) relies on every tenant_id FK cascading so the tenants row
-- itself can be removed. 3 tables slipped through migration 196's earlier
-- sweep of this exact bug class (they were added later, in 342 and 351) and
-- still have the Postgres default NO ACTION/RESTRICT behavior on their
-- tenant_id FK — any tenant with even one row in these tables (e.g. one
-- that has ever run a 360° feedback round, a calibration session, or a
-- survey) hits a foreign-key-violation and the whole tenant delete aborts.
-- A demo tenant used to showcase every feature is exactly the kind of row
-- most likely to have data in all three.
--
-- Same policy as migration 196: NOT NULL tenant_id -> CASCADE (child rows
-- are meaningless without their tenant); nullable tenant_id -> SET NULL
-- (these two are redundant/denormalized scoping columns alongside a real
-- session/survey FK — nulling them, not deleting the row, is correct;
-- the row itself is removed via its other FK's own cascade instead).
--
-- Looks up each FK's actual name via pg_constraint rather than assuming the
-- Postgres-default <table>_<column>_fkey pattern, so this is robust to any
-- naming drift. Idempotent — safe to re-run.
-- ============================================================

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  -- feedback_360_nominators.tenant_id — NOT NULL, sibling feedback_360_rounds
  -- already has ON DELETE CASCADE; this one was inconsistently left without it.
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel        ON rel.oid = con.conrelid
  JOIN pg_class frel       ON frel.oid = con.confrelid
  JOIN pg_attribute att    ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'feedback_360_nominators'
    AND frel.relname = 'tenants' AND att.attname = 'tenant_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE feedback_360_nominators DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE feedback_360_nominators
    ADD CONSTRAINT feedback_360_nominators_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
END $$;

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  -- calibration_changes.tenant_id — nullable, added in migration 351 as an
  -- explicit-scope convenience column alongside the real session_id FK.
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel        ON rel.oid = con.conrelid
  JOIN pg_class frel       ON frel.oid = con.confrelid
  JOIN pg_attribute att    ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'calibration_changes'
    AND frel.relname = 'tenants' AND att.attname = 'tenant_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE calibration_changes DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE calibration_changes
    ADD CONSTRAINT calibration_changes_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  -- survey_response_analysis.tenant_id — nullable, same convenience-column
  -- pattern as calibration_changes above.
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel        ON rel.oid = con.conrelid
  JOIN pg_class frel       ON frel.oid = con.confrelid
  JOIN pg_attribute att    ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND rel.relname = 'survey_response_analysis'
    AND frel.relname = 'tenants' AND att.attname = 'tenant_id'
    AND array_length(con.conkey, 1) = 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE survey_response_analysis DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE survey_response_analysis
    ADD CONSTRAINT survey_response_analysis_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
END $$;
