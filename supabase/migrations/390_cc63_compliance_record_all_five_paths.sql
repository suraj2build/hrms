-- ============================================================
-- 390_cc63_compliance_record_all_five_paths.sql
--
-- FIX (CRITICAL, ISSUE-136 / AF-001): the CC6.3 compliance record
-- (migration 122) claimed "IMPLEMENTED" citing only the terminal
-- employees.status='separated' transition in separation-workflow.ts.
-- That was accurate for exactly 1 of the 5 code paths that reach that
-- same terminal status — separation.ts (initiate + update),
-- employees/index.ts (soft-delete), and absconding-engine.ts
-- (auto-termination) never revoked auth. The record was a false
-- attestation for four of the five ways an employee actually gets
-- separated in this product.
--
-- apps/api/src/lib/user-account-service.ts now provides a single
-- revokeEmployeeAuth() implementation, called from all 5 paths at the
-- same point each one sets employees.status='separated'. This
-- migration updates the compliance record to describe what's actually
-- implemented, rather than re-affirming the same (now complete) status.
-- ============================================================

UPDATE compliance_controls
SET
  implementation = 'IMPLEMENTED — revokeEmployeeAuth() (lib/user-account-service.ts) sets profiles.is_active = false and applies Supabase Auth ban_duration (876000h) at the terminal employees.status = separated transition. Called from all 5 code paths that reach that transition: separation-workflow.ts (relieve step), separation.ts (initiate + update, when last_working_date is already past), employees/index.ts (soft-delete), and absconding-engine.ts (auto-termination). Manual admin deactivation also revokes tokens immediately (ISSUE-061, implemented). Gate DEF-1 (offer-letter sanitization) remains a separate pre-launch security gate under a different control domain (content injection / XSS) and does not affect CC6.3 status.',
  last_reviewed  = CURRENT_DATE
WHERE control_id = 'CC6.3';
