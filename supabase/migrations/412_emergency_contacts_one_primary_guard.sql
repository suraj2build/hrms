-- ============================================================
-- 412_emergency_contacts_one_primary_guard.sql
--
-- PEND-67 (AUDIT_CONSTITUTION.md §14.6): POST/PUT /ess/me/emergency-contacts
-- set a new contact as primary by first clearing is_primary on all of the
-- employee's other contacts, then inserting/updating the new one as two
-- separate, non-atomic writes with no unique index backing the invariant.
-- A double-submit race (double-click, two tabs) can leave either two
-- contacts marked primary or zero.
--
-- Fix: a partial unique index enforces "at most one primary contact per
-- employee" at the database, and set_primary_emergency_contact_atomic()
-- does the clear+set in one transaction (retrying on a unique-violation
-- raised by a concurrent call that raced it, so the retry's own clear step
-- picks up the just-committed winner). Routes never write is_primary=true
-- directly outside this function, so the index can never be violated by
-- an ordinary single-request write.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_contacts_one_primary
  ON emergency_contacts (tenant_id, employee_id)
  WHERE is_primary = true;

CREATE OR REPLACE FUNCTION set_primary_emergency_contact_atomic(
  p_tenant_id   UUID,
  p_employee_id UUID,
  p_contact_id  UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  LOOP
    BEGIN
      UPDATE emergency_contacts
      SET    is_primary = false
      WHERE  tenant_id = p_tenant_id AND employee_id = p_employee_id
        AND  id != p_contact_id AND is_primary = true;

      UPDATE emergency_contacts
      SET    is_primary = true
      WHERE  tenant_id = p_tenant_id AND employee_id = p_employee_id AND id = p_contact_id;

      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent call raced us to set a different contact primary for
      -- the same employee and committed first; retry now that its write is
      -- visible, so our clear step picks it up this time.
    END;
  END LOOP;
END;
$$;
