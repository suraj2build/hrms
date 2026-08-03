-- ═══════════════════════════════════════════════════════════════
-- 424 — Pin search_path on the remaining SECURITY DEFINER functions
--        migration 423 didn't cover
--
-- SYSCERT_AUDIT_2026-08-02.md follow-up to PEND-102 / migration 423.
-- 423 scoped itself to "tenant-parameterized RPCs" and deliberately
-- excluded the no-argument identity helpers and trigger functions —
-- but the search_path-hijack risk applies to those too, and the three
-- identity helpers below are the highest-exposure case in the whole
-- database: they're invoked inside nearly every RLS policy on nearly
-- every authenticated query, and are never REVOKEd from PUBLIC/
-- authenticated, so they're directly callable as
-- POST /rest/v1/rpc/get_user_tenant_id (etc.) by any authenticated
-- tenant user. If the `authenticated` role retains CREATE on the
-- public schema, an unpinned search_path here would let an attacker
-- shadow `profiles` to make these functions return an arbitrary
-- tenant_id/role/employee_id — defeating RLS tenant isolation
-- platform-wide.
--
-- fn_audit_master_change / trg_seed_states_after_tenant_insert are
-- trigger functions (not directly RPC-callable) but carry the same
-- SECURITY DEFINER + unqualified-reference risk on ordinary DML, so
-- get the same pin for defense-in-depth.
--
-- ALTER FUNCTION ... SET search_path only changes the function's
-- proconfig entry — it does not touch the function body or any
-- EXECUTE grants, so this cannot regress anything migrations 007/265/
-- 273/418/421/423 already established for these functions.
-- ═══════════════════════════════════════════════════════════════

ALTER FUNCTION get_user_tenant_id() SET search_path = public;
ALTER FUNCTION get_user_role() SET search_path = public;
ALTER FUNCTION get_user_employee_id() SET search_path = public;
ALTER FUNCTION fn_audit_master_change() SET search_path = public;
ALTER FUNCTION trg_seed_states_after_tenant_insert() SET search_path = public;
