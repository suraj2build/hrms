-- ============================================================
-- Migration 458: fix audit triggers so a tenant hard-delete
-- (DELETE FROM tenants, owner/index.ts's DELETE /owner/tenants/:id)
-- doesn't fail with a foreign-key violation.
-- ============================================================
--
-- Found while verifying the pilot's "reset" path (round 11, 2026-10-13):
-- deleting a tenant with ANY employee or master-data row (i.e. basically
-- every real tenant) failed with
--   "insert or update on table "audit_logs" violates foreign key
--    constraint "audit_logs_tenant_id_fkey" ... Key (tenant_id)=(...) is
--    not present in table "tenants""
--
-- Root cause: ON DELETE CASCADE from tenants fans out to every
-- tenant-scoped child table in the same transaction, in no guaranteed
-- order. employees and the 14 master tables (grades, designations, …)
-- each carry an AFTER DELETE trigger (log_employee_changes /
-- fn_audit_master_change) that INSERTs a new row into audit_logs
-- recording the delete. But audit_logs.tenant_id has its own
-- ON DELETE CASCADE FK to tenants — so by the time employees' cascade
-- fires, the tenants row has already been physically removed, and the
-- new audit_logs INSERT violates that FK immediately.
--
-- This was never caught before because it only manifests when deleting a
-- tenant that has real employee/master data — the owner panel's hard
-- delete action has essentially never been exercised against a populated
-- tenant until this pilot-reset rehearsal.
--
-- Fix: catching the FK violation (SQLSTATE 23503) and skipping the audit
-- insert is safe and correct here — audit_logs rows for THIS tenant are
-- themselves cascade-deleted in the very same transaction, so an audit
-- entry for "employee deleted" would be destroyed a moment later even if
-- it succeeded. Skipping it loses nothing; every other call path (normal
-- single-row insert/update/delete against a live tenant) is unaffected,
-- since the FK can only fail when the tenant no longer exists.

CREATE OR REPLACE FUNCTION log_employee_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old   JSONB;
  v_new   JSONB;
  v_diff  JSONB;
BEGIN

  CASE TG_OP

    WHEN 'INSERT' THEN
      BEGIN
        INSERT INTO audit_logs (
          tenant_id, table_name, record_id,
          action,
          old_data, new_data
        ) VALUES (
          NEW.tenant_id, 'employees', NEW.id,
          'INSERT',
          NULL,
          strip_employee_pii(to_jsonb(NEW))
        );
      EXCEPTION WHEN foreign_key_violation THEN
        NULL; -- tenant no longer exists (mid tenant-delete cascade) — nothing to audit
      END;

    WHEN 'UPDATE' THEN
      v_old  := strip_employee_pii(to_jsonb(OLD));
      v_new  := strip_employee_pii(to_jsonb(NEW));

      SELECT jsonb_object_agg(n.key, n.value)
        INTO v_diff
        FROM jsonb_each(v_new) AS n(key, value)
       WHERE v_new -> n.key IS DISTINCT FROM v_old -> n.key;

      IF v_diff IS NOT NULL
         AND (v_diff - 'updated_at') <> '{}'::jsonb
      THEN
        BEGIN
          INSERT INTO audit_logs (
            tenant_id, table_name, record_id,
            action,
            old_data, new_data
          ) VALUES (
            NEW.tenant_id, 'employees', NEW.id,
            'UPDATE',
            v_old,
            v_diff
          );
        EXCEPTION WHEN foreign_key_violation THEN
          NULL;
        END;
      END IF;

    WHEN 'DELETE' THEN
      BEGIN
        INSERT INTO audit_logs (
          tenant_id, table_name, record_id,
          action,
          old_data, new_data
        ) VALUES (
          OLD.tenant_id, 'employees', OLD.id,
          'DELETE',
          strip_employee_pii(to_jsonb(OLD)),
          NULL
        );
      EXCEPTION WHEN foreign_key_violation THEN
        NULL; -- tenant no longer exists (mid tenant-delete cascade) — nothing to audit
      END;

  END CASE;

  RETURN NULL;
END;
$$;

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

  IF v_tenant IS NULL OR v_record IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    INSERT INTO audit_logs (tenant_id, table_name, record_id, action, old_data, new_data, performed_by)
    VALUES (v_tenant, TG_TABLE_NAME, v_record, TG_OP, v_old, v_new, v_actor);
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- tenant no longer exists (mid tenant-delete cascade) — nothing to audit
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;
