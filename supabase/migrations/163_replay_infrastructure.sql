/**
 * Migration 163 — Deterministic Replay & Historical Reconstruction Infrastructure
 *
 * Phase 2 of Enterprise Governance Consolidation.
 *
 * Adds:
 *   A. leave_policy_snapshots     — immutable point-in-time policy state storage
 *   B. retroactive_rebuild_queue  — orchestration table for rebuild events
 *   C. leave_accrual_ledger columns: snapshot_id, lineage_id, parent_replay_id, cycle_key
 *   D. leave_balance_ledger columns: snapshot_id, lineage_id
 *   E. leave_requests column: policy_snapshot_id
 *   F. leave_job_log extensions: lineage_id, replay_reason (if not already added),
 *                                 trigger_type constraint expansion
 *
 * NO existing data is modified.
 * All additions are backwards-compatible (nullable or defaulted).
 * NO external behavior changes.
 */

-- =============================================================================
-- A. leave_policy_snapshots — immutable policy state
-- =============================================================================
--
-- Captures the exact policy configuration that governed a governance action
-- (leave creation, accrual, carry-forward, lifecycle release, etc.).
--
-- Once written, this row must NEVER be updated or deleted (immutable contract).
-- The snapshot_id FK on ledger entries and leave_requests ties every decision
-- back to the exact policy version that was in effect.
--
-- source_type differentiates:
--   'policy_rule'     — resolved from leave_policy_rules (named policy engine)
--   'legacy_policy'   — resolved from leave_policies (pre-054 legacy table)
--   'default_policy'  — no configuration; the engine's built-in DEFAULT_POLICY

CREATE TABLE IF NOT EXISTS leave_policy_snapshots (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,

  -- Source identification (nullable so legacy/default cases can still snapshot)
  source_type               TEXT          NOT NULL
    CHECK (source_type IN ('policy_rule', 'legacy_policy', 'default_policy')),
  policy_rule_id            UUID          REFERENCES leave_policy_rules(id)   ON DELETE SET NULL,
  policy_master_id          UUID          REFERENCES leave_policy_masters(id) ON DELETE SET NULL,
  leave_type_id             UUID          REFERENCES leave_types(id)          ON DELETE CASCADE,

  -- Resolution metadata
  resolved_for_employee_id  UUID          REFERENCES employees(id)            ON DELETE CASCADE,
  resolved_as_of            DATE          NOT NULL,
  resolution_scope          TEXT          NOT NULL DEFAULT 'unknown'
    CHECK (resolution_scope IN (
      'employee', 'department', 'work_location', 'site', 'default', 'legacy', 'builtin'
    )),
  engine_version            TEXT          NOT NULL DEFAULT 'v1',

  -- What triggered this snapshot
  trigger_event             TEXT          NOT NULL
    CHECK (trigger_event IN (
      'leave_request_creation',
      'accrual_execution',
      'carry_forward_execution',
      'lifecycle_release',
      'freeze_application',
      'settlement_recovery',
      'reconciliation_adjustment',
      'replay_reconstruction',
      'manual_capture'
    )),
  trigger_entity_id         UUID,         -- leave_request_id, job_log_id, etc.
  trigger_entity_type       TEXT
    CHECK (trigger_entity_type IS NULL OR trigger_entity_type IN (
      'leave_request', 'job_log', 'reconciliation_run', 'manual', 'rebuild_queue'
    )),

  -- Immutable policy state (full snapshot as JSONB — never modify after insert)
  policy_snapshot           JSONB         NOT NULL,

  -- Soft-immutability marker — application layer should enforce this
  is_immutable              BOOLEAN       NOT NULL DEFAULT true,

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now()

  -- NOTE: intentionally no updated_at — snapshots are write-once
);

-- Lookup by employee × leave type × date (most common pattern)
CREATE INDEX IF NOT EXISTS idx_lps_employee_type_date
  ON leave_policy_snapshots (tenant_id, resolved_for_employee_id, leave_type_id, resolved_as_of DESC);

-- Lookup by trigger entity (attach snapshot to a leave request or job)
CREATE INDEX IF NOT EXISTS idx_lps_trigger_entity
  ON leave_policy_snapshots (trigger_entity_type, trigger_entity_id)
  WHERE trigger_entity_id IS NOT NULL;

-- Policy rule coverage check (find all snapshots for a rule version)
CREATE INDEX IF NOT EXISTS idx_lps_policy_rule
  ON leave_policy_snapshots (policy_rule_id)
  WHERE policy_rule_id IS NOT NULL;

ALTER TABLE leave_policy_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lps_tenant_read" ON leave_policy_snapshots FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "lps_hr_write" ON leave_policy_snapshots FOR INSERT
  WITH CHECK (get_user_role() IN ('super_admin', 'hr_admin'));

-- Service-role inserts (scheduler) bypass RLS — no INSERT policy needed for service key.

-- =============================================================================
-- B. retroactive_rebuild_queue — orchestration for retroactive rebuilds
-- =============================================================================
--
-- When a governance event occurs retroactively (leave approved after the fact,
-- attendance corrected, policy changed back-dated), this queue tracks:
--   - What triggered the rebuild
--   - Which employee + date range is affected
--   - Which modules must be rebuilt (in order)
--   - The current processing status
--
-- Idempotency: the idempotency_key UNIQUE constraint prevents duplicate rebuild
-- requests for the same source event.

CREATE TABLE IF NOT EXISTS retroactive_rebuild_queue (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,

  -- Source event
  source_event_type     TEXT          NOT NULL
    CHECK (source_event_type IN (
      'leave_approved',
      'leave_cancelled',
      'leave_rejected',
      'attendance_correction',
      'payroll_adjustment',
      'policy_change',
      'balance_correction',
      'scheduler_recovery',
      'replay_requested',
      'manual_trigger'
    )),
  source_event_id       UUID          NOT NULL,

  -- Affected entities
  employee_id           UUID          REFERENCES employees(id)           ON DELETE CASCADE,
  leave_type_id         UUID          REFERENCES leave_types(id)         ON DELETE SET NULL,

  -- Rebuild span
  rebuild_from_date     DATE          NOT NULL,
  rebuild_to_date       DATE,          -- NULL = open-ended (to today)

  -- Ordered list of modules to rebuild: ['attendance', 'leave_balance', 'payroll']
  -- Execution order matters — attendance must precede leave_balance which precedes payroll.
  affected_modules      TEXT[]        NOT NULL DEFAULT '{}',

  -- Priority (lower = higher priority): 1=critical, 5=normal, 10=background
  priority              INT           NOT NULL DEFAULT 5
    CHECK (priority BETWEEN 1 AND 10),

  -- Workflow status
  status                TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled', 'skipped')),

  -- Replay lineage: links to the replay engine execution that processed this entry
  replay_lineage_id     UUID,

  -- Retry semantics
  retry_count           INT           NOT NULL DEFAULT 0,
  max_retries           INT           NOT NULL DEFAULT 3,
  last_error            TEXT,

  -- Idempotency key — prevents duplicate rebuild requests for the same source event.
  -- Recommended format: '${source_event_type}|${source_event_id}'
  idempotency_key       TEXT          UNIQUE,

  -- Timing
  scheduled_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,

  created_by            UUID          REFERENCES profiles(id)            ON DELETE SET NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rrq_tenant_status_priority
  ON retroactive_rebuild_queue (tenant_id, status, priority, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_rrq_employee
  ON retroactive_rebuild_queue (tenant_id, employee_id, status)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rrq_source_event
  ON retroactive_rebuild_queue (source_event_type, source_event_id);

ALTER TABLE retroactive_rebuild_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rrq_hr_all" ON retroactive_rebuild_queue FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- =============================================================================
-- C. leave_accrual_ledger — add replay infrastructure columns
-- =============================================================================

-- snapshot_id: which policy snapshot governed this ledger entry
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS snapshot_id      UUID REFERENCES leave_policy_snapshots(id) ON DELETE SET NULL;

-- lineage_id: the execution batch that wrote this entry (UUID of the job run)
-- All entries from the same scheduler job share the same lineage_id.
-- This enables: "find all entries written by job run X" or "was this entry a replay?"
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS lineage_id       UUID;

-- parent_replay_id: if this entry was created as part of a replay reconstruction,
-- this is the lineage_id of the original entry being replayed.
-- NULL = original write; SET = replay-sourced write.
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS parent_replay_id UUID;

-- cycle_key: fully deterministic deduplication key for a specific accrual event.
-- Format: '{tenantId}:{employeeId}:{leaveTypeId}:{year}:{cycleDescriptor}:{accrualType}'
-- cycleDescriptor: 'YYYY-MM' for monthly, 'YYYY' for yearly, 'YYYY-QN' for quarterly, etc.
-- NULL for manual adjustments and corrections where no natural cycle applies.
-- The partial unique index enforces: no two rows can share the same cycle_key (when set).
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS cycle_key        TEXT;

-- Partial unique index: enforces idempotency when cycle_key is provided.
-- 'ignoreDuplicates: true' in upsert operations relies on this.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_lal_cycle_key
  ON leave_accrual_ledger (cycle_key)
  WHERE cycle_key IS NOT NULL;

-- Index for lineage lookups (find all entries in a batch)
CREATE INDEX IF NOT EXISTS idx_lal_lineage_id
  ON leave_accrual_ledger (lineage_id)
  WHERE lineage_id IS NOT NULL;

-- Index for snapshot coverage (find all entries governed by a specific snapshot)
CREATE INDEX IF NOT EXISTS idx_lal_snapshot_id
  ON leave_accrual_ledger (snapshot_id)
  WHERE snapshot_id IS NOT NULL;

-- =============================================================================
-- D. leave_balance_ledger — add replay infrastructure columns
-- =============================================================================

-- snapshot_id: policy snapshot that governed this event grant or ledger credit
ALTER TABLE leave_balance_ledger
  ADD COLUMN IF NOT EXISTS snapshot_id      UUID REFERENCES leave_policy_snapshots(id) ON DELETE SET NULL;

-- lineage_id: the execution batch that wrote this entry
ALTER TABLE leave_balance_ledger
  ADD COLUMN IF NOT EXISTS lineage_id       UUID;

CREATE INDEX IF NOT EXISTS idx_lbl_snapshot_id
  ON leave_balance_ledger (snapshot_id)
  WHERE snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lbl_lineage_id
  ON leave_balance_ledger (lineage_id)
  WHERE lineage_id IS NOT NULL;

-- =============================================================================
-- E. leave_requests — add policy_snapshot_id
-- =============================================================================
--
-- Links a leave request to the exact policy snapshot that was active at the time
-- of submission. Enables deterministic replay: "what policy governed this request?"

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS policy_snapshot_id UUID REFERENCES leave_policy_snapshots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lr_policy_snapshot
  ON leave_requests (policy_snapshot_id)
  WHERE policy_snapshot_id IS NOT NULL;

-- =============================================================================
-- F. leave_job_log — ensure replay columns exist
-- =============================================================================
--
-- replay_reason and trigger_type were added in earlier migrations, but we ensure
-- lineage_id exists for cross-referencing with ledger entries.

ALTER TABLE leave_job_log
  ADD COLUMN IF NOT EXISTS lineage_id UUID;

-- Ensure trigger_type constraint covers all required values (extend if needed)
ALTER TABLE leave_job_log
  DROP CONSTRAINT IF EXISTS leave_job_log_trigger_type_check;

ALTER TABLE leave_job_log
  ADD CONSTRAINT leave_job_log_trigger_type_check
    CHECK (trigger_type IS NULL OR trigger_type IN (
      'scheduler', 'manual_replay', 'recovery', 'dry_run', 'api', 'retroactive_rebuild'
    ));

-- Ensure job_type constraint covers yearly_accrual (used in leave-jobs.ts)
ALTER TABLE leave_job_log
  DROP CONSTRAINT IF EXISTS leave_job_log_job_type_check;

ALTER TABLE leave_job_log
  ADD CONSTRAINT leave_job_log_job_type_check
    CHECK (job_type IN (
      'monthly_accrual',
      'yearly_accrual',
      'co_expiry',
      'carry_forward',
      'policy_recalculate',
      'event_grant',
      'lifecycle_release',
      'settlement_recovery'
    ));

CREATE INDEX IF NOT EXISTS idx_ljl_lineage_id
  ON leave_job_log (lineage_id)
  WHERE lineage_id IS NOT NULL;

COMMENT ON TABLE leave_policy_snapshots IS
  'Immutable point-in-time snapshots of the leave policy that governed each governance action. Write-once — never update or delete rows from this table.';

COMMENT ON TABLE retroactive_rebuild_queue IS
  'Orchestration queue for retroactive module rebuilds. When a governance event occurs retroactively (leave approved late, attendance corrected, policy back-dated), entries here track what modules need rebuilding and in what order.';

COMMENT ON COLUMN leave_accrual_ledger.cycle_key IS
  'Fully deterministic deduplication key. Format: {tenantId}:{employeeId}:{leaveTypeId}:{year}:{cycleDescriptor}:{accrualType}. NULL for non-cyclical entries. Partial unique index enforces no duplicate credits for the same cycle.';

COMMENT ON COLUMN leave_accrual_ledger.lineage_id IS
  'UUID of the scheduler job run that wrote this entry. All entries from the same job share this ID, enabling audit of what a single run produced.';

COMMENT ON COLUMN leave_accrual_ledger.parent_replay_id IS
  'Lineage ID of the original execution this entry is replaying. NULL = original; SET = replay-sourced. Enables replay drift detection.';
