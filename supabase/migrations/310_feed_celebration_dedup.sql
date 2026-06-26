-- Migration 310: race-safe dedup for auto-generated celebration posts.
--
-- The celebration generator (lib/community-celebrations.ts) may run from two
-- concurrent reads (Home + Community both load on app start). This partial
-- unique index guarantees at most ONE system-authored celebration post per
-- person, per type, per day — so a race can't double-post.
--
-- Scoped to author_employee IS NULL (system posts only) so it NEVER blocks a
-- personal "Wish" (those carry author_employee). The day key uses a UTC cast so
-- the index expression is IMMUTABLE (timestamptz::date is not).
--
-- Idempotent: IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_auto_celebration
  ON feed_posts (
    tenant_id,
    type,
    subject_employee,
    ((created_at AT TIME ZONE 'UTC')::date)
  )
  WHERE author_employee IS NULL
    AND subject_employee IS NOT NULL
    AND type IN ('birthday', 'anniversary');
