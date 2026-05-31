# ATTENDANCE MODULE AUDIT
## HRMS Modernization — Pre-Stabilization Working Audit

**Module:** Attendance  
**Auditor:** Engineering Lead  
**Date:** 2026-05-11  
**Reviewed With:** Codebase — direct code inspection  
**Audit Basis:** Source files read directly:
- `apps/api/src/lib/attendance-engine.ts`
- `apps/api/src/lib/attendance-processor.ts`
- `apps/api/src/routes/attendance/punch.ts`
- `apps/api/src/routes/attendance/ingest.ts`
- `apps/api/src/routes/attendance/upload.ts`
- `apps/api/src/routes/attendance/process.ts`
- `apps/api/src/routes/attendance/regularisation.ts`
- `apps/api/src/routes/attendance/corrections.ts`
- `apps/api/src/routes/attendance/exceptions.ts`
- `apps/api/src/routes/attendance/payroll-summary.ts`
- `apps/web/src/pages/attendance/RegularisationApproval.tsx`

---

## 1. MODULE OVERVIEW

**What does this module do?**

The Attendance module ingests punch data from biometric devices and manual sources, maps it to employees and shifts, computes daily attendance status (present, absent, half-day, late, weekly_off, holiday, leave), tracks exceptions and anomalies, manages correction/regularisation workflows, and produces the payable-days input consumed by Payroll. It is the data source that determines whether an employee gets paid for any given day.

**Who uses it and how often?**

| Role | What They Do in This Module | How Often |
|---|---|---|
| HR Admin | Triggers processing runs, manages regularisation approvals, reviews exceptions, uploads CSV attendance | Daily |
| Payroll Manager | Reviews payroll-summary (attendance → payable days), validates before payroll run | Monthly (critical window) |
| Manager | Approves correction requests for direct reports | As needed — peaks at month-end |
| Employee (ESS) | Submits regularisation requests, views own attendance | As needed |
| System (Biometric Device) | Pushes raw punch logs via `/attendance/ingest` | Continuous |

**Business criticality:**
`[x] Critical — affects payroll or compliance directly`

**What breaks if this module is down for 1 hour?**

Biometric punches queue on devices (if devices support local buffering) but are lost if devices do not buffer. HR cannot approve pending regularisations. Attendance processing cannot be triggered. During month-end payroll window: payroll run cannot start because payable-days data is stale or incomplete.

**What breaks if this module produces wrong data?**

Wrong attendance status → wrong `day_fraction` → wrong payable days → incorrect salary. A half-day recorded as present = 0.5 days of overpayment per employee. An absent recorded as present = full day overpayment. At scale, this compounds across hundreds of employees. Statutory LOP deduction is also affected — incorrect attendance directly produces incorrect PF and ESI base if salary is prorated.

**Direct dependencies:**

| Depends On | What It Needs | What Happens If Missing |
|---|---|---|
| Employee Master | `employee_code` → `employee_id` mapping, shift assignments, `is_current` flag | Punch records stay unprocessed (skipped codes); silently accumulate |
| Shift Master | `shifts` table — start/end times, grace minutes, is_night_shift | Engine falls back to hardcoded 09:00 start, 9h duration |
| Roster | `shift_roster` for date-specific overrides, weekly-off days | Weekly-off detection fails; employees may be marked absent on off days |
| Leave Module | `leave_requests` with status=APPROVED | Approved leave not applied → employee marked absent → LOP incorrectly applied |
| Holiday Calendar | `holiday_calendar` | Holidays not applied → employees marked absent on public holidays |
| Tenant Config | `tenants.timezone` | Falls back to UTC — all shift windows and late-minute calculations are wrong for non-UTC tenants |

**What depends on this module:**

| Downstream | What It Receives | Impact If Wrong |
|---|---|---|
| Payroll | `attendance_daily.day_fraction`, `is_payable`, `lop_days` via payroll-summary | Incorrect payroll calculation — salary error |
| Compliance | Payroll base derived from attendance → affects PF, ESI, TDS base | Statutory filing errors |
| ESS | Employee's own attendance records | Wrong self-service data; employee disputes |

---

## 2. MAIN WORKFLOWS

### Workflow Summary

| # | Workflow Name | Who Triggers | How Often | Payroll Impact | Compliance Impact | Currently Reliable? |
|---|---|---|---|---|---|---|
| 1 | Device Punch Ingest | Biometric device (automated) | Continuous | Yes | No | Partially |
| 2 | Attendance Processing Run | HR Admin (manual trigger) | Daily | Yes | No | Partially |
| 3 | CSV Upload | HR Admin | Weekly / as needed | Yes | No | No — timezone bug |
| 4 | Employee Regularisation Request | Employee via ESS | Daily | Yes | No | Yes |
| 5 | Regularisation Approval (HR) | HR Admin | Daily | Yes | No | Yes |
| 6 | Attendance Correction (Manager/HR) | Manager or HR Admin | As needed | Yes | No | Partially |
| 7 | Payroll Summary Generation | HR Admin / Payroll Manager | Monthly | Yes | Yes | Partially |
| 8 | Exception Resolution | HR Admin | Daily | Yes | No | No — no bulk |

---

### Workflow Detail

---

**Workflow:** Device Punch Ingest

**Trigger:** Biometric device POSTs to `/attendance/ingest` with `api_key` + batch of `{employee_code, timestamp, direction}` logs (max 1,000 per call)

**Steps:**
```
1. Device authenticates via api_key → device + tenant_id resolved from attendance_devices table
2. Batch insert into attendance_raw_logs (processed = false)
3. No immediate processing — raw logs sit until HR triggers /attendance/process
```

**Output:** Rows inserted in `attendance_raw_logs` with `processed = false`

**Approval required?** No

**What happens if it fails mid-way?**
Insert fails entirely — no partial insert, no retry mechanism in the route. Device receives 500. Whether the device retries depends entirely on device firmware. Lost punches if device does not buffer. No operator alert that a device batch failed.

**Known problems:**
- No acknowledgement to operator when device batches fail — failures only appear in server logs
- No device health dashboard — operator cannot see which devices are syncing successfully vs. silently failing
- No deduplication at ingest level — raw logs may duplicate if device retries. Deduplication happens later in processing (via employee_code matching)
- Period-lock not enforced at ingest — punches for a locked period are accepted and stored, but processing them later may produce unexpected results
- Maximum 1,000 logs per call — no queue mechanism for high-volume devices that produce more

---

**Workflow:** Attendance Processing Run

**Trigger:** HR Admin manually POSTs to `/attendance/process` with `{date}`

**Steps:**
```
1. Acquire PostgreSQL advisory lock + table lock (two-layer; TTL=900s for stale takeover)
2. Date-level guard: reject if date already processed successfully (unless force=true)
3. Load all unprocessed raw_logs for the date from attendance_raw_logs
4. Map employee_code → employee_id (batch query); unmatched codes → skipped_codes[]
5. Batch-resolve shifts (roster override → standing shift → site default)
6. Resolve org context per employee (site, timezone, weekly-off days)
7. Pair IN/OUT punches per employee; compute daily summary via computeDaily()
8. Apply priority chain: Holiday > Weekly Off > Punch-based status
9. Delete + re-insert attendance_logs for matched employees
10. Upsert attendance_daily for all matched employees
11. Generate intelligence (exceptions, confidence scores) — fire-and-forget
12. Write audit log for status changes
13. Mark matched raw_log IDs as processed=true
14. Write attendance_processing_runs audit row
```

**Output:** `attendance_daily` rows upserted, `attendance_logs` updated, `attendance_processing_runs` row written

**Approval required?** No — HR Admin triggers directly

**What happens if it fails mid-way?**
Steps 9–13 can partially complete. If the upsert of `attendance_daily` succeeds but marking raw logs as `processed=true` fails (step 13), re-running the processor will reprocess the same raw logs and produce duplicate `attendance_logs` entries (delete-then-insert makes this idempotent for `attendance_daily`, but not entirely for `attendance_logs` if the delete in step 9 only filters by `check_in` date). A failure in the advisory/table lock release in `finally` leaves the lock held until TTL (900s) expires.

**Known problems:**
- Processing is single-date only — no bulk "process the last 7 days" option for recovery after extended downtime
- Skipped codes have no operator-facing view — the processing run stores them in `skipped_codes[]` on the run row, but there is no screen that shows "these employee codes have been skipping for N days"
- No progress indicator — operator has no way to know how long processing will take or whether it is still running
- The 5,000ms slow threshold warning is logged but not surfaced to the operator

---

**Workflow:** CSV Upload

**Trigger:** HR Admin uploads CSV via `/attendance/upload` with columns: `employee_code, date, in_time, out_time`

**Steps:**
```
1. Parse and validate CSV headers and rows
2. Batch resolve employee_code → employee_id
3. Build IN and OUT punch timestamps from date + time columns
4. Bulk upsert into attendance_punch_logs (ignoreDuplicates=true)
5. Fire recomputes per unique (employee_id, date) — sequential, fire-and-forget
```

**Output:** Punches inserted in `attendance_punch_logs`; recomputes triggered per employee-date pair

**Approval required?** No — HR Admin only

**What happens if it fails mid-way?**
Bulk upsert is all-or-nothing — either all punch rows insert or none do. If the upsert succeeds but a recompute fails, the punch exists in the DB but `attendance_daily` is not updated. No retry mechanism for failed recomputes. Operator sees success (punch inserted) but attendance is not recomputed.

**Known problems (CRITICAL):**
- **Timezone bug:** `buildTimestamp(date, time)` appends `.000Z`, treating CSV times as UTC. For IST tenants, a CSV row `09:00` is stored as `09:00 UTC` = `14:30 IST`. The attendance engine then computes all time windows in IST. This means uploaded punches are placed 5.5 hours into the afternoon relative to the shift. Every CSV upload for an IST tenant produces incorrect attendance computation.
- Recomputes run sequentially in a loop — 2,000 rows = up to 2,000 sequential recompute calls in a single `setImmediate`. No concurrency control, no batching.
- No diff view — operator sees "N records processed, M failed" but no comparison of what was already in the system vs. what was uploaded
- No preview step — upload executes immediately with no confirmation
- `in_time` must be before `out_time` validation uses string comparison on HH:MM — this breaks for night shifts where out_time is the next day (e.g., 22:00 → 06:00)
- MAX_ROWS = 2,000 — adequate for most, but no chunked upload for larger datasets

---

**Workflow:** Employee Regularisation Request

**Trigger:** Employee submits via ESS — `/attendance/regularisation` with `{date, requested_check_in, requested_check_out, reason}`

**Steps:**
```
1. Validate submission window (configurable, default: 7 days from attendance date)
2. Check monthly frequency limit (configurable, default: 5 per month)
3. Insert into attendance_regularisation with SLA deadline
```

**Output:** Pending regularisation record created

**Approval required?** Yes — HR Admin or manager must approve

**What happens if it fails mid-way?**
Insert either succeeds or fails — no partial state possible. If insert fails, employee sees error.

**Known problems:**
- Monthly frequency limit counts by `created_at` month, not attendance `date` month — an employee can submit 5 corrections for last month's dates in the first days of the new month, bypassing the intent of the limit
- Submission window is checked against today's date, not the payroll lock status — an employee can submit a regularisation after payroll has already run for that period, and approval will silently recompute attendance that payroll has already consumed
- No notification to the approver that a new request is pending
- Two separate correction systems exist: `attendance_regularisation` (this route) and `attendance_corrections` (corrections.ts). Both allow employees or HR to request attendance corrections. The distinction is unclear operationally and both produce redundant approval queues for HR.

---

**Workflow:** Regularisation Approval

**Trigger:** HR Admin approves via `/attendance/regularisation/:id/approve`

**Steps:**
```
1. Call approveRegularisation() service (validates, updates status to approved)
2. Insert approved check-in/out into attendance_punch_logs (source='regularisation')
3. Trigger recomputeRange() via attendance-engine.ts for the approved date
4. Emit correction.applied event (fire-and-forget)
5. Write explainability ledger entry (fire-and-forget)
```

**Output:** `attendance_punch_logs` updated, `attendance_daily` recomputed for that date

**Approval required?** HR Admin approves — no two-level approval

**What happens if it fails mid-way?**
If punch insert (step 2) fails, it is logged as a warning but does not abort — the recompute proceeds without the new punch data, effectively computing the same attendance as before. The regularisation shows as approved but the attendance is unchanged. There is no alert to the HR admin that the punch insert failed.

**Known problems:**
- Punch insert failure on approval is non-fatal but silently produces wrong attendance — attendance shows approved but unchanged
- No diff shown before approval — HR admin cannot see "current status: ABSENT" vs. "after approval: PRESENT" before clicking approve
- Bulk approve exists in the UI (`RegularisationApproval.tsx` has bulk action bar) but individual approvals trigger individual recomputes — no batch recompute optimization
- `approved_today: 0` is hardcoded in the summary endpoint — the field is a placeholder that has never been implemented

---

**Workflow:** Payroll Summary Generation

**Trigger:** HR Admin or Payroll Manager fetches `/attendance/payroll-summary?month=YYYY-MM`

**Steps:**
```
1. Fetch all active employees
2. Fetch all attendance_daily rows for the month
3. Compute per-employee: present, absent, on_leave, payable_days, lop_days
4. Return totals and per-employee breakdown
```

**Output:** Summary data consumed by Payroll for monthly processing

**Known problems (CRITICAL):**
- **`lop_days` calculation bug:** `lop_days = rows.filter(r => r.status === 'absent').length` — this counts every absent day as 1 full LOP day. A half-day absent is counted as 1 full LOP day. The correct formula should use `day_fraction`: `rows.filter(r => !r.is_payable).reduce((sum, r) => sum + (1 - r.day_fraction), 0)`. This produces incorrect LOP input to payroll.
- No reconciliation view — no way to compare payroll summary values against raw attendance records to spot discrepancies
- Fetches ALL active employees regardless of whether they have attendance data — employees with zero attendance records appear as having 0 present, 0 absent, etc. rather than being flagged as "no data"
- No month-over-month comparison — operator cannot easily see variance vs. prior month

---

## 3. CURRENT PROBLEMS

### 3.1 Runtime Issues

| Problem | How Often | Impact When It Happens | Workaround? |
|---|---|---|---|
| Device ingest failures not surfaced to operator | Unknown (only in logs) | Punches lost if device doesn't buffer | No |
| Punch insert failure on regularisation approval silently produces wrong attendance | Intermittent | Attendance shows approved but unchanged — payroll uses wrong data | No |
| Recompute failures after CSV upload not reported back | Every failed recompute | Punch data exists; attendance not updated | HR must manually trigger reprocess |
| Lock TTL (900s) blocks re-run if previous run crashed | After crash | HR must wait 15 min before retrying | Wait for TTL to expire |
| `attendance_processing_lock` not seeded for new tenants | On new tenant setup | Lock acquire fails; processing cannot run | Manual DB insert |

**Most critical runtime issue:**
The punch insert failure on regularisation approval is silent and non-fatal. HR approves a regularisation believing attendance will be corrected. The correction may silently fail. The payroll-summary then reflects the original (wrong) attendance. This is a data integrity risk with no operator visibility.

---

### 3.2 UX Friction

| Screen / Workflow | What's Painful | Operators Affected |
|---|---|---|
| Regularisation approval | No before/after diff — HR approves blind, without seeing what the attendance will change to | All HR Admins |
| Exception resolution | No bulk resolve — each exception requires individual action | All HR Admins |
| Upload feedback | No diff view — operator can't see what changed in `attendance_daily` after upload | All HR Admins |
| Skipped codes | No dedicated screen — skipped employee codes buried in processing run JSON | All HR Admins |
| Device health | No device sync status — no way to know if a device is down or not pushing | All HR Admins |
| Payroll summary | No variance vs. prior month — operator has no comparison baseline | Payroll Manager |

**Biggest UX complaint (inferred from code and structure):**
HR Admin: "I approve a regularisation and I have no idea if it actually changed anything until I go look at the employee's attendance record manually."

---

### 3.3 Data Problems

| Problem | Table / Field | How Often | Operators Aware? |
|---|---|---|---|
| CSV upload stores local times as UTC | `attendance_punch_logs.punched_at` | Every CSV upload for IST tenant | Likely not |
| `lop_days` counts half-days as full LOP | Payroll summary computation | Every monthly payroll | Likely not |
| `approved_today` hardcoded to 0 | Regularisation summary endpoint | Always | Likely not |
| Duplicate correction systems | `attendance_regularisation` + `attendance_corrections` | Always | No — operators use both |
| No reconciliation between `attendance_raw_logs` and `attendance_punch_logs` | Cross-table | Ongoing | No |

**Is there any data that operators have stopped trusting?**
`[ ] No`  
`[x] Yes — What data: Attendance status after regularisation approval  Why: Approvals don't always produce visible changes; operators manually re-check`

---

### 3.4 Manual Workarounds

| Workaround | Why It Exists | Risk If Workaround Fails |
|---|---|---|
| HR manually re-checks attendance after regularisation approval | Punch insert failure on approval is silent; no confirmation that attendance actually changed | Wrong attendance goes into payroll undetected |
| HR re-runs processing with `force=true` after a failed run | No automatic retry mechanism | If HR forgets, the day's attendance remains unprocessed |
| HR reviews server logs to find device sync failures | No device health dashboard | Device outages go unnoticed; punches accumulate on device or are lost |

---

### 3.5 Excel / Offline Dependencies

| Process Done in Excel / Offline | Why It's Not in the System | Frequency |
|---|---|---|
| Manual CSV preparation for device attendance uploads | Upload template not provided to HR by default; operators build their own format | Weekly |
| Attendance variance review before payroll | No month-over-month comparison in payroll-summary | Monthly |
| Tracking skipped/unmatched employee codes across processing runs | No dedicated screen — HR exports or reads raw run data | As needed |

**Is any Excel output used as input to another system?**
`[x] Yes — CSV attendance file uploaded back into the system via /attendance/upload. Format is manually maintained by HR — no template enforcement or download.`

---

### 3.6 Performance Issues

| Screen / Operation | Current Speed | Acceptable Speed | When It's Worst |
|---|---|---|---|
| CSV upload recomputes (2,000 rows) | Sequential, unknown total time | Should be parallelized | Any large upload |
| Payroll summary (large tenant) | Loads ALL employees + ALL daily rows in memory for the month | Should paginate or use DB aggregation | Month-end |
| Exception list (unfiltered) | Max 200 per call; full scan | Acceptable with date filters applied | Open queue buildup |

---

## 4. OPERATIONAL RISKS

### 4.1 Payroll Risk

**Does a failure or error in this module affect payroll calculations?**
`[x] Yes — How: attendance_daily.day_fraction and is_payable are the direct inputs to payroll. Wrong status = wrong pay.`

**What is the worst-case payroll impact if this module has a bad data day?**

Scenario: CSV upload processes with the UTC timezone bug. 500 employees have punches stored 5.5 hours offset. The attendance engine computes punch windows based on IST shift times. All uploaded punches fall outside the shift window (09:00 IST → stored as 09:00 UTC = 14:30 IST). Engine sees no punches in the 07:00–14:00 IST fetch window → marks employees ABSENT. 500 employees receive full LOP deduction for the day. At ₹30,000 average monthly salary, one wrong absent day = ~₹1,000 deduction per employee × 500 = ₹5,00,000 incorrect deduction in a single upload.

**Is this risk currently mitigated?**
`[ ] Yes`
`[ ] Partially`
`[x] No — the UTC timestamp bug is in production and fires on every CSV upload for non-UTC tenants`

---

### 4.2 Compliance Risk

**Does a failure in this module affect statutory filings?**
`[x] Yes — Which filings: PF, ESI, TDS (LOP affects salary base which affects all statutory deductions)`

**Has this module ever caused a compliance filing error?**
`[ ] Confirmed — unknown; code inspection only`

**Is there a compliance deadline dependency?**
`[x] Yes — Attendance must be finalized before payroll run, which must complete before PF/ESI filing deadlines`

---

### 4.3 Data Integrity Risk

**Duplicate records:**
`[x] Yes — Two correction systems (attendance_regularisation and attendance_corrections) create duplicate correction records for the same employee-date pairs. Both insert punch rows into attendance_punch_logs on approval, potentially creating multiple punch pairs for the same timestamp.`

**Orphaned records:**
Skipped employee codes in `attendance_raw_logs` stay unprocessed indefinitely. If an employee leaves and their code is deactivated without processing historical logs, those logs remain `processed=false` forever — they accumulate without bound.

**Is there an audit trail for all changes?**
`[x] Partial — audit trail exists for status changes (attendance_audit_log), but punch-level changes on CSV upload have no audit trail. The source field on punch_logs records "csv_upload" but the uploading user is not recorded in the punch row itself.`

---

### 4.4 Approval Bottlenecks

| Approval Step | Average Delay | Why It Gets Stuck |
|---|---|---|
| Regularisation pending → approved | Unknown — no SLA reporting in summary | `approved_today` is hardcoded 0; no real tracking |
| Correction pending → approved | Unknown | No unified queue — split across regularisation and corrections screens |
| Exception open → resolved | Unknown | No bulk resolution; one at a time |

**Is any approval being bypassed in practice?**
`Unknown from code inspection — no audit data available`

---

### 4.5 Reconciliation Gaps

| Reconciliation Point | Currently Automated | Currently Visible to Operator | Gap |
|---|---|---|---|
| Raw logs vs. processed attendance | No | No | No mechanism to detect raw logs that were silently skipped |
| CSV upload vs. existing punch data | No | No | No diff view — operator can't see what changed |
| Regularisation approval vs. actual attendance change | No | No | No before/after diff at approval time |
| Attendance daily vs. payroll input | No | No | No reconciliation before payroll locks |
| Device punch count vs. processed punch count | No | No | No device-level reconciliation |

**Where reconciliation should exist but doesn't:**
The most critical missing reconciliation is between `attendance_daily` before and after any bulk operation (upload, batch approval, processing run). Operators cannot currently verify that a bulk operation produced the intended result without manually inspecting individual records.

---

## 5. TECHNICAL DEBT

### 5.1 Duplicate Logic — TWO ATTENDANCE ENGINES

**This is the highest-risk technical debt in the module.**

Two separate compute paths exist for producing `attendance_daily`:

| | `attendance-engine.ts` | `attendance-processor.ts` |
|---|---|---|
| **Input** | `attendance_punch_logs` | `attendance_raw_logs` |
| **Triggered by** | `/attendance/punch`, `/attendance/upload`, regularisation approval, correction approval | `/attendance/process` |
| **Status resolution** | Policy-driven thresholds (`present_threshold_pct`, `half_day_threshold_pct`) | Hardcoded: `>= 0.75` of shift → present, `>= 0.5` → half_day, else → **present** (not absent) |
| **Late grace** | From policy + shift grace minutes | Hardcoded `LATE_GRACE_MINUTES = 15`; shift grace minutes ignored |
| **Timezone** | Fully timezone-aware via `localToUtc()` | Uses `empCtx.site_timezone` but applies it differently |
| **OT** | Policy-aware (`shiftDurationMin` from shift) | Hardcoded `SHIFT_HOURS * 60` |

**Critical divergence:** `attendance-processor.ts`, line 237–243: when an employee has sessions but total minutes are below the half-day threshold, the status is set to `'present'` (not `'absent'`). The engine correctly returns `'absent'` in the same case. An employee who punches in for 10 minutes and out will be marked `present` by the processor but `absent` by the engine. This divergence directly affects payroll.

The same employee-date can be computed by both paths depending on whether a correction/regularisation or a daily process run fires last. The last writer wins — there is no determinism guarantee.

---

### 5.2 Hardcoded Rules

| Hardcoded Value | Location | Where It Should Be | Risk |
|---|---|---|---|
| `SHIFT_START_HOUR = 9` | `attendance-processor.ts:38` | Policy / shift master | Employees with non-9am shifts get wrong late calculation from processor |
| `SHIFT_HOURS = 9` | `attendance-processor.ts:39` | Shift master | OT calculation wrong for shifts shorter or longer than 9 hours |
| `LATE_GRACE_MINUTES = 15` | `attendance-processor.ts:40` | Policy | Overrides per-shift and per-policy grace minutes |
| `lock_ttl_seconds = 900` | `process.ts:82` | Configurable per-tenant | Fixed 15-min stale lock regardless of tenant scale |
| `MAX_ROWS = 2000` | `upload.ts:36` | Configurable | Hard cap with no overflow path |
| `windowDays = 7` (default) | `regularisation.ts:73` | Configurable — already is, but default not documented | Employees submit corrections after payroll closes |
| `maxPerMonth = 5` (default) | `regularisation.ts:74` | Configurable — already is | Bypassed by submitting corrections for last month in new month |

---

### 5.3 Missing Validation

- **CSV upload:** `in_time < out_time` is validated by string comparison — fails for night-shift uploads where out_time is on the next calendar day
- **CSV upload:** No validation that the date is within an open (unlocked) attendance period
- **Regularisation:** No check that the target date's attendance period is not yet locked before allowing submission
- **Regularisation:** No check that payroll has not already processed the target period
- **Punch route:** No validation that `punched_at` is within a reasonable window (future punches accepted; historical punches older than locked periods accepted)
- **Ingest route:** `processed = false` raw logs accepted for any date — no period-lock enforcement at ingest time

---

### 5.4 Weak Error Handling

| Where | Problem |
|---|---|
| Regularisation approval — punch insert | Failure is `warn`-logged but execution continues. Attendance recompute proceeds without the new punch. Result: attendance appears approved but is unchanged. No operator alert. |
| Recomputes after upload | Sequential in `setImmediate`, individual failures logged as `warn` but no failure reported in the API response. Operator gets `success_rows: N` but some may not have updated `attendance_daily`. |
| Anomaly sync (`syncAnomalies`) | Entirely fire-and-forget with `.catch(console.warn)`. Anomaly table can silently desync from attendance_daily without any alert. |
| Lock release in `finally` | Lock release failure is logged as `error` but cannot be recovered automatically — operator must wait for TTL or manually clear the lock table. |
| Intelligence generation | Entirely fire-and-forget. Exceptions and confidence scores can fail silently for any processed run. |

---

### 5.5 Test Coverage

**Are critical calculations covered by automated tests?**
`[ ] Yes — all  [ ] Partially  [x] No — not verified; no test files found in attendance module directories`

**Are critical workflows covered by automated tests?**
`[ ] Yes — all  [ ] Partially  [x] No`

**Most dangerous untested path:**
The dual-engine divergence. When `attendance-processor.ts` marks a short-session employee as `present` and the engine marks them `absent`, the final value in `attendance_daily` depends on which ran last. This is untested, non-deterministic, and directly affects payroll.

---

## 6. UX & WORKFLOW IMPROVEMENTS

### 6.1 Bulk Operations Needed

| Operation | Current Method | Should Be |
|---|---|---|
| Exception resolution | One at a time via PUT /attendance/exceptions/:id | Bulk resolve with category filter + reason |
| Regularisation approval | Single approve or UI bulk action (but serial execution) | True batch with pre-approval diff view |
| Skipped code correction | No screen — manual DB check | Bulk employee-code remapping screen |
| Processing re-run for date range | One date at a time | Date range processing trigger (last N days) |

---

### 6.2 Visibility Problems

| What's Hidden | Where | What Should Be Visible |
|---|---|---|
| Device sync status | Nowhere | Device health panel: last sync time, batch size, error count per device |
| Skipped employee codes | Buried in processing run JSON | Dedicated "Unmatched Codes" screen with count, oldest date, affected devices |
| Recompute failures after upload | Nowhere (fire-and-forget) | Post-upload summary: "N employees successfully recomputed, M failed — see list" |
| Regularisation approval result | Nowhere | Before/after attendance diff displayed at approval time |
| Payroll summary variance | Nowhere | Month-over-month comparison column on payroll-summary table |
| Processing run progress | Nowhere | Real-time progress indicator during processing (employee count processed / total) |

---

### 6.3 Too Many Clicks

| Workflow | Current Steps | Should Be |
|---|---|---|
| Find which employees had attendance not recomputed after upload | Impossible without DB access | 1 click — upload result screen shows failed recomputes |
| Identify all regularisations breaching SLA | Filter + scroll through list | 1 click — SLA-breached filter at top of approval screen |
| Correct a skipped employee code after processing | No UI path exists | Find in unmatched-codes screen → map code → re-trigger processing |

---

### 6.4 Missing Filters and Search

| Screen | Missing Filter / Search | How Often Needed |
|---|---|---|
| Regularisation approval | Filter by payroll-impact, department, date range | Daily |
| Exception list | Filter by "requires investigation" flag only showing open exceptions | Daily |
| Payroll summary | Filter by department, location, employee status | Monthly |
| Attendance daily (if exposed) | Filter by status = absent for a date range | As needed for investigation |

---

### 6.5 Reconciliation Visibility

**Where reconciliation results exist but operators can't easily see them:**
The `attendance_audit_log` records every status change but there is no UI screen that exposes the change history for a specific date's attendance. Operators cannot easily answer "why did this employee's attendance change from PRESENT to ABSENT between yesterday and today?"

**Where a diff view should exist but doesn't:**
- After CSV upload: no diff between what existed vs. what was inserted
- Before regularisation approval: no before/after status comparison
- After processing run: no summary of which employees changed status vs. prior run

---

### 6.6 Operator Productivity Improvements

**Top 3 things that would save HR Admins the most time each week:**

```
1. Regularisation approval diff view — HR currently approves blind and manually verifies.
   A before/after status preview at approval time eliminates the manual verification step.

2. Skipped/unmatched employee code screen — HR currently discovers unmatched codes only
   by reading processing run results. A dedicated screen showing codes that have been
   unmatched for >1 day, grouped by device, would eliminate a daily manual check.

3. Bulk exception resolution — Resolving 50 "missing_out_punch" exceptions one at a time
   costs ~10 minutes daily. Bulk resolve by category with a shared resolution note
   reduces this to ~30 seconds.
```

---

## 7. MODERNIZATION PRIORITIES

### Phase 1 — Stabilization
*Fix what's broken. No new features until these are resolved.*

| Priority | Item | Why First |
|---|---|---|
| 1 | Fix CSV upload timezone bug (`buildTimestamp` appends `.000Z`) | Critical — every CSV upload for IST tenants produces wrong attendance and wrong payroll input |
| 2 | Fix `lop_days` calculation in payroll-summary (must use `day_fraction`, not raw absent count) | Critical — payroll receives wrong LOP days every month |
| 3 | Fix regularisation approval: punch insert failure must abort the approval, not silently continue | P0 — attendance can show approved but be unchanged; payroll impact undetected |
| 4 | Fix processor's status fallback: short-session employees must be `absent`, not `present` (processor line 241) | P0 — diverges from engine; produces wrong payroll input depending on which path ran last |
| 5 | Fix regularisation frequency limit: count by attendance `date` month, not `created_at` month | P1 — limit is bypassed in practice |
| 6 | Add period-lock check to regularisation submission: block submissions for locked periods | P1 — corrections submitted after payroll runs produce recomputes that conflict with closed payroll |
| 7 | Fix night-shift CSV validation: `in_time < out_time` string comparison fails for cross-midnight shifts | P1 — night shift uploads silently rejected |
| 8 | Implement `approved_today` in regularisation summary (currently hardcoded 0) | P2 — SLA tracking is broken without this |

**Estimated stabilization effort:** 8–12 days

**Can operations continue safely while Phase 1 is underway?**
`[x] Yes, with caution — CSV uploads should be suspended until the timezone bug (Item 1) is fixed. All other operations can continue.`

---

### Phase 2 — Workflow Improvements

| Priority | Improvement | Operator Benefit |
|---|---|---|
| 1 | Unify correction systems: deprecate `attendance_regularisation` route, migrate to `attendance_corrections` | Eliminates dual approval queue confusion; single workflow for all corrections |
| 2 | Add before/after diff to regularisation/correction approval | HR approves with full context; eliminates manual post-approval verification |
| 3 | Add skipped employee codes screen with per-device breakdown and oldest-unmatched date | HR can identify and fix code mismatches within the same working day |
| 4 | Add date-range processing trigger (process last N days) | HR can recover from multi-day processing failures without one-by-one manual triggers |
| 5 | Make upload recomputes concurrent (Promise.all with concurrency limit) instead of sequential | Reduces post-upload delay from minutes to seconds for large uploads |
| 6 | Add device health status panel showing last-sync time, batch count, error count per device | HR can detect and escalate device failures without checking server logs |

**Estimated effort:** 12–18 days

---

### Phase 3 — UX Improvements

| Priority | Improvement | Operator Benefit |
|---|---|---|
| 1 | Bulk exception resolution: select by category/date range, resolve with shared note | Reduces daily exception queue management from 10+ minutes to <1 minute |
| 2 | Payroll summary: add month-over-month variance column per employee | Payroll Manager can spot outliers before payroll run without manual comparison |
| 3 | Post-upload diff view: show which employees' attendance_daily changed after upload | HR can verify upload result without navigating to each employee's record |
| 4 | Processing run result screen: show status breakdown, skipped codes, recompute failures in one view | Replaces log-reading with an operational dashboard for each run |
| 5 | Attendance period calendar: visual overview of which dates are processed, locked, or have open exceptions | Replaces mental tracking of attendance calendar state |

**Estimated effort:** 10–14 days

---

### Phase 4 — Intelligence Features
*Only after Phases 1–3 are complete and the dual-engine problem is resolved.*

| Signal / Feature | What It Detects | Where It Appears | Operator Value |
|---|---|---|---|
| Chronic late arrival | Employees with late_minutes > 0 for >3 consecutive days | Inline flag on attendance grid | Manager can intervene before it becomes a payroll pattern |
| Absent without leave pattern | Employees absent without approved leave for 2+ days | Exception queue banner | HR can initiate follow-up before month-end |
| Device sync gap | Device has not pushed punches in >2 hours during expected punch window | Device health panel | HR can escalate device failure before end of shift |
| Payroll variance alert | Employee's payable_days this month differs from 3-month average by >3 days | Pre-payroll review screen | Payroll Manager catches outliers before disbursement |

**Data quality good enough for intelligence features?**
`[ ] Yes`
`[x] Not yet — needs: dual-engine unification, timezone bug fix, and lop_days fix first. Intelligence signals on corrupt attendance data produce misleading alerts.`

---

## 8. FINAL RECOMMENDATION

**Priority Level:**
`[x] Critical — start immediately`

**Estimated overall complexity:**
`[x] High — significant unknowns remain in dual-engine interaction and correction system unification`

**The single biggest risk in modernizing this module:**
Leaving the dual-engine divergence unresolved while adding new features. Any enhancement that touches attendance computation interacts with two separate code paths that produce different results for the same input — making correctness impossible to guarantee.

**The single most valuable improvement for operators:**
The regularisation approval diff view (Phase 2, Item 2). It eliminates the most frequent manual verification step HR performs and directly prevents the silent failure scenario where attendance appears corrected but isn't.

**Major risks to manage during modernization:**

```
1. Timezone bug fix (Phase 1, Item 1) will change computed attendance for historical
   CSV uploads when those dates are recomputed. Must coordinate with Payroll to identify
   which periods are already closed and whether retroactive correction is needed.

2. Dual-engine unification (processor → engine migration) is the highest-risk change
   in the module. The processor handles device ingest → daily processing for all tenants.
   Migration must be tested against production-representative data before any cutover.

3. Correction system unification (regularisation + corrections merge) must preserve all
   existing pending requests in both tables. Migration must be additive — no data deletion.
```

**Suggested execution order:**

```
1. Fix the five P0/P1 stabilization bugs (Items 1–4 of Phase 1) — no other work until done
2. Fix remaining stabilization items (Items 5–8 of Phase 1)
3. Validate payroll-summary lop_days with a real month's data before next payroll run
4. Begin Phase 2 with the correction system unification (highest complexity — do it before
   building anything on top of the existing dual-system design)
5. Add diff view for approvals
6. Add skipped codes screen and device health panel
7. Begin Phase 3 UX work once workflows are stable
8. Intelligence layer only after Phase 3 complete and confirmed stable for 2+ payroll cycles
```

**Deployment constraints:**
- No deployments during payroll processing window (payroll cut-off through disbursement confirmation)
- Phase 1 Items 1 and 2 (timezone fix and lop_days fix) should deploy before the next payroll processing window, not during it
- CSV upload should be suspended from the time the timezone fix is deployed until HR has been trained on re-upload of any affected historical data

**What must NOT change during modernization:**

```
1. attendance_daily schema and its day_fraction field — payroll reads this directly;
   any schema change requires payroll module coordination

2. The dual-lock mechanism in /attendance/process (advisory + table lock) —
   it is working correctly and prevents the most dangerous race condition in the module

3. The attendance_audit_log write path — all status changes must continue to be logged
   regardless of which engine produces the change

4. The attendance_punch_logs UNIQUE constraint (tenant_id, employee_id, punched_at, direction) —
   this is the deduplication mechanism; removing it would allow duplicate punches to accumulate
```

---

**Sign-off:**

| | Name | Date |
|---|---|---|
| **Auditor** | Engineering Lead | 2026-05-11 |
| **Operator / Team Lead** | *Pending operator review* | |
| **Engineering Lead** | *Pending sign-off* | |

---

*This audit reflects the state of the attendance module as of 2026-05-11, based on direct code inspection. Operator interviews have not been conducted — findings marked as operational assumptions should be validated with HR Admins and Payroll Managers before Phase 2 begins.*
