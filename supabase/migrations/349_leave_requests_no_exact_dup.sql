-- ISSUE-067: DB backstop for the TOCTOU race in POST /leave-requests.
--
-- The service-layer overlap check (leave-request-service.ts) is a non-atomic
-- read-then-insert: two concurrent identical submissions can both pass the
-- check before either row is committed. This partial unique index closes the
-- gap for the exact-duplicate case (same employee, same date range).
--
-- Key choice: (tenant_id, employee_id, from_date, to_date) only.
-- session/leave_type_id are NOT in the key because the overlap check already
-- treats any date-range overlap as a conflict regardless of session or type;
-- the index should enforce the same invariant, not a narrower subset.
--
-- Partial predicate: only active states. Cancelled/rejected rows must not
-- block future requests for the same dates.

CREATE UNIQUE INDEX IF NOT EXISTS idx_lr_no_exact_dup
  ON leave_requests (tenant_id, employee_id, from_date, to_date)
  WHERE status IN ('PENDING', 'APPROVED');
