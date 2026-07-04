-- =============================================================================
-- Migration 359: C5b — pulse_send_log for per-employee dedup
--
-- Phase C readiness: GATE-1 item C5b
--
-- Problem: the weekly mood-poll send loop iterates all active employees
-- serially. If the durable job is retried (timeout, crash, restart), the
-- whole loop re-runs from the top — employees who already received the poll
-- get it a second time.
--
-- Fix: pulse_send_log records a row per (pulse_question_id, employee_id)
-- when a send succeeds. On each run (initial or retry), successfully sent
-- employees are excluded from the remaining work. The UNIQUE constraint
-- makes insertion idempotent in the rare case of a double-send race.
--
-- Must be applied before Phase C load testing begins.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pulse_send_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  pulse_question_id   uuid        NOT NULL REFERENCES pulse_questions(id) ON DELETE CASCADE,
  employee_id         uuid        NOT NULL,
  sent_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (pulse_question_id, employee_id)
);

CREATE INDEX IF NOT EXISTS pulse_send_log_tenant_question_idx
  ON pulse_send_log (tenant_id, pulse_question_id);

COMMENT ON TABLE pulse_send_log IS
  'Tracks which employees have received a specific pulse poll question via WhatsApp. '
  'Used to skip already-sent employees on job retry, preventing duplicate messages.';
