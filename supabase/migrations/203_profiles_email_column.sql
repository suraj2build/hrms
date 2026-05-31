-- ═══════════════════════════════════════════════════════════════════════════
--  203_profiles_email_column.sql
--
--  Adds a denormalised `email` column to profiles so the owner panel
--  can list tenant admin accounts without N+1 calls to auth.users.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill from auth.users for any existing rows
UPDATE profiles p
SET    email = u.email
FROM   auth.users u
WHERE  p.id = u.id
  AND  p.email IS NULL;

-- Index for owner-panel lookups (duplicate-email detection per tenant)
CREATE INDEX IF NOT EXISTS idx_profiles_email_tenant ON profiles(email, tenant_id);
