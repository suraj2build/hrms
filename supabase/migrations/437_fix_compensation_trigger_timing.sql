-- ============================================================
-- Fix trg_close_prev_compensation trigger timing (AFTER → BEFORE)
-- ============================================================
--
-- fn_close_prev_compensation() closes an employee's previously-active
-- employee_compensations row whenever a new is_active=true row is inserted
-- for them. Several call sites (notably POST /compensation/revisions/:id/
-- approve) rely on this trigger firing automatically instead of closing the
-- old row themselves — see the comment at apps/api/src/routes/compensation/
-- revisions.ts line ~430 ("by this point the DB trigger has already closed
-- the old record").
--
-- Found via live UAT (docs/UAT_LIVE_AUDIT.md UAT-045): the trigger was
-- defined as AFTER INSERT OR UPDATE OF is_active, but uidx_comp_one_active
-- (a plain, non-deferrable unique index on (tenant_id, employee_id) WHERE
-- is_active) is enforced as each row's indexes are updated during the
-- INSERT itself — before any AFTER ROW trigger for that row can run. So for
-- any employee who already had an active compensation row (i.e. virtually
-- every employee, always), inserting the new is_active=true row unconditionally
-- violated the unique index and the whole INSERT aborted — the AFTER trigger
-- that was supposed to close the old row first never got a chance to run.
-- Confirmed live: approving a real, correctly-submitted compensation
-- revision failed 100% of the time with "duplicate key value violates
-- unique constraint uidx_comp_one_active".
--
-- Fix: move the trigger to BEFORE INSERT OR UPDATE OF is_active. A BEFORE
-- ROW trigger runs before NEW is written to the table/indexes, so closing
-- the *other*, currently-active row (id != NEW.id) inside it completes
-- before the unique index ever sees NEW — no conflict.

DROP TRIGGER IF EXISTS trg_close_prev_compensation ON employee_compensations;

CREATE TRIGGER trg_close_prev_compensation
  BEFORE INSERT OR UPDATE OF is_active ON employee_compensations
  FOR EACH ROW
  EXECUTE FUNCTION fn_close_prev_compensation();
