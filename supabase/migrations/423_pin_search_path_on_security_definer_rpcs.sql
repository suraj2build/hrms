-- ═══════════════════════════════════════════════════════════════
-- 423 — Pin search_path on the remaining tenant-parameterized
--        SECURITY DEFINER RPC functions
--
-- SYSCERT_AUDIT_2026-08-02.md PEND-102: companion hardening to migration
-- 421's EXECUTE-grant lockdown. An unpinned search_path on a SECURITY
-- DEFINER function lets a caller who can create objects in a schema
-- earlier in their own search_path shadow an unqualified reference
-- inside the function body (confused-deputy / trojan-object risk) —
-- migration 380 already established the fix for one function
-- (`SET search_path = public`, matching Postgres's own recommended
-- hardening for SECURITY DEFINER functions); this migration applies the
-- identical pin to every other tenant-parameterized SECURITY DEFINER
-- RPC that was still missing it.
--
-- ALTER FUNCTION ... SET search_path only changes the function's proconfig
-- entry — it does not touch the function body or any EXECUTE grants, so
-- this cannot regress anything migrations 282/286/396/404/409/410/412-415/
-- 421/422 already established for these same functions.
--
-- Already pinned (excluded — no change needed): get_active_employees_for_payroll
-- (380), enqueue_background_job (383), acquire_attendance_advisory_lock and
-- release_attendance_advisory_lock (023).
-- ═══════════════════════════════════════════════════════════════

ALTER FUNCTION deduct_leave_balance(UUID, UUID, UUID, NUMERIC, INT) SET search_path = public;
ALTER FUNCTION approve_leave_request_atomic(UUID, UUID, UUID, TIMESTAMPTZ, BOOLEAN, UUID, UUID, NUMERIC, INT) SET search_path = public;
ALTER FUNCTION reject_leave_request_atomic(UUID, UUID, TEXT) SET search_path = public;
ALTER FUNCTION approve_regularisation_atomic(UUID, UUID, UUID, TIMESTAMPTZ) SET search_path = public;
ALTER FUNCTION reject_regularisation_atomic(UUID, UUID, TEXT) SET search_path = public;
ALTER FUNCTION is_period_locked(UUID, TEXT) SET search_path = public;
ALTER FUNCTION credit_leave_balance(UUID, UUID, UUID, NUMERIC, INT) SET search_path = public;
ALTER FUNCTION recompute_leave_balance(UUID, UUID, UUID, INT) SET search_path = public;
ALTER FUNCTION checked_deduct_leave_balance(UUID, UUID, UUID, NUMERIC, INT) SET search_path = public;
ALTER FUNCTION set_opening_balance(UUID, UUID, UUID, NUMERIC, INT) SET search_path = public;
ALTER FUNCTION reverse_leave_request_atomic(UUID, UUID, UUID, BOOLEAN, UUID, UUID, NUMERIC, INT) SET search_path = public;
ALTER FUNCTION search_policies(UUID, TEXT, INT) SET search_path = public;
ALTER FUNCTION check_duplicate_active_compensations(UUID) SET search_path = public;
ALTER FUNCTION record_loan_payment_atomic(UUID, UUID, NUMERIC) SET search_path = public;
ALTER FUNCTION delete_salary_component_atomic(UUID, UUID) SET search_path = public;
ALTER FUNCTION delete_position_atomic(UUID, UUID) SET search_path = public;
ALTER FUNCTION set_primary_emergency_contact_atomic(UUID, UUID, UUID) SET search_path = public;
ALTER FUNCTION register_talent_interest_atomic(UUID, UUID, UUID, TEXT, TEXT[], TEXT, TEXT) SET search_path = public;
ALTER FUNCTION reassign_manager_atomic(UUID, UUID, UUID, INT) SET search_path = public;
ALTER FUNCTION reassign_department_parent_atomic(UUID, UUID, UUID, INT) SET search_path = public;
ALTER FUNCTION get_all_subordinates(UUID, UUID, INT) SET search_path = public;
ALTER FUNCTION seed_states_for_tenant(UUID) SET search_path = public;
