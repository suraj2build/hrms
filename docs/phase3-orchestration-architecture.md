# Phase 3 — Workforce Orchestration Architecture

## Orchestration Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║               WORKFORCE EVENT ENTRY POINTS                          ║
║  (leave approval, attendance correction, payroll lock, etc.)        ║
╚══════════════════════════════════════════╤═══════════════════════════╝
                                           │
                                           ▼
╔══════════════════════════════════════════════════════════════════════╗
║            workforce-orchestrator.ts                                ║
║                                                                      ║
║  orchestrateWorkforceEvent(supabase, event)                          ║
║                                                                      ║
║  1. checkFreezeConstraint()  → payroll-freeze-service                ║
║  2. Generate orchestratorLineageId (crypto.randomUUID)               ║
║  3. Create workforce_rebuild_events (root record)                    ║
║  4. markDateRangeAsReplayPending()  → attendance-state-service       ║
║  5. enqueueRebuild() × N  (dependency-ordered)                       ║
║  6. recordWorkforceEvent()  → workforce-event-timeline-service       ║
║  7. Return OrchestrationResult                                       ║
╚═════════════┬───────────────────────────────────────────────────────╝
              │
    ┌─────────┴──────────────────────────────────────────┐
    │                                                      │
    ▼                                                      ▼
╔═══════════════════════╗                     ╔═══════════════════════╗
║  payroll-freeze-      ║                     ║  attendance-state-    ║
║  service.ts           ║                     ║  service.ts           ║
║                       ║                     ║                       ║
║  payroll_period_states║                     ║ attendance_processing ║
║  OPEN                 ║                     ║ _states               ║
║  PAYROLL_PROCESSING   ║                     ║ raw                   ║
║  PAYROLL_LOCKED       ║                     ║ reconstructed         ║
║  PAYROLL_ARCHIVED     ║                     ║ finalized             ║
╚═══════════════════════╝                     ║ payroll_locked        ║
                                              ║ frozen                ║
                                              ║ replay_pending        ║
                                              ╚═══════════════════════╝

              │ enqueueRebuild (dependency-ordered)
              ▼
╔══════════════════════════════════════════════════════════════════════╗
║           retroactive_rebuild_queue (Phase 2 + Phase 3)             ║
║                                                                      ║
║  dependency_order:       1=attendance, 2=leave_balance, 3=payroll   ║
║  orchestrator_lineage_id: shared across chain                       ║
║  blocked_by_rebuild_id:  explicit predecessor dependency            ║
║  rebuild_stage:          'attendance' | 'leave_balance' | 'payroll' ║
║  rebuild_scope:          single_day | date_range | full_year | open ║
╚══════════════════════════════════════╤═══════════════════════════════╝
                                       │ execution (by module processors)
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
            ┌───────────┐    ┌───────────────┐    ┌──────────┐
            │ Attendance │    │ Leave Balance  │    │ Payroll  │
            │ Engine     │    │ Engine         │    │ Engine   │
            │            │    │                │    │          │
            │(unchanged) │    │(unchanged)     │    │(unchanged│
            └───────────┘    └───────────────┘    └──────────┘
                    │                  │                  │
                    └──────────────────┼──────────────────┘
                                       │ markRebuildStepCompleted()
                                       ▼
╔══════════════════════════════════════════════════════════════════════╗
║           workforce_rebuild_events                                   ║
║                                                                      ║
║  orchestration_status: initiated → in_progress → completed | failed  ║
║  completed_modules:    tracked as modules finish                     ║
║  failed_modules:       tracked on failure                            ║
║  replay_safety_markers: idempotency guards per module                ║
╚══════════════════════════════════════╤═══════════════════════════════╝
                                       │
                                       ▼
╔══════════════════════════════════════════════════════════════════════╗
║           workforce_event_timeline  (write-once audit trail)         ║
║                                                                      ║
║  event_type:             leave_approved, retro_leave_approved, ...   ║
║  orchestrator_lineage_id: links to rebuild chain                    ║
║  rebuild_event_id:        links to workforce_rebuild_events          ║
╚══════════════════════════════════════════════════════════════════════╝
```

## Rebuild Dependency Order

```
Source Event                │ Step 1       │ Step 2        │ Step 3    │ Step 4+
───────────────────────────────────────────────────────────────────────────────────
leave_approved              │ (skipped)    │ leave_balance │ payroll   │ —
leave_cancelled             │ attendance   │ leave_balance │ payroll   │ —
retro_leave_approved        │ attendance   │ leave_balance │ payroll   │ reconciliation
attendance_corrected        │ attendance   │ leave_balance │ payroll   │ —
policy_changed              │ (skipped)    │ leave_balance │ payroll   │ reconciliation
attendance_finalized        │ (event only) │ —             │ —         │ —
payroll_locked              │ (event only) │ —             │ —         │ —
```

## Data Model (Phase 3 additions)

```
payroll_period_states
  tenant_id + period_month (UNIQUE)
  governance_state: open | payroll_processing | payroll_locked | payroll_archived
  locked_by, locked_at, archived_at

attendance_processing_states
  tenant_id + employee_id + work_date (UNIQUE)
  state: raw | reconstructed | finalized | payroll_locked | frozen | replay_pending
  payroll_period_state_id FK → payroll_period_states
  orchestrator_lineage_id

workforce_rebuild_events
  orchestrator_lineage_id (shared across chain)
  downstream_modules TEXT[]
  orchestration_status: initiated | sequencing | in_progress | completed | failed | cancelled
  completed_modules TEXT[]
  failed_modules TEXT[]
  replay_safety_markers JSONB

workforce_event_timeline (write-once)
  event_type (18 event types)
  source_module (7 modules)
  orchestrator_lineage_id
  rebuild_event_id FK → workforce_rebuild_events

retroactive_rebuild_queue (Phase 2 + Phase 3 columns)
  + dependency_order INT
  + orchestrator_lineage_id UUID
  + blocked_by_rebuild_id UUID (self-FK)
  + rebuild_stage TEXT
  + rebuild_scope TEXT
```

## Freeze Constraint Matrix

```
Period State           │ Rebuild Allowed │ Queue Deferred │ Requires Adjustment │ Audit Only
───────────────────────────────────────────────────────────────────────────────────────────────
open                   │ ✅ Yes          │ No             │ No                  │ No
payroll_processing     │ ✅ Yes          │ ✅ Yes         │ No                  │ No
payroll_locked         │ ❌ No           │ No             │ ✅ Yes              │ No
payroll_archived       │ ❌ No           │ No             │ No                  │ ✅ Yes
```

## Cross-Module Replay Safety Guarantees

Every orchestrated rebuild preserves:

| Field                    | Table                        | Purpose                              |
|--------------------------|------------------------------|--------------------------------------|
| orchestrator_lineage_id  | retroactive_rebuild_queue    | Links all steps in one chain         |
| orchestrator_lineage_id  | workforce_rebuild_events     | Root chain record                    |
| orchestrator_lineage_id  | workforce_event_timeline     | Audit trail linkage                  |
| orchestrator_lineage_id  | attendance_processing_states | Traceability of state transitions    |
| blocked_by_rebuild_id    | retroactive_rebuild_queue    | Enforces sequential execution        |
| dependency_order         | retroactive_rebuild_queue    | Execution ordering within chain      |
| replay_safety_markers    | workforce_rebuild_events     | Per-module idempotency guards        |

Re-running any rebuild chain is safe because:
1. `enqueueRebuild()` is idempotent via `idempotency_key = lineageId|stage|sourceEventId`
2. `writeLedgerEntry()` uses `cycle_key` unique index to prevent duplicate credits
3. `attendance_processing_states` upserts on unique constraint
4. `payroll_period_states` checks state order before advancing (no regression)
