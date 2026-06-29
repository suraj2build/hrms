-- Migration 323: Absconding Case Management
-- Creates absconding_cases and absconding_communications tables
-- with state machine, communication log, and supporting indexes.

-- ── Main case table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS absconding_cases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- State machine
  status                  TEXT NOT NULL DEFAULT 'flagged'
                          CHECK (status IN (
                            'flagged',              -- Day 3: case created, HR notified
                            'wl1_sent',             -- Day 7: Warning Letter 1 dispatched
                            'wl2_sent',             -- Day 14: Warning Letter 2 dispatched
                            'termination_pending',  -- Day 21: awaiting CHRO approval
                            'terminated',           -- Approved: separation record created
                            'resolved',             -- Employee returned / situation clarified
                            'closed'                -- Manually closed without termination
                          )),

  -- UA day tracking
  first_ua_date           DATE NOT NULL,
  last_ua_date            DATE,
  ua_days_count           INT NOT NULL DEFAULT 1,

  -- Letter references
  wl1_sent_at             TIMESTAMPTZ,
  wl1_letter_id           UUID,
  wl2_sent_at             TIMESTAMPTZ,
  wl2_letter_id           UUID,
  termination_letter_id   UUID,

  -- Employee response
  employee_response       TEXT,
  employee_response_at    TIMESTAMPTZ,
  response_channel        TEXT CHECK (response_channel IN ('email','whatsapp','in_person','letter','phone')),

  -- CHRO approval flow
  chro_approval_required  BOOLEAN NOT NULL DEFAULT FALSE,
  chro_approved_by        UUID REFERENCES profiles(id),
  chro_approved_at        TIMESTAMPTZ,
  chro_remarks            TEXT,

  -- Outcome
  resolved_reason         TEXT,
  separation_id           UUID,   -- populated after termination → employee_separation.id

  -- Assignment
  assigned_to             UUID REFERENCES profiles(id),

  -- Audit
  notes                   TEXT,
  created_by              UUID NOT NULL REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Communication log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS absconding_communications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES absconding_cases(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  comm_type   TEXT NOT NULL CHECK (comm_type IN (
                'letter_generated', 'email_sent', 'whatsapp_sent',
                'call_attempted', 'employee_response', 'hr_note', 'system_event'
              )),
  direction   TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound', 'internal')),
  subject     TEXT,
  body        TEXT,
  channel     TEXT,
  sent_by     UUID REFERENCES profiles(id),
  letter_id   UUID,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_absconding_cases_tenant_status
  ON absconding_cases(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_absconding_cases_employee
  ON absconding_cases(employee_id);

CREATE INDEX IF NOT EXISTS idx_absconding_cases_tenant_created
  ON absconding_cases(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_absconding_communications_case
  ON absconding_communications(case_id, created_at DESC);

-- ── Trigger: updated_at ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_absconding_cases_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_absconding_cases_updated_at ON absconding_cases;
CREATE TRIGGER trg_absconding_cases_updated_at
  BEFORE UPDATE ON absconding_cases
  FOR EACH ROW EXECUTE FUNCTION update_absconding_cases_updated_at();
