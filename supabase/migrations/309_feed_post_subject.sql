-- Migration 309: record the celebrated person on a feed post.
--
-- ESS 2.0 "Wish" flow: an employee wishes a colleague a happy birthday or work
-- anniversary from the context panel. The resulting feed post is typed
-- ('birthday' | 'anniversary') and now records WHO is being celebrated so the
-- Community feed can render "<author> wished <subject>" and surface it on the
-- subject's profile later.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded index.

ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS subject_employee UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feed_posts_subject
  ON feed_posts (tenant_id, subject_employee);
