-- Policy-driven login gate on tenants.
-- When allow_login = false the API auth plugin rejects all requests for that
-- tenant with 403 TENANT_LOGIN_DISABLED, regardless of individual credentials.
-- Supports: demo tenants, maintenance mode, suspended/disabled workspaces.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS allow_login BOOLEAN NOT NULL DEFAULT TRUE;

-- The public demo tenant is login-disabled (data exposure risk).
-- Re-enable only after isolating it to fixture-only data with no path to
-- production tenant data.
UPDATE tenants
SET allow_login = false
WHERE id = 'd0000000-0000-0000-0000-000000000001';
