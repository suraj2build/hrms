-- ============================================================
-- 265_master_data_audit.sql
--
-- MDI-1: Audit trail for master-data changes (finding M3).
--
-- Previously NOT A SINGLE master table was audited — grades (CTC bands),
-- employment categories (PF/ESI/PT flags), shifts, leave types, etc. could
-- be edited or deleted with no who/when/what record. Combined with the
-- in-place-mutation problem, a change was both retroactive and untraceable.
--
-- This adds one generic trigger that records every INSERT/UPDATE/DELETE on
-- the org/comp/compliance master tables into the existing audit_logs table.
--
-- The function is written DEFENSIVELY: it derives tenant_id/record_id from
-- the row's JSONB and, if either is absent, returns WITHOUT auditing rather
-- than raising — so attaching it can never break a master's writes.
--
-- Actor attribution: performed_by is read best-effort from the session GUC
-- app.actor_id (NULL when unset). Full per-request actor capture would need
-- app-layer logAction and is a follow-up; this trigger guarantees uniform
-- what/when/before-after coverage for all masters, including future ones.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_audit_master_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor  UUID;
  v_old    JSONB;
  v_new    JSONB;
  v_tenant UUID;
  v_record UUID;
BEGIN
  BEGIN
    v_actor := NULLIF(current_setting('app.actor_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  v_tenant := COALESCE((v_new->>'tenant_id')::UUID, (v_old->>'tenant_id')::UUID);
  v_record := COALESCE((v_new->>'id')::UUID,        (v_old->>'id')::UUID);

  -- Cannot audit safely without tenant + record → never block the write.
  IF v_tenant IS NULL OR v_record IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO audit_logs (tenant_id, table_name, record_id, action, old_data, new_data, performed_by)
  VALUES (v_tenant, TG_TABLE_NAME, v_record, TG_OP, v_old, v_new, v_actor);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to the org / compensation / compliance master tables.
DO $$
DECLARE
  t TEXT;
  master_tables TEXT[] := ARRAY[
    'grades', 'designations', 'departments', 'sites', 'shifts',
    'work_locations', 'cost_centers', 'employment_categories', 'leave_types',
    'positions', 'rotation_policies', 'rosters', 'salary_components',
    'salary_structures'
  ];
BEGIN
  FOREACH t IN ARRAY master_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I ' ||
        'FOR EACH ROW EXECUTE FUNCTION fn_audit_master_change()', t);
    END IF;
  END LOOP;
END;
$$;
