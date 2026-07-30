-- ============================================================
-- 416_feed_celebration_dedup_tenant_local.sql
--
-- PEND-27 (AUDIT_CONSTITUTION.md §14.6): the celebration dedup unique index
-- (migration 310) is keyed on `(created_at AT TIME ZONE 'UTC')::date`
-- because a plain `timestamptz::date` cast isn't IMMUTABLE under a
-- variable tenant timezone, so it couldn't be used in an index expression
-- directly. That UTC day-key doesn't match the tenant-local day the
-- generator (ensureTodaysCelebrations) actually computes via
-- fetchTenantTz()/getLocalDate() — for any tenant whose local day spans
-- UTC midnight (IST included), two calls racing within the same
-- tenant-local day but straddling UTC midnight get different index
-- day-keys, so the unique index fails to catch the duplicate.
--
-- Fix: a genuine tenant-local date needs the tenant's timezone, which an
-- index expression can't look up — so store it in a real column instead,
-- populated by a BEFORE INSERT trigger that joins tenants for the
-- timezone, and index that column. Only computed for the row shape the
-- dedup guard actually covers (system-authored birthday/anniversary
-- posts) — every other feed post leaves it NULL, matching the existing
-- partial index's scope.
-- ============================================================

ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS tenant_local_date DATE;

CREATE OR REPLACE FUNCTION set_feed_post_tenant_local_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  IF NEW.author_employee IS NULL
     AND NEW.subject_employee IS NOT NULL
     AND NEW.type IN ('birthday', 'anniversary') THEN
    SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM tenants WHERE id = NEW.tenant_id;
    NEW.tenant_local_date := (NEW.created_at AT TIME ZONE COALESCE(v_tz, 'UTC'))::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_posts_tenant_local_date ON feed_posts;
CREATE TRIGGER trg_feed_posts_tenant_local_date
  BEFORE INSERT ON feed_posts
  FOR EACH ROW
  EXECUTE FUNCTION set_feed_post_tenant_local_date();

-- Backfill existing auto-celebration rows so the new index has values to
-- enforce against (best-effort tenant-local approximation of history —
-- these rows already passed the old UTC-keyed dedup, so this is purely to
-- populate the column, not to re-validate past uniqueness).
UPDATE feed_posts fp
SET    tenant_local_date = (fp.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date
FROM   tenants t
WHERE  fp.tenant_id = t.id
  AND  fp.author_employee IS NULL
  AND  fp.subject_employee IS NOT NULL
  AND  fp.type IN ('birthday', 'anniversary')
  AND  fp.tenant_local_date IS NULL;

DROP INDEX IF EXISTS uniq_feed_auto_celebration;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_auto_celebration_tenant_local
  ON feed_posts (tenant_id, type, subject_employee, tenant_local_date)
  WHERE author_employee IS NULL
    AND subject_employee IS NOT NULL
    AND type IN ('birthday', 'anniversary');
