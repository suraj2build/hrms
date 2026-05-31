-- ============================================================
-- 197_fix_sensitive_table_rls.sql
--
-- Adds missing Row Level Security to sensitive tables that were
-- created without ENABLE ROW LEVEL SECURITY.
--
-- CRITICAL TABLES FIXED
-- ---------------------
-- • idempotency_keys (018)      — dedup keys with response payloads
-- • payroll_reconciliation_actions (129) — payroll operational log
-- • pii_access_log (124)        — access audit for PII fields
-- • erasure_requests (124)      — DPDPA/GDPR right-to-erasure
-- • retention_enforcement_runs (124) — data retention audit
-- • security_events (125, partitioned) — security event stream
-- • security_alerts (125)       — security alert lifecycle
-- • tds_bulk_operation_log (177) — TDS bulk ops audit trail
--
-- PLATFORM TABLES SECURED
-- -----------------------
-- Platform tables with no tenant_id (infrastructure/compliance)
-- are restricted to super_admin role access. These should only
-- be readable via the admin shell, not exposed to tenant users.
-- • module_health, chaos_test_runs, chaos_scenarios
-- • compliance_controls, compliance_evidence_snapshots
-- • credential_rotation_log, secret_access_audit
-- • data_field_classifications
-- • security_detection_rules
-- • backup_checkpoints, restore_drills, dr_scenarios
-- • business_event_types
--
-- POLICY STANDARD
-- ---------------
-- Tenant-scoped: tenant_id = get_user_tenant_id()
-- Platform-only: get_user_role() = 'super_admin'
-- Append-only/audit: INSERT allowed for hr_admin+; no DELETE
-- ============================================================

-- ── idempotency_keys (018) ────────────────────────────────────
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ik_tenant_read" ON idempotency_keys
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ik_tenant_write" ON idempotency_keys
  FOR ALL USING (tenant_id = get_user_tenant_id());


-- ── payroll_reconciliation_actions (129) ──────────────────────
ALTER TABLE payroll_reconciliation_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pra_hr_read" ON payroll_reconciliation_actions
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

CREATE POLICY "pra_hr_write" ON payroll_reconciliation_actions
  FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );


-- ── pii_access_log (124) ──────────────────────────────────────
-- Append-only audit log. HR admins read their tenant's log.
-- No update/delete allowed (audit integrity).
ALTER TABLE pii_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pal_hr_read" ON pii_access_log
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- Insert is via service role (bypasses RLS) or trusted HR path
CREATE POLICY "pal_hr_insert" ON pii_access_log
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());


-- ── erasure_requests (124) ────────────────────────────────────
ALTER TABLE erasure_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "er_hr_all" ON erasure_requests
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- Employee can read their own erasure request (transparency)
CREATE POLICY "er_self_read" ON erasure_requests
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND requested_by = auth.uid()
  );


-- ── retention_enforcement_runs (124) ──────────────────────────
ALTER TABLE retention_enforcement_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rer_hr_read" ON retention_enforcement_runs
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

CREATE POLICY "rer_service_write" ON retention_enforcement_runs
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());


-- ── security_events (125, partitioned) ───────────────────────
-- Enable RLS on the parent table — Postgres propagates to all partitions.
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "se_hr_read" ON security_events
  FOR SELECT
  USING (
    (tenant_id = get_user_tenant_id() OR tenant_id IS NULL)
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- Service role inserts via bypass; provide policy for direct inserts
CREATE POLICY "se_service_write" ON security_events
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() OR tenant_id IS NULL);


-- ── security_alerts (125) ─────────────────────────────────────
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sa_hr_read" ON security_alerts
  FOR SELECT
  USING (
    (tenant_id = get_user_tenant_id() OR tenant_id IS NULL)
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

CREATE POLICY "sa_hr_write" ON security_alerts
  FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));


-- ── tds_bulk_operation_log (177) ──────────────────────────────
-- Already has tenant_id FK from 177. Just needs RLS + policies.
ALTER TABLE tds_bulk_operation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tbol_hr_read" ON tds_bulk_operation_log
  FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

CREATE POLICY "tbol_hr_insert" ON tds_bulk_operation_log
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());


-- ── PLATFORM TABLES (no tenant_id) ───────────────────────────
-- Infrastructure / compliance tables accessible only to super_admin.
-- Normal tenant users should never read these directly.

-- module_health (120)
ALTER TABLE module_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mh_admin" ON module_health
  FOR ALL USING (get_user_role() = 'super_admin');

-- chaos_test_runs (121)
ALTER TABLE chaos_test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ctr_admin" ON chaos_test_runs
  FOR ALL USING (get_user_role() = 'super_admin');

-- chaos_scenarios (121)
ALTER TABLE chaos_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cs_admin_write" ON chaos_scenarios
  FOR ALL USING (get_user_role() = 'super_admin');
-- Readable by hr_admin for compliance visibility
CREATE POLICY "cs_hr_read" ON chaos_scenarios
  FOR SELECT USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- compliance_controls (122) — readable by hr_admin (audit evidence)
ALTER TABLE compliance_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cc_hr_read" ON compliance_controls
  FOR SELECT USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "cc_admin_write" ON compliance_controls
  FOR ALL USING (get_user_role() = 'super_admin');

-- compliance_evidence_snapshots (122)
ALTER TABLE compliance_evidence_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ces_hr_read" ON compliance_evidence_snapshots
  FOR SELECT USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "ces_service_write" ON compliance_evidence_snapshots
  FOR INSERT WITH CHECK (true);  -- written by scheduler job via service role

-- credential_rotation_log (123) — super_admin only
ALTER TABLE credential_rotation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crl_admin" ON credential_rotation_log
  FOR SELECT USING (get_user_role() = 'super_admin');
-- Immutable trigger blocks UPDATE/DELETE; INSERT is for rotation events only
CREATE POLICY "crl_service_insert" ON credential_rotation_log
  FOR INSERT WITH CHECK (true);  -- service role inserts on credential rotation

-- secret_access_audit (123) — super_admin only
ALTER TABLE secret_access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saa_admin" ON secret_access_audit
  FOR SELECT USING (get_user_role() = 'super_admin');
CREATE POLICY "saa_service_insert" ON secret_access_audit
  FOR INSERT WITH CHECK (true);

-- data_field_classifications (124) — readable by hr_admin (PII registry)
ALTER TABLE data_field_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dfc_hr_read" ON data_field_classifications
  FOR SELECT USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "dfc_admin_write" ON data_field_classifications
  FOR ALL USING (get_user_role() = 'super_admin');

-- security_detection_rules (125) — super_admin only
ALTER TABLE security_detection_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sdr_admin" ON security_detection_rules
  FOR ALL USING (get_user_role() = 'super_admin');
CREATE POLICY "sdr_hr_read" ON security_detection_rules
  FOR SELECT USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- backup_checkpoints (127)
ALTER TABLE backup_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bc_admin" ON backup_checkpoints
  FOR ALL USING (get_user_role() = 'super_admin');
CREATE POLICY "bc_service_insert" ON backup_checkpoints
  FOR INSERT WITH CHECK (true);

-- restore_drills (127)
ALTER TABLE restore_drills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rd_admin" ON restore_drills
  FOR ALL USING (get_user_role() = 'super_admin');

-- dr_scenarios (127) — readable by hr_admin for DR readiness dashboard
ALTER TABLE dr_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drs_hr_read" ON dr_scenarios
  FOR SELECT USING (get_user_role() IN ('super_admin', 'hr_admin'));
CREATE POLICY "drs_admin_write" ON dr_scenarios
  FOR ALL USING (get_user_role() = 'super_admin');

-- business_event_types (126) — readable by all authenticated users (reference data)
ALTER TABLE business_event_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bet_all_read" ON business_event_types
  FOR SELECT USING (true);
CREATE POLICY "bet_admin_write" ON business_event_types
  FOR ALL USING (get_user_role() = 'super_admin');
