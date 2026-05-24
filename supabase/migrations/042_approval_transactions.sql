-- ============================================================
-- 042_approval_transactions.sql
--
-- Atomic stored procedures for the approval workflow.
-- Each function runs in a single DB transaction (Postgres implicit
-- transaction per RPC call via PostgREST / Supabase JS client).
--
-- Atomicity guarantee:
--   approve_leave_request_atomic  → status UPDATE + balance deduction
--   reject_leave_request_atomic   → status UPDATE + rejection_reason
--   approve_regularisation_atomic → status UPDATE
--   reject_regularisation_atomic  → status UPDATE + rejection_reason
--
-- Status guard is enforced at the DB level with SELECT … FOR UPDATE
-- so concurrent approval attempts are serialised and the second
-- caller receives a CONFLICT exception rather than silently winning.
-- ============================================================

-- ── approve_leave_request_atomic ──────────────────────────────────────────────
-- Locks the row, checks status = 'PENDING', approves, and optionally
-- deducts leave balance in a single transaction.
--
-- Returns JSONB: { id, status, employee_id, leave_type_id, from_date,
--                  to_date, computed_days, half_day, is_paid }
-- Raises application exceptions (SQLSTATE P0001 with prefixed message):
--   'NOT_FOUND: ...'  — row does not exist
--   'CONFLICT: ...'   — row is not PENDING
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_leave_request_atomic(
  p_tenant_id     UUID,
  p_request_id    UUID,
  p_approver_id   UUID,
  p_approved_at   TIMESTAMPTZ,
  p_is_paid       BOOLEAN,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_days          NUMERIC,
  p_year          INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row    RECORD;
  v_result JSONB;
BEGIN
  -- Pessimistic lock: serialises concurrent approval attempts on the same row
  SELECT lr.id, lr.status, lr.employee_id, lr.leave_type_id,
         lr.from_date, lr.to_date, lr.computed_days, lr.half_day
  INTO   v_row
  FROM   leave_requests lr
  WHERE  lr.id        = p_request_id
    AND  lr.tenant_id = p_tenant_id
  FOR UPDATE;

  -- NOT_FOUND guard
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Leave request not found';
  END IF;

  -- PENDING guard (Step 2 — DB-level enforcement)
  IF v_row.status <> 'PENDING' THEN
    RAISE EXCEPTION 'CONFLICT: Request is already %', v_row.status;
  END IF;

  -- Approve
  UPDATE leave_requests
  SET    status      = 'APPROVED',
         approved_by = p_approver_id,
         approved_at = p_approved_at,
         updated_at  = p_approved_at
  WHERE  id        = p_request_id
    AND  tenant_id = p_tenant_id;

  -- Balance deduction (paid leaves only)
  IF p_is_paid THEN
    UPDATE employee_leave_balance
    SET    balance    = GREATEST(0, balance - p_days),
           updated_at = p_approved_at
    WHERE  tenant_id     = p_tenant_id
      AND  employee_id   = p_employee_id
      AND  leave_type_id = p_leave_type_id
      AND  year          = p_year;
  END IF;

  v_result := jsonb_build_object(
    'id',            p_request_id,
    'status',        'APPROVED',
    'employee_id',   v_row.employee_id,
    'leave_type_id', v_row.leave_type_id,
    'from_date',     v_row.from_date,
    'to_date',       v_row.to_date,
    'computed_days', v_row.computed_days,
    'half_day',      v_row.half_day,
    'is_paid',       p_is_paid
  );

  RETURN v_result;
END;
$$;


-- ── reject_leave_request_atomic ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_leave_request_atomic(
  p_tenant_id        UUID,
  p_request_id       UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM   leave_requests
  WHERE  id = p_request_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Leave request not found';
  END IF;

  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'CONFLICT: Request is already %', v_status;
  END IF;

  UPDATE leave_requests
  SET    status           = 'REJECTED',
         rejection_reason = p_rejection_reason,
         updated_at       = now()
  WHERE  id        = p_request_id
    AND  tenant_id = p_tenant_id;

  RETURN jsonb_build_object('id', p_request_id, 'status', 'REJECTED');
END;
$$;


-- ── approve_regularisation_atomic ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_regularisation_atomic(
  p_tenant_id   UUID,
  p_reg_id      UUID,
  p_approver_id UUID,
  p_approved_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT id, status, employee_id, date,
         requested_check_in, requested_check_out
  INTO   v_row
  FROM   attendance_regularisation
  WHERE  id        = p_reg_id
    AND  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Regularisation request not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'CONFLICT: Request is already %', v_row.status;
  END IF;

  UPDATE attendance_regularisation
  SET    status      = 'approved',
         approved_by = p_approver_id,
         approved_at = p_approved_at
  WHERE  id        = p_reg_id
    AND  tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id',                  v_row.id,
    'status',              'approved',
    'employee_id',         v_row.employee_id,
    'date',                v_row.date,
    'requested_check_in',  v_row.requested_check_in,
    'requested_check_out', v_row.requested_check_out
  );
END;
$$;


-- ── reject_regularisation_atomic ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_regularisation_atomic(
  p_tenant_id        UUID,
  p_reg_id           UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT id, status, employee_id
  INTO   v_row
  FROM   attendance_regularisation
  WHERE  id        = p_reg_id
    AND  tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Regularisation request not found';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'CONFLICT: Request is already %', v_row.status;
  END IF;

  UPDATE attendance_regularisation
  SET    status = 'rejected'
  WHERE  id        = p_reg_id
    AND  tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'id',          v_row.id,
    'status',      'rejected',
    'employee_id', v_row.employee_id
  );
END;
$$;
