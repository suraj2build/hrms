/**
 * Migration 164 — Deterministic Cross-System Workforce State Engine
 *
 * Phase 3 of Enterprise Governance Consolidation.
 *
 * Adds:
 *   A. leave_reconciliation_issues — extend issue_type to include 'replay_drift'
 *   B. retroactive_rebuild_queue   — add orchestration columns:
 *        dependency_order, orchestrator_lineage_id, blocked_by_rebuild_id,
 *        rebuild_stage, rebuild_scope
 *   C. payroll_period_states       — governance freeze states for payroll periods
 *   D. attendance_processing_states — attendance lifecycle state authority
 *   E. workforce_rebuild_events    — retroactive orchestration event tracking
 *   F. workforce_event_timeline    — unified chronological governance history
 *   G. workforce_reconciliation_runs + workforce_reconciliation_issues
 *        — cross-module reconciliation extension
 *
 * NO existing data is modified.
 * All additions are backwards-compatible (nullable or defaulted).
 * NO external behavior changes.
 */

-- =============================================================================
-- A. Fix leave_reconciliation_issues — add replay_drift to constraint
-- =============================================================================
--
-- Phase 2 added 'replay_drift' to the TypeScript LeaveIssueType union and to
-- the leave-reconciliation.ts engine. The DB constraint must match or inserts
-- will fail with a check-violation error.

ALTER TABLE leave_reconciliation_issues
  DROP CONSTRAINT IF EXISTS leave_reconciliation_issues_issue_type_check;

ALTER TABLE leave_reconciliation_issues
  ADD CONSTRAINT leave_reconciliation_issues_issue_type_check
    CHECK (issue_type IN (
      'balance_drift',
      'missing_balance_row',
      'negative_balance',
      'orphan_balance_row',
      'expired_co_not_deducted',
      'future_expiry_risk',
      'replay_drift'
    ));

-- =============================================================================
-- B. retroactive_rebuild_queue — orchestration columns
-- =============================================================================
--
-- These columns support deterministic dependency-ordered execution of rebuild
-- chains coordinated by the workforce orchestrator.

-- dependency_order: execution position within a chain (1=first, higher=later)
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS dependency_order        INT         NOT NULL DEFAULT 0;

-- orchestrator_lineage_id: shared UUID across all rebuilds in one chain
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS orchestrator_lineage_id UUID;

-- blocked_by_rebuild_id: explicit dependency — this rebuild waits until the
-- referenced rebuild is 'completed' before it can be started.
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS blocked_by_rebuild_id   UUID
    REFERENCES retroactive_rebuild_queue(id)       ON DELETE SET NULL;

-- rebuild_stage: which part of the processing lifecycle this entry covers.
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS rebuild_stage           TEXT
    CHECK (rebuild_stage IS NULL OR rebuild_stage IN (
      'attendance', 'leave_balance', 'payroll', 'entitlement', 'reconciliation'
    ));

-- rebuild_scope: categorises the date span for prioritisation.
ALTER TABLE retroactive_rebuild_queue
  ADD COLUMN IF NOT EXISTS rebuild_scope           TEXT
    CHECK (rebuild_scope IS NULL OR rebuild_scope IN (
      'single_day', 'date_range', 'full_year', 'open_ended'
    ));

-- Index: find all entries in a shared orchestration chain
CREATE INDEX IF NOT EXISTS idx_rrq_orchestrator_lineage
  ON retroactive_rebuild_queue (orchestrator_lineage_id)
  WHERE orchestrator_lineage_id IS NOT NULL;

-- Index: find entries blocked by a specific predecessor
CREATE INDEX IF NOT EXISTS idx_rrq_blocked_by
  ON retroactive_rebuild_queue (blocked_by_rebuild_id)
  WHERE blocked_by_rebuild_id IS NOT NULL;

-- =============================================================================
-- C. payroll_period_states — payroll freeze governance
-- =============================================================================
--
-- Tracks the governance freeze state for each payroll period (tenant × month).
-- This is a separate layer ON TOP of payroll_runs — it enforces retroactive
-- mutation boundaries WITHOUT replacing the existing payroll run status machine.
--
-- States:
--   open               — retroactive rebuilds allowed (default)
--   payroll_processing — rebuild is queued but NOT executed (run in progress)
--   payroll_locked     — retroactive changes require an adjustment workflow
--   payroll_archived   — audit-only; no mutations permitted
--
-- The period_month column uses 'YYYY-MM' text format to match payroll_runs.month.

CREATE TABLE IF NOT EXISTS payroll_period_states (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,

  -- 'YYYY-MM' format — matches payroll_runs.month for easy join
  period_month      TEXT          NOT NULL
    CHECK (period_month ~ '^\d{4}-\d{2}$'),

  -- Optional link to the payroll run that triggered this state
  payroll_run_id    UUID          REFERENCES payroll_runs(id)        ON DELETE SET NULL,

  -- Governance state machine
  governance_state  TEXT          NOT NULL DEFAULT 'open'
    CHECK (governance_state IN (
      'open', 'payroll_processing', 'payroll_locked', 'payroll_archived'
    )),

  -- Lock audit
  locked_at         TIMESTAMPTZ,
  locked_by         UUID          REFERENCES profiles(id)            ON DELETE SET NULL,

  -- Archive audit
  archived_at       TIMESTAMPTZ,

  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_pps_tenant_month
  ON payroll_period_states (tenant_id, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_pps_tenant_state
  ON payroll_period_states (tenant_id, governance_state);

ALTER TABLE payroll_period_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pps_hr_all" ON payroll_period_states FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE payroll_period_states IS
  'Payroll freeze governance layer. Tracks whether retroactive rebuilds are allowed for each tenant×period. Does not replace payroll_runs — it adds orchestration boundaries on top.';

-- =============================================================================
-- D. attendance_processing_states — attendance lifecycle state authority
-- =============================================================================
--
-- Centralises the processing-state authority for each employee × date's
-- attendance data. Does NOT rewrite attendance_daily records — it augments them
-- with a state machine that the orchestrator and rebuild pipeline consult.
--
-- States:
--   raw            — unprocessed punch data, no reconstruction applied
--   reconstructed  — attendance calculated/corrected but not yet finalized
--   finalized      — attendance confirmed for this period (attendance finalisation)
--   payroll_locked — the period containing this date is locked for payroll
--   frozen         — immutable; no replay or retroactive mutations allowed
--   replay_pending — a retroactive rebuild is queued; data may be recomputed

CREATE TABLE IF NOT EXISTS attendance_processing_states (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  employee_id               UUID          NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,

  -- The calendar date this state applies to (named work_date to avoid SQL keyword clash)
  work_date                 DATE          NOT NULL,

  -- State machine
  state                     TEXT          NOT NULL DEFAULT 'raw'
    CHECK (state IN (
      'raw', 'reconstructed', 'finalized', 'payroll_locked', 'frozen', 'replay_pending'
    )),
  state_reason              TEXT,

  -- Link to the payroll period that locked this date (set when state = 'payroll_locked')
  payroll_period_state_id   UUID          REFERENCES payroll_period_states(id) ON DELETE SET NULL,

  -- Lineage link — which orchestration chain last transitioned this state
  orchestrator_lineage_id   UUID,

  transitioned_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_aps_employee_date
  ON attendance_processing_states (tenant_id, employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_aps_state
  ON attendance_processing_states (tenant_id, state, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_aps_orchestrator_lineage
  ON attendance_processing_states (orchestrator_lineage_id)
  WHERE orchestrator_lineage_id IS NOT NULL;

ALTER TABLE attendance_processing_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aps_hr_all" ON attendance_processing_states FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE attendance_processing_states IS
  'Authoritative attendance processing lifecycle state per employee × date. Consulted by the workforce orchestrator to determine replay eligibility and retroactive mutation boundaries.';

-- =============================================================================
-- E. workforce_rebuild_events — retroactive orchestration event tracking
-- =============================================================================
--
-- One row per orchestration chain. Tracks the full lifecycle of a coordinated
-- retroactive rebuild from initiation through completion of all downstream
-- modules. The orchestrator_lineage_id ties this to all retroactive_rebuild_queue
-- entries that belong to the same chain.

CREATE TABLE IF NOT EXISTS workforce_rebuild_events (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,

  -- Shared lineage across the entire rebuild chain
  orchestrator_lineage_id UUID          NOT NULL,

  -- The root retroactive_rebuild_queue entry that initiated this chain (if any)
  parent_rebuild_id       UUID          REFERENCES retroactive_rebuild_queue(id)   ON DELETE SET NULL,

  -- Source governance event that triggered this orchestration
  source_event_id         UUID          NOT NULL,
  source_event_type       TEXT          NOT NULL,

  -- Affected scope
  employee_id             UUID          REFERENCES employees(id)                   ON DELETE CASCADE,
  rebuild_from_date       DATE          NOT NULL,
  rebuild_to_date         DATE,

  -- Full ordered list of modules to rebuild (may include 'entitlement', 'reconciliation'
  -- in addition to the core RebuildModule values)
  downstream_modules      TEXT[]        NOT NULL DEFAULT '{}',

  -- How many times this chain has been replayed (1 = original run)
  replay_generation       INT           NOT NULL DEFAULT 1,

  rebuild_scope           TEXT
    CHECK (rebuild_scope IS NULL OR rebuild_scope IN (
      'single_day', 'date_range', 'full_year', 'open_ended'
    )),

  -- Chain orchestration status
  orchestration_status    TEXT          NOT NULL DEFAULT 'initiated'
    CHECK (orchestration_status IN (
      'initiated', 'sequencing', 'in_progress', 'completed', 'failed', 'cancelled'
    )),

  -- Progress tracking (filled in as each module completes / fails)
  completed_modules       TEXT[]        NOT NULL DEFAULT '{}',
  failed_modules          TEXT[]        NOT NULL DEFAULT '{}',

  -- Replay safety: stores cycle keys seen, idempotency guards, etc.
  replay_safety_markers   JSONB         NOT NULL DEFAULT '{}',

  notes                   TEXT,
  created_by              UUID          REFERENCES profiles(id)                    ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wre_tenant_status
  ON workforce_rebuild_events (tenant_id, orchestration_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wre_employee
  ON workforce_rebuild_events (tenant_id, employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wre_lineage
  ON workforce_rebuild_events (orchestrator_lineage_id);

CREATE INDEX IF NOT EXISTS idx_wre_source_event
  ON workforce_rebuild_events (source_event_type, source_event_id);

ALTER TABLE workforce_rebuild_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wre_hr_all" ON workforce_rebuild_events FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE workforce_rebuild_events IS
  'Orchestration event record for each coordinated retroactive rebuild chain. Tracks all downstream modules, completion progress, and replay lineage across attendance, leave, payroll, entitlement, and reconciliation.';

-- =============================================================================
-- F. workforce_event_timeline — unified chronological governance history
-- =============================================================================
--
-- Write-once event log. Every governance action that crosses module boundaries
-- is recorded here. This becomes the authoritative single source of truth for
-- "what happened to this employee's workforce state and when."
--
-- NOT yet surfaced in UI — Phase 3 establishes contracts and persistence only.

CREATE TABLE IF NOT EXISTS workforce_event_timeline (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,

  -- Which employee is affected (null for tenant-wide events)
  employee_id             UUID          REFERENCES employees(id)                   ON DELETE CASCADE,

  -- Event classification
  event_type              TEXT          NOT NULL
    CHECK (event_type IN (
      'leave_approved',
      'leave_cancelled',
      'retro_leave_approved',
      'attendance_rebuild',
      'attendance_finalized',
      'attendance_correction',
      'payroll_lock',
      'payroll_unlock',
      'payroll_archived',
      'entitlement_release',
      'freeze_application',
      'carry_forward',
      'reconciliation_repair',
      'scheduler_replay',
      'policy_change',
      'balance_correction',
      'retroactive_rebuild_queued',
      'retroactive_rebuild_completed'
    )),

  -- The calendar date this event is effective for (governance date, not created_at)
  event_date              DATE          NOT NULL,

  -- Which module produced this event
  source_module           TEXT          NOT NULL
    CHECK (source_module IN (
      'leave', 'attendance', 'payroll', 'entitlement',
      'reconciliation', 'scheduler', 'orchestrator'
    )),

  -- FK to the source entity (leave_request_id, attendance_daily_id, etc.)
  source_entity_id        UUID,
  source_entity_type      TEXT,

  -- Orchestration lineage — ties timeline entries to rebuild chains
  orchestrator_lineage_id UUID,
  rebuild_event_id        UUID          REFERENCES workforce_rebuild_events(id)    ON DELETE SET NULL,

  -- Arbitrary governance metadata (event-specific payload)
  payload                 JSONB         NOT NULL DEFAULT '{}',

  -- Replay chain linkage
  replay_reference_id     UUID,         -- points to the original event this replays
  replay_generation       INT           NOT NULL DEFAULT 1,

  created_by              UUID          REFERENCES profiles(id)                    ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
  -- NOTE: intentionally no updated_at — timeline entries are write-once
);

CREATE INDEX IF NOT EXISTS idx_wet_employee_date
  ON workforce_event_timeline (tenant_id, employee_id, event_date DESC)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wet_event_type_date
  ON workforce_event_timeline (tenant_id, event_type, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_wet_lineage
  ON workforce_event_timeline (orchestrator_lineage_id)
  WHERE orchestrator_lineage_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wet_rebuild_event
  ON workforce_event_timeline (rebuild_event_id)
  WHERE rebuild_event_id IS NOT NULL;

ALTER TABLE workforce_event_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wet_hr_read" ON workforce_event_timeline FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "wet_hr_insert" ON workforce_event_timeline FOR INSERT
  WITH CHECK (get_user_role() IN ('super_admin', 'hr_admin'));

-- Service-role inserts (orchestrator) bypass RLS — no INSERT policy needed for service key.

COMMENT ON TABLE workforce_event_timeline IS
  'Unified write-once governance event log. Records every cross-module workforce governance action with orchestration lineage for deterministic replay and audit trail.';

-- =============================================================================
-- G. workforce_reconciliation_runs + workforce_reconciliation_issues
-- =============================================================================
--
-- Cross-module reconciliation extension. Runs AFTER the existing per-module
-- reconciliation engines and validates orchestration-level integrity:
-- orphan rebuild chains, freeze-boundary violations, replay lineage corruption, etc.

CREATE TABLE IF NOT EXISTS workforce_reconciliation_runs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status                TEXT          NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  reconcile_year        INT           NOT NULL,
  triggered_by          UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  trigger_source        TEXT          NOT NULL DEFAULT 'api'
    CHECK (trigger_source IN ('api', 'scheduler', 'manual')),
  total_issues          INT           NOT NULL DEFAULT 0,
  issue_breakdown       JSONB         NOT NULL DEFAULT '{}',
  duration_ms           INT,
  error                 TEXT,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wrr_tenant_year
  ON workforce_reconciliation_runs (tenant_id, reconcile_year DESC, created_at DESC);

ALTER TABLE workforce_reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wrr_hr_all" ON workforce_reconciliation_runs FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Cross-module issues ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workforce_reconciliation_issues (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  UUID          NOT NULL REFERENCES workforce_reconciliation_runs(id) ON DELETE CASCADE,
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  issue_type              TEXT          NOT NULL
    CHECK (issue_type IN (
      'cross_module_replay_drift',
      'orphan_rebuild_chain',
      'freeze_boundary_violation',
      'replay_lineage_corruption',
      'retro_rebuild_incomplete',
      'attendance_payroll_mismatch'
    )),

  severity                TEXT          NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),

  -- Scope of the issue
  employee_id             UUID          REFERENCES employees(id)    ON DELETE CASCADE,
  rebuild_event_id        UUID          REFERENCES workforce_rebuild_events(id) ON DELETE SET NULL,
  orchestrator_lineage_id UUID,
  affected_modules        TEXT[]        NOT NULL DEFAULT '{}',
  affected_period         TEXT,         -- 'YYYY-MM' if period-specific

  -- Diagnostic data
  detail                  JSONB         NOT NULL DEFAULT '{}',
  suggestion              TEXT,

  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wri_run_id
  ON workforce_reconciliation_issues (run_id, severity);

CREATE INDEX IF NOT EXISTS idx_wri_tenant_type
  ON workforce_reconciliation_issues (tenant_id, issue_type, created_at DESC);

ALTER TABLE workforce_reconciliation_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wri_hr_all" ON workforce_reconciliation_issues FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

COMMENT ON TABLE workforce_reconciliation_runs IS
  'Cross-module reconciliation run metadata. Extends per-module reconciliation with orchestration-level integrity checks across attendance, leave, payroll, and rebuild chains.';

COMMENT ON TABLE workforce_reconciliation_issues IS
  'Cross-module reconciliation issues. Records orphan rebuild chains, freeze-boundary violations, replay lineage corruption, and other orchestration-level anomalies.';
