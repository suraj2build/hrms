-- =============================================================================
-- Migration 358: C6 — add 'queued' status to payroll_runs
--
-- Phase C readiness: GATE-1 item C6
--
-- Problem: POST /payroll/runs processes all employees synchronously inside
-- the HTTP handler. At 5,000 employees this takes 4-8 minutes, exceeding
-- every practical HTTP timeout (Cloudflare: 100s, Render/Supabase: 120s).
-- The response is a guaranteed 504 for any non-trivial tenant.
--
-- Fix: POST /payroll/runs now enqueues a 'payroll-run' durable job and
-- returns 202 immediately. The run row transitions:
--   queued → processing (job picked up) → draft/failed/partial_failed
--
-- This migration adds 'queued' to the CHECK constraint so the upsert
-- in the HTTP handler can set status='queued' without a constraint violation.
--
-- Must be applied before Phase C data seeding begins.
-- =============================================================================

ALTER TABLE payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check;

ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('queued', 'draft', 'processing', 'finalized', 'failed', 'partial_failed'));

COMMENT ON COLUMN payroll_runs.status IS
  'queued: accepted, waiting for durable-queue worker to start. '
  'processing: currently running. '
  'draft: computed, all employees succeeded, ready for finalization. '
  'partial_failed: computed, some employees failed — see payroll_run_events. '
  'failed: all employees failed or run aborted — no slips created. '
  'finalized: slips locked for disbursement — cannot be modified.';
