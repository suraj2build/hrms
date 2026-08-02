-- ═══════════════════════════════════════════════════════════════
-- 421 — Lock down SECURITY DEFINER RPC EXECUTE grants
--
-- SYSCERT_AUDIT_2026-08-02.md C9 / DB-1: SECURITY DEFINER functions run with
-- the privileges of their owner, bypassing RLS the same way the service-role
-- key does. Postgres grants EXECUTE to PUBLIC (i.e. both anon and
-- authenticated) by default on function creation, and none of these
-- functions independently verify the caller's session actually belongs to
-- the p_tenant_id they're passed. 380_get_active_employees_for_payroll.sql
-- already establishes the correct pattern (REVOKE from anon/authenticated,
-- GRANT to service_role only — apps/api/src/plugins/supabase.ts confirms
-- fastify.supabase always uses SUPABASE_SERVICE_ROLE_KEY, so every
-- legitimate call site is unaffected) but it was applied to only 3 of the
-- ~30 SECURITY DEFINER functions in this migration history. This migration
-- extends it to every remaining tenant-parameterized one, closing a direct
-- cross-tenant RBAC/RLS bypass reachable by any authenticated user via
-- PostgREST (POST /rest/v1/rpc/<function_name>) with a guessed/enumerated
-- tenant UUID.
--
-- Deliberately NOT touched here (out of scope for this fix):
--   * Trigger functions (log_employee_changes, fn_audit_master_change,
--     trg_seed_states_after_tenant_insert) — RETURNS TRIGGER functions have
--     no callable argument signature and are not exposed by PostgREST.
--   * get_user_tenant_id()/get_user_role()/get_user_employee_id() — no
--     tenant_id parameter; these derive the CALLER's own identity from
--     auth.uid() and are relied on by RLS policies themselves, so they must
--     stay executable by authenticated.
--   * acquire_attendance_advisory_lock/release_attendance_advisory_lock
--     (022/023) — already explicitly, deliberately GRANTed to authenticated;
--     changing that is a separate product decision, not part of this fix.
-- ═══════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION deduct_leave_balance(UUID, UUID, UUID, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION deduct_leave_balance(UUID, UUID, UUID, NUMERIC, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, NUMERIC, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION reject_leave_request_atomic(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reject_leave_request_atomic(UUID, UUID, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION approve_regularisation_atomic(UUID, UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION approve_regularisation_atomic(UUID, UUID, UUID, TIMESTAMPTZ)
  TO service_role;

REVOKE EXECUTE ON FUNCTION reject_regularisation_atomic(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reject_regularisation_atomic(UUID, UUID, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION is_period_locked(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION is_period_locked(UUID, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION credit_leave_balance(UUID, UUID, UUID, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION credit_leave_balance(UUID, UUID, UUID, NUMERIC, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION recompute_leave_balance(UUID, UUID, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION recompute_leave_balance(UUID, UUID, UUID, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION checked_deduct_leave_balance(UUID, UUID, UUID, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION checked_deduct_leave_balance(UUID, UUID, UUID, NUMERIC, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION set_opening_balance(UUID, UUID, UUID, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION set_opening_balance(UUID, UUID, UUID, NUMERIC, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, NUMERIC, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, NUMERIC, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION search_policies(UUID, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION search_policies(UUID, TEXT, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION check_duplicate_active_compensations(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_duplicate_active_compensations(UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION record_loan_payment_atomic(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION record_loan_payment_atomic(UUID, UUID, NUMERIC)
  TO service_role;

REVOKE EXECUTE ON FUNCTION delete_salary_component_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION delete_salary_component_atomic(UUID, UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION delete_position_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION delete_position_atomic(UUID, UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION set_primary_emergency_contact_atomic(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION set_primary_emergency_contact_atomic(UUID, UUID, UUID)
  TO service_role;

REVOKE EXECUTE ON FUNCTION register_talent_interest_atomic(UUID, UUID, UUID, TEXT, TEXT[], TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION register_talent_interest_atomic(UUID, UUID, UUID, TEXT, TEXT[], TEXT, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION reassign_manager_atomic(UUID, UUID, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reassign_manager_atomic(UUID, UUID, UUID, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION reassign_department_parent_atomic(UUID, UUID, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reassign_department_parent_atomic(UUID, UUID, UUID, INT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION get_all_subordinates(UUID, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_all_subordinates(UUID, UUID, INT)
  TO service_role;
