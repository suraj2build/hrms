-- ============================================================
-- 280_unify_leave_tables.sql
--
-- Consolidates the legacy `leave_applications` table into the
-- canonical `leave_requests` table.
--
-- Background: the app historically had two parallel leave tables.
-- The modern ESS apply flow, approvals, attendance engine, manager
-- dashboard and analytics now ALL read/write `leave_requests`. This
-- migration backfills any rows that only ever lived in
-- `leave_applications` (e.g. created by the old /attendance/leave/apply
-- or bulk-assign paths) so no pending/approved leave is lost.
--
-- `leave_applications` is intentionally LEFT IN PLACE (now unused) so
-- this change is reversible. It can be dropped in a later migration
-- once the backfill is verified in production.
--
-- Mapping notes:
--   • status  lowercase  -> UPPERCASE  (pending|approved|rejected)
--   • computed_days       = whole-day span, or 0.5 for a half-day session
--   • half_day            = true when session is first_half / second_half
--   • requested_by (NOT NULL) -> approver, else the tenant's first
--                            HR/super admin profile (the only resolvable
--                            actor for legacy rows that lack a requester)
--   • APPROVED rows must carry approved_by + approved_at (lr CHECK), so
--     those are backfilled from created_at / the fallback profile.
--
-- Idempotent: the NOT EXISTS guard skips rows already present in
-- leave_requests, so re-running inserts nothing new.
-- ============================================================

INSERT INTO leave_requests (
  tenant_id, employee_id, leave_type_id, from_date, to_date,
  computed_days, half_day, status, reason,
  requested_by, approved_by, approved_at, created_at, session
)
SELECT
  la.tenant_id,
  la.employee_id,
  la.leave_type_id,
  la.from_date,
  la.to_date,
  CASE WHEN la.session IN ('first_half', 'second_half')
       THEN 0.5
       ELSE ((la.to_date - la.from_date) + 1)::numeric END,
  (la.session IN ('first_half', 'second_half')),
  upper(la.status),
  la.reason,
  COALESCE(la.approved_by, fb.profile_id),
  CASE WHEN upper(la.status) = 'APPROVED'
       THEN COALESCE(la.approved_by, fb.profile_id)
       ELSE la.approved_by END,
  CASE WHEN upper(la.status) = 'APPROVED'
       THEN COALESCE(la.approved_at, la.created_at)
       ELSE la.approved_at END,
  la.created_at,
  COALESCE(la.session, 'full_day')
FROM leave_applications la
LEFT JOIN LATERAL (
  SELECT p.id AS profile_id
  FROM profiles p
  WHERE p.tenant_id = la.tenant_id
  ORDER BY (p.role IN ('super_admin', 'hr_admin')) DESC, p.created_at
  LIMIT 1
) fb ON true
WHERE NOT EXISTS (
  SELECT 1 FROM leave_requests lr
  WHERE lr.tenant_id     = la.tenant_id
    AND lr.employee_id   = la.employee_id
    AND lr.leave_type_id = la.leave_type_id
    AND lr.from_date     = la.from_date
    AND lr.to_date       = la.to_date
)
-- requested_by is NOT NULL: only migrate rows where an actor is resolvable.
AND COALESCE(la.approved_by, fb.profile_id) IS NOT NULL;
