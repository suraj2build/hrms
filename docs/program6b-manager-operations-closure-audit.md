# Program 6B — Manager Operations Completion: Closure Audit

**Date:** 2026-06-13
**Branch:** `claude/blissful-ptolemy-8AMQn`
**Commit:** `35fc7af`
**Status:** ✅ COMPLETE

---

## Scope

Program 6B adds 8 manager-facing capabilities to the Manager Console, reusing existing backend
infrastructure throughout. No new tables, no migrations, no new approval engines.

---

## Phase Delivery Summary

### P6.3 — Team Overtime Operations ✅
| Item | Status |
|------|--------|
| `GET /overtime/requests` (scoped to direct reports in P6.0b) | reused |
| `POST /overtime/requests/:id/approve` | reused |
| `POST /overtime/requests/:id/reject` | reused |
| `ManagerTeamOvertimeRequests.tsx` — Pending/History tabs, expandable rows, inline Approve/Reject | new |
| Route `/manager/team/overtime` wired in App.tsx | done |
| Sidebar entry (Clock icon) | done |

### P6.4 — Team Comp-Off Operations ✅
| Item | Status |
|------|--------|
| `GET /attendance/comp-off` (P6.0c scoping) | reused |
| `POST /attendance/comp-off/:id/approve|reject` | reused |
| `ManagerTeamCompOff.tsx` — Pending/History tabs, expandable rows | new |
| Route `/manager/team/comp-off` | done |
| Sidebar entry (CalendarPlus icon) | done |

### P6.5 — Bulk Regularisation (+ mandatory security fix) ✅
| Item | Status |
|------|--------|
| **Security fix:** `bulk-approve` + `bulk-reject` lacked direct-report ownership guard | **FIXED** |
| Guard verifies caller's `employee_id`, fetches `getDirectReportIds`, rejects 403 with `unauthorized_ids` on any violation | done |
| HR admin role bypasses guard (existing pattern) | done |
| `ManagerTeamRegularisation.tsx` — multi-select table, bulk toolbar, SLA breach indicators | new |
| Route `/manager/team/regularisation` | done |
| Sidebar entry (ClipboardList icon) | done |

### P6.7 — Team Assets ✅
| Item | Status |
|------|--------|
| `GET /manager/team/assets` (new endpoint) | new |
| Scoped to `assigned` assets where `assigned_to IN (directReportIds)` | done |
| HR admin sees all active/on-notice employees' assets | done |
| Joins `asset_categories(name)` + `employees:assigned_to(...)` | done |
| `ManagerTeamAssets.tsx` — read-only, grouped by employee, search | new |
| Route `/manager/team/assets` | done |
| Sidebar entry (Package icon) | done |

### P6.8 — Team Helpdesk ✅
| Item | Status |
|------|--------|
| `GET /manager/team/helpdesk` (new endpoint) | new |
| `?status=` filter pass-through | done |
| Live SLA-breach computation at runtime (`sla_due_at < now` fallback) | done |
| Summary object: `{ total, open, in_progress, awaiting_employee, resolved, breached }` | done |
| `ManagerTeamHelpdesk.tsx` — summary tiles, status-filter tabs, SLA badge, table | new |
| Route `/manager/team/helpdesk` | done |
| Sidebar entry (LifeBuoy icon) | done |

### P6.9 — Compensation Visibility ✅
| Item | Status |
|------|--------|
| `ManagerCompensation.tsx` exists from Program 5 (P5.3) | verified |
| Route `/manager/team/compensation` already registered | confirmed |
| Sidebar entry (IndianRupee icon) already present | confirmed |
| No changes required — P5 delivery covers this phase | N/A |

### P6.10 — Leave Liability + Hierarchy Fix ✅
| Item | Status |
|------|--------|
| **Hierarchy bug:** `team-balances` used `job_history` join (pre-P6.0a pattern) | **FIXED** |
| Now uses canonical `employees.manager_id` + `status='active'` filter | done |
| `?include_liability=true` — fetches `employee_compensations.ctc_monthly` | new |
| `daily_rate = ctc_monthly / 26` | done |
| `liability_value = balance × daily_rate` per leave-type balance row | done |
| `total_liability` per employee (paid leave balances only, summed) | done |
| `TeamLeaveBalances.tsx` — Liability column, `fmtINR`, legend update | updated |

### P6.11 — Team Payroll Cost ✅
| Item | Status |
|------|--------|
| `GET /manager/team/payroll-cost?month=YYYY-MM` (new endpoint) | new |
| Finds payroll run by month, queries `payroll_run_employees` scoped to direct reports | done |
| Returns `{ data[], month, run_status, total: { gross_pay, net_pay, ot_cost, lop_deduction } }` | done |
| HR admin pass-through via `?manager_employee_id` | done |
| `ManagerTeamPayrollCost.tsx` — month navigator, summary tiles, per-employee table, team totals, volatility index | new |
| Route `/manager/team/payroll-cost` | done |
| Sidebar entry (Coins icon) | done |

---

## Security Audit

| Endpoint | Auth Guard | Direct-Report Scope |
|----------|-----------|-------------------|
| `GET /overtime/requests` | ✅ JWT | ✅ P6.0b (manager scope) |
| `POST /overtime/requests/:id/approve|reject` | ✅ JWT | ✅ P6.0b |
| `GET /attendance/comp-off` | ✅ JWT | ✅ P6.0c |
| `POST /attendance/comp-off/:id/approve|reject` | ✅ JWT | ✅ P6.0c |
| `POST /attendance/regularisation/bulk-approve` | ✅ JWT | ✅ **P6.5 fix** |
| `POST /attendance/regularisation/bulk-reject` | ✅ JWT | ✅ **P6.5 fix** |
| `GET /manager/team/assets` | ✅ JWT | ✅ getDirectReportIds |
| `GET /manager/team/helpdesk` | ✅ JWT | ✅ getDirectReportIds |
| `GET /attendance/leave/team-balances` | ✅ JWT | ✅ employees.manager_id |
| `GET /manager/team/payroll-cost` | ✅ JWT | ✅ getDirectReportIds |

---

## Test Results

```
API: 73/73 tests passing (7 test files)
Web: 0 TypeScript errors in all P6B manager pages
```

---

## Files Changed

### New (backend)
- `apps/api/src/routes/manager/team-assets.ts`
- `apps/api/src/routes/manager/team-helpdesk.ts`
- `apps/api/src/routes/manager/team-payroll-cost.ts`

### Modified (backend)
- `apps/api/src/index.ts` — registers 3 new routes
- `apps/api/src/routes/attendance/leave.ts` — hierarchy fix + liability param
- `apps/api/src/routes/attendance/regularisation.ts` — P6.5 security fix

### New (frontend)
- `apps/web/src/pages/manager/ManagerTeamOvertimeRequests.tsx`
- `apps/web/src/pages/manager/ManagerTeamCompOff.tsx`
- `apps/web/src/pages/manager/ManagerTeamRegularisation.tsx`
- `apps/web/src/pages/manager/ManagerTeamAssets.tsx`
- `apps/web/src/pages/manager/ManagerTeamHelpdesk.tsx`
- `apps/web/src/pages/manager/ManagerTeamPayrollCost.tsx`

### Modified (frontend)
- `apps/web/src/pages/manager/TeamLeaveBalances.tsx` — liability column
- `apps/web/src/components/layout/ManagerSidebar.tsx` — 6 new nav entries
- `apps/web/src/App.tsx` — 6 lazy-loaded routes

---

## Explicitly Not Done (per spec)

- No new approval engines
- No new payroll systems
- No new asset management workflows
- No new helpdesk ticket workflows
- No new database tables / migrations
- No Manager Workspace V2
- Program 3B Certification Governance — awaiting approval
- Reporting Modernization — awaiting approval
- Analytics Modernization — awaiting approval
- UI Modernization — awaiting approval
