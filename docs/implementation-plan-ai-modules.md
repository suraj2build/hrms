# CognixHR — AI Modules End-to-End Implementation Plan
**Source document:** AI_Modules_revised_version.docx  
**Scope:** All 9 modules except Module 03 (Travel — excluded by client)  
**Date:** 2026-06-30  
**Status:** Gap-fill plan — built items not repeated

---

## Fixed Decisions

| Decision | Choice | Rationale |
|---|---|---|
| WhatsApp integration | Build `WhatsAppProvider` abstraction layer | Logs to `whatsapp_outbox` DB table now; activates when `WHATSAPP_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` env vars are present |
| Mood scale | Keep 1–5 in DB, map internally | 1–2 = at risk / Not Good, 3 = OK, 4–5 = Great. No breaking migration, no data loss |

---

## MODULE 01 — AI Copilot HR Chatbot

### Gaps

#### 1.1 Policy search wired into chat as a tool
**What:** Add `search_hr_policy(query: string)` tool to `assistant-tools.ts` that calls the existing `/policies/ask` endpoint logic inline.  
**Files:**
- `apps/api/src/lib/ai/assistant-tools.ts` — add tool definition + handler
- Handler calls `search_policies()` RPC + Claude Haiku prompt (reuse `policy/index.ts` logic)  
**Returns:** `{ answer, cited_policies: [{title, category}] }`

#### 1.2 Pay components breakdown via chat
**What:** `get_pay_breakdown(month?: string)` tool returning each salary component.  
**Files:** `apps/api/src/lib/ai/assistant-tools.ts`  
**Query:** join `payroll_runs → payroll_run_employees → payroll_components` for employee's latest or specified month.

#### 1.3 Attendance calendar (monthly) via chat
**What:** `get_attendance_calendar(month: string)` tool returning `[{date, status, in_time, out_time}]` for the full month.  
**Files:** `apps/api/src/lib/ai/assistant-tools.ts`  
**Query:** `attendance_daily WHERE employee_id = ? AND date BETWEEN first_of_month AND last_of_month`

#### 1.4 Bank account update via chat
**What:** `update_bank_account(account_number, ifsc, bank_name)` tool.  
**Files:** `apps/api/src/lib/ai/assistant-tools.ts`  
**DB write:** `employee_bank_accounts` (upsert primary bank record).

#### 1.5 Emergency contact update via chat
**What:** `update_emergency_contact(name, phone, relationship)` tool.  
**Files:** `apps/api/src/lib/ai/assistant-tools.ts`  
**DB write:** `employee_family` WHERE `relation_type = 'emergency_contact'`.

#### 1.6 Helpdesk ticket status via chat
**What:** `get_ticket_status(ticket_number?: string)` tool — list own tickets or get single ticket status.  
**Files:** `apps/api/src/lib/ai/assistant-tools.ts`

#### 1.7 Helpdesk ticket escalation via chat
**What:** `escalate_ticket(ticket_number, reason?)` tool — marks ticket escalated, triggers escalation matrix.  
**Files:** `apps/api/src/lib/ai/assistant-tools.ts`

#### 1.8 Onboarding guide via chat
**What:** `get_onboarding_info()` tool — returns structured onboarding checklist (documents to submit, first-week tasks, key contacts, reporting manager name).  
**Files:** `apps/api/src/lib/ai/assistant-tools.ts`  
**Query:** `onboarding_checklists JOIN employees` for the requesting employee.

#### 1.9 WhatsApp channel support
**What:** When chat request has `channel: 'whatsapp'` header/field, route response through `WhatsAppProvider`.  
**Files:**
- `apps/api/src/lib/whatsapp-provider.ts` (new — see Infrastructure section)
- `apps/api/src/routes/assistant/index.ts` — detect channel, use WA provider for response delivery

---

## MODULE 02 — HR Helpdesk & Ticketing

### Gaps

#### 2.1 Human-readable ticket number
**What:** Auto-incrementing `ticket_number` in format `TKT-2026-00234`.  
**Migration:** `337_helpdesk_enhancements.sql`
```sql
CREATE SEQUENCE IF NOT EXISTS helpdesk_ticket_seq START 1;
ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS ticket_number TEXT GENERATED ALWAYS AS
    ('TKT-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' ||
     LPAD(nextval('helpdesk_ticket_seq')::TEXT, 5, '0')) STORED;
```
**Files:**
- `apps/api/src/routes/helpdesk/index.ts` — return `ticket_number` in all GET/POST responses
- `apps/web/src/pages/admin/AdminHelpdesk.tsx` — display ticket number
- `apps/web/src/pages/ess/EssHelpdesk.tsx` — show ticket number in confirmation + list

#### 2.2 POSH + Compliance ticket categories
**Migration:** `337_helpdesk_enhancements.sql` — update `category` CHECK constraint; add `helpdesk_category_sla` rows  
```sql
-- POSH: 90-day statutory timeline; internal SLA 5 working days for first response
-- Compliance: 48h
INSERT INTO helpdesk_category_sla (tenant_id, category, response_hours, resolution_hours)
  SELECT id, 'posh', 4, 120 FROM tenants
  ON CONFLICT DO NOTHING;
```
**Files:** Frontend category dropdowns in `EssHelpdesk.tsx` + `AdminHelpdesk.tsx`

#### 2.3 Sub-team assignment suggestion
**What:** Extended `detectCategory()` also returns `suggested_team`.  
**Mapping:**
```
payroll      → HR-Payroll
leave/attendance → HR-Operations
it           → IT-Support
facilities   → Admin
posh         → ICC (Internal Complaints Committee)
compliance   → Compliance
hr_policy    → HR-Operations
grievance    → HR-Manager
```
**Migration:** `ADD COLUMN ai_suggested_team TEXT` on `helpdesk_tickets`  
**Files:** `apps/api/src/routes/helpdesk/index.ts`

#### 2.4 AI resolution suggestion from similar past tickets
**What:** `GET /helpdesk/tickets/:id/ai-suggest` fetches 5 most-recently-resolved tickets in same category (FTS similarity on description), injects them as examples into the Haiku prompt.  
**Files:** `apps/api/src/routes/helpdesk/index.ts`

#### 2.5 Auto-acknowledgement on ticket creation
**What:** Synchronously on `POST /helpdesk/tickets`:
1. Insert system comment: "Your query has been received. Ticket #TKT-XXXX is assigned to our {team} team. Expected resolution within {sla}h."
2. Send WhatsApp via `WhatsAppProvider`: same message to employee's phone.  
**Files:** `apps/api/src/routes/helpdesk/index.ts`  
**No scheduler needed** — happens inline in the creation handler.

#### 2.6 Sort by SLA urgency
**What:** `GET /helpdesk/tickets?sort=sla_urgency` — sorts by `(sla_due_at - NOW())` ASC (most urgent first).  
**Files:** `apps/api/src/routes/helpdesk/index.ts` — add sort branch  
**Frontend:** `AdminHelpdesk.tsx` — add "Sort by SLA urgency" button to ticket list toolbar.

#### 2.7 Knowledge Base from resolved tickets
**What:** HR can promote a resolved ticket to an FAQ entry.  
**Migration:** `337_helpdesk_enhancements.sql`
```sql
ALTER TABLE helpdesk_tickets
  ADD COLUMN kb_promoted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN kb_promoted_at TIMESTAMPTZ,
  ADD COLUMN kb_summary TEXT;
```
**Endpoint:** `POST /helpdesk/tickets/:id/promote-to-kb`
- LLM (Haiku) converts ticket title + resolution thread → Q&A format
- Inserts row into `hr_policies` with `category: 'faq'`, `status: 'published'`  
**Frontend:** "Add to Knowledge Base" button on resolved ticket detail in `AdminHelpdesk.tsx`

#### 2.8 Escalation matrix (per-category, per-level)
**Migration:** `337_helpdesk_enhancements.sql`
```sql
CREATE TABLE IF NOT EXISTS helpdesk_escalation_matrix (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  level          INT  NOT NULL CHECK (level IN (1, 2)),
  assignee_role  TEXT NOT NULL,  -- 'hr_admin', 'hr_manager', 'chro', 'it_manager', etc.
  notify_after_hours INT NOT NULL DEFAULT 24,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category, level)
);
```
Seed default matrix from document spec.  
**`sla-scanner.ts`:** On breach, look up `helpdesk_escalation_matrix` for `(category, level)`, notify the correct role.  
**Frontend:** Escalation Matrix tab in `AdminHelpdesk.tsx` (CRUD for HR admin to configure).

---

## MODULE 04 — Absconding Case Management

### Gaps

#### 4.1 Day 1–2 early UA alert (pre-flag notification)
**What:** When ≥ 2 consecutive UA days detected but case not yet opened → notify reporting manager via `notifyHrAdmins()` / inbox item. No case created.  
**Files:** `apps/api/src/lib/absconding-engine.ts` — add check before `openCase()` call

#### 4.2 Day 5 second escalation step
**What:** New `second_escalation` status in the state machine (between `flagged` and `warning_letter_1`).  
**Migration:** `338_absconding_enhancements.sql` — add `second_escalation` to status CHECK constraint  
**`absconding-engine.ts`:** In `processEscalation()`: if `absent_days >= 5 AND status = 'flagged'` → transition to `second_escalation`; auto-log communication entry; notify Store Manager + HR Executive.

#### 4.3 Full merge fields in letter variables
**What:** Letter `variables` JSONB must include: `employee_name`, `employee_code`, `designation`, `store_name`, `manager_name`, `absent_from_date`, `absent_days`, `response_deadline`, `ref_number`.  
**Files:** `apps/api/src/lib/absconding-engine.ts` `generateLetter()` — add query:
```sql
SELECT e.first_name, e.last_name, e.employee_code, e.designation,
       wl.name AS store_name,
       p.first_name || ' ' || p.last_name AS manager_name
FROM employees e
LEFT JOIN work_locations wl ON wl.id = e.work_location_id
LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
LEFT JOIN profiles p ON p.employee_id = mgr.id
WHERE e.id = $1
```

#### 4.4 PDF generation for letters
**What:** Generate actual PDF file and store in Supabase Storage.  
**New package:** `pdfkit` in `apps/api/package.json`  
**New file:** `apps/api/src/lib/pdf-generator.ts`
- `generateAbscondingLetter(letterType: 'wl1'|'wl2'|'termination', variables: object): Promise<Buffer>`
- PDFKit renders: company letterhead (CognixHR logo + address), date, letter body with merge fields, signature line
- Upload to Supabase Storage bucket `generated-documents/absconding/{tenantId}/{ref_number}.pdf`
- Store `file_url` (signed URL, 1-year expiry) on `letters` record  
**New endpoint:** `GET /absconding/cases/:id/letters/:letterId/download` → redirect to signed URL  
**Frontend:** "Download PDF" button on each letter in `AbscondingCaseManagement.tsx`

#### 4.5 FnF auto-trigger on termination
**What:** In `processTermination()` after setting case `terminated`:
1. Call `fnf-settlement-engine.ts` `initiateSettlement(tenantId, employeeId, terminationDate)`
2. Update `employees.status = 'terminated'`
3. Log FnF trigger in audit trail  
**Files:** `apps/api/src/lib/absconding-engine.ts`

#### 4.6 Asset recovery flag
**Migration:** `338_absconding_enhancements.sql`
```sql
ALTER TABLE absconding_cases
  ADD COLUMN asset_recovery_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN asset_recovery_notes TEXT,
  ADD COLUMN asset_recovery_resolved_at TIMESTAMPTZ;
```
In `processTermination()`: if `SELECT COUNT(*) FROM asset_assignments WHERE employee_id = ? AND status = 'active'` > 0 → set `asset_recovery_required = true`.  
**Frontend:** Asset recovery status badge + "Mark Resolved" button in case detail sheet.

---

## MODULE 05 — Mood Polls

### Gaps

#### 5.1 Automated weekly poll delivery scheduler
**New file:** `apps/api/src/lib/poll-scheduler.ts`
- `registerPollScheduler(supabase)` — sets up an interval (runs every 60 minutes)
- On Monday between 09:00–09:05 server time: for each active tenant, check if a `pulse_questions` entry of type `weekly_pulse` was already created today (dedup by `DATE(created_at) = TODAY`)
- If not: create one `pulse_questions` row (tenant-wide weekly poll)
- Query all active employees for that tenant
- For each employee: send WhatsApp via `WhatsAppProvider`: template `mood_poll_weekly`: "Hi {name}! How are you feeling at work this week? Reply 1 (Great) / 2 (OK) / 3 (Not Good)"
- Log dispatch to `whatsapp_outbox`  
**Register in:** `apps/api/src/index.ts` alongside `registerIntelligenceScanner`

#### 5.2 Auto-trigger event-based poll types
**Intelligence scanner (scan target 9 addition):** `scanAutoPolls(supabase, tenantId)`:
- **Onboarding polls (Day 30/60/90):** `SELECT id, joining_date FROM employees WHERE joining_date + N days = TODAY`  → create `pulse_questions` of type `onboarding` for those employees
- **Post-transfer poll (Day 14):** `SELECT employee_id FROM employee_transfers WHERE effective_date + 14 = TODAY` → create `pulse_questions` of type `post_transfer`
- **Post-appraisal poll (Day 3):** `SELECT employee_id FROM performance_appraisals WHERE DATE(completed_at) = TODAY - 3 AND status = 'completed'` → create `pulse_questions` of type `post_appraisal`

#### 5.3 LLM-based theme categorization of open-text notes
**Migration:** `339_mood_enhancements.sql`
```sql
ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS sentiment_category TEXT;
```
**Files:** `apps/api/src/routes/mood/index.ts` — replace `detectSentiment()` with:
```typescript
async function categoriseWithLLM(note: string): Promise<{category: string; sentiment: string}> {
  // Call Claude Haiku
  // Prompt: "Categorize this employee feedback into one of: Manager Quality, Workload,
  //   Compensation, Work Environment, Career Growth, Team Dynamics, Personal, Other.
  //   Also label sentiment: positive/neutral/negative. Return JSON only."
}
```
Store result in `sentiment_category` + `sentiment_label` columns.

#### 5.4 HR alert when 3+ employees in same store report same theme
**Intelligence scanner (scan target 10):** `scanMoodThemeAlerts(supabase, tenantId)`:
- Query `mood_checkins` for last 7 days, group by `work_location_id + sentiment_category`
- WHERE `sentiment_label = 'negative' AND COUNT(DISTINCT employee_id) >= 3`
- `notifyHrAdmins()` with `severity: 'warning'`, title: "3+ employees in {store} reported {category} concerns"
- Dedup key: `mood-theme:{tenantId}:{locationId}:{category}:{ISO_week}`

#### 5.5 Min-5 respondent privacy guard
**Migration:** `339_mood_enhancements.sql` — update `mood_store_monthly` view:
```sql
-- Add HAVING clause to existing view definition
HAVING COUNT(DISTINCT employee_id) >= 5
```
**Files:** `apps/api/src/routes/mood/index.ts` — filter out stores with < 5 in `store-breakdown` response.

#### 5.6 Cluster + region mood breakdown
**Migration:** `339_mood_enhancements.sql` — new views `mood_cluster_monthly`, `mood_region_monthly` joining via `work_locations → clusters → regions` (check these tables exist, add if missing).  
**Endpoints:**
- `GET /mood/admin/cluster-breakdown` 
- `GET /mood/admin/region-breakdown`  
**Frontend:** Add Cluster / Region tabs to `AdminMoodDashboard.tsx`

#### 5.7 70% participation rate tracking
**Files:** `apps/api/src/routes/mood/index.ts` — in `GET /mood/admin/dashboard`:
```typescript
const participation_rate = (distinctRespondentsThisMonth / totalActiveEmployees) * 100
```
**Frontend:** `AdminMoodDashboard.tsx` — participation gauge with 70% target line.

#### 5.8 WhatsApp inbound reply processing (mood poll responses)
**Endpoint:** `POST /whatsapp/webhook` — receives inbound WhatsApp messages  
- If message body is `1`, `2`, or `3` and employee has a pending weekly poll → auto-create `mood_checkin` with mapped score (1→5, 2→3, 3→1)
- If message is free text following a poll reply → save as `note` on the mood check-in

---

## MODULE 06 — Rewards & Recognition

### Gaps

#### 6.1 Missing "Best Billing Associate" formal award
**Migration / seed:** `334_formal_awards.sql` update or new seed file:
```sql
INSERT INTO formal_awards (tenant_id, name, frequency, eligibility_group, approver_role, monetary_value, currency)
SELECT id, 'Best Billing Associate', 'monthly', 'Billing Associates', 'cluster_manager', 500, 'INR'
FROM tenants WHERE id = 'd0000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;
```

#### 6.2 Multi-level approval routing for formal award nominations
**Migration:** `344_rr_enhancements.sql`
```sql
ALTER TABLE award_nominations
  ADD COLUMN IF NOT EXISTS approval_level  INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_by_l1  UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by_l2  UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS l1_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS l2_approved_at  TIMESTAMPTZ;
```
**Endpoints:**
- `POST /recognition/nominations/:id/approve` with `{ level: 1 | 2 }` body
- Level 1 (Store Manager): transitions to `level_2_pending`
- Level 2 (Cluster/Regional Manager): transitions to `winner`  
**Frontend:** `AdminRecognition.tsx` — separate approval queues per level; role-gated views

#### 6.3 WhatsApp notification on recognition
**Files:** `apps/api/src/routes/recognition/index.ts`  
On peer badge creation → `WhatsAppProvider.sendTemplate(employeePhone, 'peer_recognition', { giver_name, message })`  
On formal award winner declared → `WhatsAppProvider.sendTemplate(winnerPhone, 'formal_award_won', { award_name })`

---

## MODULE 07 — Benefits Management

### Gaps

#### 7.1 Designation-band eligibility on plans
**Migration:** `340_benefits_enhancements.sql`
```sql
ALTER TABLE benefit_plans
  ADD COLUMN IF NOT EXISTS eligible_bands TEXT[] DEFAULT '{store_staff,store_management,corporate_ho}';
```
**Files:** `apps/api/src/routes/benefits/index.ts` — filter `benefit_plans` by employee's `designation_band` field  
**Requires:** `employees` table must have `designation_band TEXT` — add if missing (`store_staff | store_management | corporate_ho`)  
**Frontend:** `AdminBenefits.tsx` — plan edit form includes multi-select for eligible bands

#### 7.2 ESIC vs private medical insurance distinction
**Migration:** `340_benefits_enhancements.sql`
```sql
ALTER TABLE employees ADD COLUMN IF NOT EXISTS esic_eligible BOOLEAN
  GENERATED ALWAYS AS (gross_salary IS NOT NULL AND gross_salary <= 21000) STORED;
```
**Files:** `apps/api/src/routes/benefits/index.ts` — in employee's plan list: if `esic_eligible = true`, tag health plans as "ESIC Covered"; hide private GMC plans  
**Frontend:** `EssBenefits.tsx` — show "You are covered under ESIC (statutory medical insurance)" info banner for eligible employees

#### 7.3 Annual enrolment auto-open/close + notification
**Intelligence scanner (scan target 11):** `scanBenefitsEnrolment(supabase, tenantId)`:
- Query `benefit_plans WHERE enrollment_opens_at <= NOW() AND status != 'open'` → set `status = 'open'`; `notifyHrAdmins()` + send inbox to all eligible employees: "Benefits enrolment is now open. Update your coverage by {close_date}."
- Query `benefit_plans WHERE enrollment_closes_at <= NOW() AND status = 'open'` → set `status = 'active'`; notify HR: "Benefits enrolment window has closed."

#### 7.4 NPS as a plan type
**Migration:** `340_benefits_enhancements.sql` — add `nps` to `plan_type` CHECK constraint  
Seed a NPS plan with `employee_contribution_pct`, `employer_contribution_pct` fields  
**Migration:** add `employee_contribution_pct NUMERIC(5,2)` + `employer_contribution_pct NUMERIC(5,2)` columns to `benefit_plans`

#### 7.5 GMC agency integration stub
**New file:** `apps/api/src/lib/insurance-provider.ts`
```typescript
export class InsuranceProvider {
  async syncEnrolment(tenantId: string, employeeId: string, planId: string, dependentIds: string[]) {
    // Log to insurance_outbox; when INSURANCE_API_KEY is set, make real HTTP call
  }
  async getClaimStatus(employeeId: string): Promise<{claims: Claim[]}> { ... }
}
```
**Migration:** `340_benefits_enhancements.sql`
```sql
CREATE TABLE IF NOT EXISTS insurance_outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  event_type   TEXT NOT NULL, -- 'enrolment_sync' | 'dependent_update'
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Called from `POST /benefits/enrol` after successful DB write.

---

## MODULE 08 — HR Knowledge Base & Policy Search

### Gaps

#### 8.1 Hindi / multilingual support
**Files:** `apps/api/src/routes/policy/index.ts` — on `POST /policies/ask`:
```typescript
const isHindi = /[ऀ-ॿ]/.test(query) // detect Devanagari script
const lang = isHindi ? 'Hindi' : 'English'
// System prompt: "Respond in {lang}. Be concise and quote the policy clause."
```
Also accept explicit `language: 'hi' | 'en'` in request body.

#### 8.2 Policy acknowledgement rate by store / cluster / region
**Files:** `apps/api/src/routes/policy/index.ts` — extend `GET /admin/:id/acks`:
```typescript
// Join policy_acknowledgements → employees → work_locations
// Group by work_location_id to compute per-store rate
// Add cluster/region grouping
```
Response: add `location_breakdown: [{location_id, name, type: 'store'|'cluster', total, acknowledged, rate}]`  
**Frontend:** `AdminPolicyLibrary.tsx` — add Location Breakdown tab in policy detail view

#### 8.3 Auto-assign mandatory policies to new joiners
**Migration:** `341_policy_enhancements.sql`
```sql
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN NOT NULL DEFAULT false;
```
**Intelligence scanner (scan target 12):** `scanNewJoinerPolicyAssignment(supabase, tenantId)`:
- Query `employees WHERE DATE(joining_date) = CURRENT_DATE AND status = 'active'`
- For each new joiner: find all `hr_policies WHERE is_mandatory = true AND status = 'published' AND tenant_id = ?`
- Insert into `policy_acknowledgements` (pending) for each
- Send inbox notification + WhatsApp via `WhatsAppProvider`: "Welcome to Citykart! Please read and acknowledge your mandatory company policies."

#### 8.4 Missing policy categories
**Migration:** `341_policy_enhancements.sql`
```sql
-- Update category CHECK to add: attendance, notice_period, payroll, faq
ALTER TABLE hr_policies DROP CONSTRAINT IF EXISTS hr_policies_category_check;
ALTER TABLE hr_policies ADD CONSTRAINT hr_policies_category_check
  CHECK (category IN ('leave','compensation','conduct','recruitment','learning',
                      'health','it','other','attendance','notice_period','payroll','faq'));
```
**Frontend:** Update category dropdown in `AdminPolicyLibrary.tsx`

#### 8.5 WhatsApp policy delivery on publish
**Files:** `apps/api/src/routes/policy/index.ts` — on `PATCH /admin/:id` when `status` changes to `'published'` and `requires_acknowledgement = true`:
- Fetch all employee phones for the tenant
- `WhatsAppProvider.sendTemplate(phone, 'policy_published', {title, link})`

**WhatsApp inbound for policy ack:**
- `POST /whatsapp/webhook` — if message body matches `ACK {policyId}` → call `POST /policies/{policyId}/ack` for that employee internally

---

## MODULE 09 — Employee Engagement & Survey Management

### Gaps

#### 9.1 Seed Onboarding D60 + D90 templates
**Migration:** `342_survey_enhancements.sql`
```sql
INSERT INTO survey_templates (survey_type, name, description, questions, is_system) VALUES
('onboarding_d60', 'Onboarding Pulse – Day 60', 'Settling-in check at 60 days', '[
  {"order_idx":1,"question_text":"How clearly do you understand your key performance expectations?","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"How well have you settled into your team?","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"How adequate was the training you have received so far?","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"How effectively does your manager communicate with you?","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"How aligned do you feel with Citykart values and culture?","question_type":"rating","required":true},
  {"order_idx":6,"question_text":"What is one thing that would improve your experience at work right now?","question_type":"text","required":false}
]'::jsonb, true),
('onboarding_d90', 'Onboarding Pulse – Day 90', 'Three-month experience check', '[
  {"order_idx":1,"question_text":"Do you feel you are contributing meaningfully in your role?","question_type":"rating","required":true},
  {"order_idx":2,"question_text":"How likely are you to recommend Citykart as a great place to work?","question_type":"rating","required":true},
  {"order_idx":3,"question_text":"How supported do you feel in achieving your targets?","question_type":"rating","required":true},
  {"order_idx":4,"question_text":"How clear is your career growth path at Citykart?","question_type":"rating","required":true},
  {"order_idx":5,"question_text":"How satisfied are you with the recognition you receive for good work?","question_type":"rating","required":true},
  {"order_idx":6,"question_text":"What is working well for you at Citykart?","question_type":"text","required":false},
  {"order_idx":7,"question_text":"What is one thing Citykart could do better to support you?","question_type":"text","required":false}
]'::jsonb, true)
ON CONFLICT (survey_type) DO NOTHING;
```

#### 9.2 Auto-trigger: Onboarding D30 / D60 / D90
**Intelligence scanner (scan target 13):** `scanOnboardingSurveys(supabase, tenantId)`:
```typescript
for (const [days, type] of [[30,'onboarding_d30'],[60,'onboarding_d60'],[90,'onboarding_d90']]) {
  // Find employees whose joining_date + days = TODAY
  // Find/create active survey of that type (same pattern as scanExitIntentSurveys)
  // Auto-assign if not assigned in last 30 days
  // notifyHrAdmins() with summary
}
```

#### 9.3 Auto-trigger: Post-Appraisal Survey (3-day window)
**Intelligence scanner (scan target 14):** `scanPostAppraisalSurveys(supabase, tenantId)`:
- Query `performance_appraisals WHERE DATE(completed_at) = CURRENT_DATE - 3 AND status = 'completed' AND tenant_id = ?`
- For each employee in result: find/create active `post_appraisal` survey; auto-assign if not assigned for an appraisal in last 90 days

#### 9.4 Auto-trigger: Post-Transfer Survey (14-day window)
**Intelligence scanner (scan target 15):** `scanPostTransferSurveys(supabase, tenantId)`:
- Query `employee_transfers WHERE DATE(effective_date) = CURRENT_DATE - 14 AND tenant_id = ?`
- Auto-assign `post_transfer` survey to each transferred employee

#### 9.5 360° Feedback — Full Multi-Rater Flow

**Migration:** `342_survey_enhancements.sql`
```sql
CREATE TABLE IF NOT EXISTS feedback_360_rounds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_id       UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  nominee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  peers_required  INT NOT NULL DEFAULT 3,
  status          TEXT NOT NULL DEFAULT 'nomination_open'
                  CHECK (status IN ('nomination_open','approved','surveys_sent','closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, nominee_id)
);

CREATE TABLE IF NOT EXISTS feedback_360_nominators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    UUID NOT NULL REFERENCES feedback_360_rounds(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('peer','manager','direct_report')),
  UNIQUE (round_id, employee_id)
);
```

**New endpoints:**
- `POST /surveys/admin/:id/360/setup` — HR creates rounds for each nominee (body: `{nominee_ids: []}`)
- `GET /surveys/my/360/nominations` — employee sees their pending nomination requests
- `POST /surveys/my/360/:roundId/nominate` — employee nominates peers (body: `{peer_ids: []}`)
- `POST /surveys/admin/360/:roundId/approve` — HR approves nominations → creates `survey_assignments` for each nominee with correct `respondent_type`
- `GET /surveys/admin/:id/360-report/:employeeId` — consolidated multi-source report: scores broken down by `respondent_type`

**Frontend:**
- `AdminSurveyDetail.tsx` — 360 Setup tab (nominee list, nomination status, approve button)
- `EssSurveys.tsx` — "Nominate peers for 360 Feedback" panel; EmployeeSelector for peer search

#### 9.6 LLM-based sentiment + theme extraction on open-text survey responses
**Migration:** `342_survey_enhancements.sql`
```sql
CREATE TABLE IF NOT EXISTS survey_response_analysis (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  UUID NOT NULL UNIQUE, -- survey_responses.id
  sentiment    TEXT NOT NULL CHECK (sentiment IN ('positive','neutral','negative')),
  themes       TEXT[] NOT NULL DEFAULT '{}',
  urgency      TEXT NOT NULL CHECK (urgency IN ('low','medium','high')),
  analyzed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Files:** `apps/api/src/routes/surveys/index.ts` — on `POST /:id/submit`, for each `text` type response:
```typescript
const analysis = await analyseWithLLM(responseText)
// INSERT INTO survey_response_analysis
```
Replace `analyseSentiment()` word-list with LLM (Claude Haiku) call.

#### 9.7 HR alert on negative theme cluster
**Intelligence scanner (scan target 16):** `scanSurveyNegativeClusters(supabase, tenantId)`:
- Join `survey_response_analysis → survey_responses → survey_assignments → employees → work_locations`
- Group by `work_location_id + themes[]`; if ≥ 3 responses with same theme + `sentiment = 'negative' AND urgency = 'high'` in last 30 days
- `notifyHrAdmins()` severity `critical`: "Negative theme cluster detected in {store}: {theme}"

#### 9.8 Survey results by store / cluster / region
**Files:** `apps/api/src/routes/surveys/index.ts` — extend `GET /admin/:id/results`:
- Accept `?group_by=store|cluster|region` query param
- JOIN `survey_assignments → employees → work_locations` to build per-location score summaries
- Return `location_breakdown: [{location_id, name, avg_score, completion_rate}]`  
**Frontend:** `AdminSurveyDetail.tsx` — "Location Breakdown" tab in Results view

#### 9.9 Expand Annual Engagement Survey to 35 questions
**Migration:** `342_survey_enhancements.sql`
```sql
UPDATE survey_templates
SET questions = '[
  -- Pride & Belonging (4 Q)
  {"order_idx":1,"question_text":"I am proud to work at Citykart.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":2,"question_text":"I feel a strong sense of belonging at Citykart.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":3,"question_text":"I would be sad to leave Citykart even if offered similar pay elsewhere.","question_type":"rating","required":true,"dimension":"pride"},
  {"order_idx":4,"question_text":"Citykart lives up to its values in the way it treats employees.","question_type":"rating","required":true,"dimension":"pride"},
  -- Advocacy (3 Q)
  {"order_idx":5,"question_text":"I would recommend Citykart as a great place to work.","question_type":"rating","required":true,"dimension":"advocacy"},
  {"order_idx":6,"question_text":"Senior leaders communicate openly and honestly.","question_type":"rating","required":true,"dimension":"advocacy"},
  {"order_idx":7,"question_text":"I trust the leadership of this organisation.","question_type":"rating","required":true,"dimension":"advocacy"},
  -- Commitment (4 Q)
  {"order_idx":8,"question_text":"I plan to still be working at Citykart in 12 months.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":9,"question_text":"I understand how my work contributes to Citykart goals.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":10,"question_text":"I am motivated to go above and beyond in my role.","question_type":"rating","required":true,"dimension":"commitment"},
  {"order_idx":11,"question_text":"The work I do is meaningful to me.","question_type":"rating","required":true,"dimension":"commitment"},
  -- Manager Quality (5 Q)
  {"order_idx":12,"question_text":"My manager supports my development and treats me fairly.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":13,"question_text":"My manager gives me useful feedback on my performance.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":14,"question_text":"My manager recognises and appreciates good work.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":15,"question_text":"My manager handles conflicts and challenges effectively.","question_type":"rating","required":true,"dimension":"manager"},
  {"order_idx":16,"question_text":"I feel comfortable raising concerns with my manager.","question_type":"rating","required":true,"dimension":"manager"},
  -- Career Growth (4 Q)
  {"order_idx":17,"question_text":"I have opportunities to grow and advance my career at Citykart.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":18,"question_text":"I have received adequate training to do my job well.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":19,"question_text":"My skills and abilities are being fully utilised here.","question_type":"rating","required":true,"dimension":"growth"},
  {"order_idx":20,"question_text":"Citykart invests in developing its people.","question_type":"rating","required":true,"dimension":"growth"},
  -- Compensation Fairness (3 Q)
  {"order_idx":21,"question_text":"I am paid fairly for the work I do.","question_type":"rating","required":true,"dimension":"compensation"},
  {"order_idx":22,"question_text":"The benefits offered by Citykart meet my needs.","question_type":"rating","required":true,"dimension":"compensation"},
  {"order_idx":23,"question_text":"The total rewards package makes me feel valued.","question_type":"rating","required":true,"dimension":"compensation"},
  -- Work Conditions (4 Q)
  {"order_idx":24,"question_text":"My work environment is safe, clean, and comfortable.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":25,"question_text":"I have the tools and resources I need to do my job well.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":26,"question_text":"My workload is manageable.","question_type":"rating","required":true,"dimension":"work_conditions"},
  {"order_idx":27,"question_text":"I am able to maintain a healthy work-life balance.","question_type":"rating","required":true,"dimension":"work_conditions"},
  -- Recognition (4 Q)
  {"order_idx":28,"question_text":"My contributions are recognised and appreciated at Citykart.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":29,"question_text":"When I do good work, my manager acknowledges it.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":30,"question_text":"Citykart celebrates team and individual success.","question_type":"rating","required":true,"dimension":"recognition"},
  {"order_idx":31,"question_text":"I feel the performance evaluation process here is fair.","question_type":"rating","required":true,"dimension":"recognition"},
  -- Open Text (4 Q)
  {"order_idx":32,"question_text":"What aspect of working at Citykart do you value most?","question_type":"text","required":false,"dimension":"general"},
  {"order_idx":33,"question_text":"What is the single biggest improvement that would make Citykart a better place to work?","question_type":"text","required":false,"dimension":"general"},
  {"order_idx":34,"question_text":"Do you feel Citykart cares about your wellbeing? Please share your thoughts.","question_type":"text","required":false,"dimension":"general"},
  {"order_idx":35,"question_text":"Any other comments or suggestions for HR or leadership?","question_type":"text","required":false,"dimension":"general"}
]'::jsonb
WHERE survey_type = 'annual_engagement';
```

#### 9.10 Attrition risk signal from deteriorating onboarding scores
**Intelligence scanner (scan target 17):** `scanOnboardingDegradation(supabase, tenantId)`:
- For each employee who has both D30 and D60 survey results: compute avg score per survey
- If D60 avg < D30 avg by ≥ 1.0 point (on 5-pt scale): `notifyHrAdmins()` severity `warning`: "{name}'s onboarding experience score dropped from {d30_score} to {d60_score} — possible early attrition risk."

---

## MODULE 10 — Succession Planning

### Gaps

#### 10.1 AI recommendations wired to live data
**Files:** `apps/api/src/routes/succession/index.ts` — rewrite `GET /succession/ai-recommendations` computation:
```typescript
// Performance: latest appraisal rating from performance_appraisals → normalize to 1-10
// Skill: skill_assessments → % of target role's required skills met at required level
// Tenure: compute from employees.joining_date → normalize to 1-10
// Attrition risk: from mood data avg (past 3 months) → invert and normalize
// Leadership: from manager_effectiveness survey avg score if available
// Mobility: succession_candidates.transfer_willingness (already stored)
```
Feed all computed values into existing `computeWeightedScore()` — no change to scoring logic.

#### 10.2 Automated monthly attrition cross-check for successors
**Intelligence scanner (scan target 18):** `scanSuccessionAttritionRisk(supabase, tenantId)`:
- Query `succession_candidates WHERE readiness_status IN ('ready_now', 'ready_12m')`
- For each: compute 3-month mood avg from `mood_checkins`; if avg ≤ 2.5 (1-5 scale, maps to "at risk") → set `attrition_risk_flag = true`
- `notifyHrAdmins()`: "⚠️ Succession Risk: {name} (successor for {role}) shows high attrition risk. Review the succession plan."
- Dedup key: `succession-attrition:{tenantId}:{candidateId}:{month}`

#### 10.3 9-Box auto-plot from appraisal data
**Files:** `apps/api/src/routes/succession/index.ts` — in `GET /nine-box`:
- If `nine_box_performance IS NULL`: derive from latest `performance_appraisals.rating` → 1–3 → 1, 4–6 → 2, 7–10 → 3
- If `nine_box_potential IS NULL`: derive from 360-degree manager effectiveness score (if available) or default to 2  
**Stuck-in-box detection:** Compare last 2 appraisal cycles; if `nine_box_performance + nine_box_potential` unchanged → flag in response + `notifyHrAdmins()` once per (employee, cycle): "Consider a career conversation with {name} — same 9-box position for 2 consecutive cycles."

#### 10.4 IDP AI Auto-Generator
**New endpoint:** `POST /succession/plans/:planId/candidates/:candidateId/idp/generate`  
**Logic:**
1. Fetch candidate's skill profile (from `skill_assessments` or `succession_candidates.skill_scores`)
2. Fetch target role's required skills (from `succession_plans.required_skills JSONB`)
3. Identify top 3–5 skill gaps (current level < required level)
4. Call Claude Haiku: "For each skill gap, suggest an IDP action with: action_type (training|mentoring|stretch_assignment), description, suggested_lms_course_name, target_completion_months. Return JSON array."
5. Return suggested actions to HR for review (do NOT auto-save — HR must approve)  
**Endpoint:** `POST /succession/plans/:planId/candidates/:candidateId/idp/save-ai` — saves approved actions  
**Frontend:** "AI Generate IDP" button in candidate detail; shows suggested actions with approve/reject per item.

#### 10.5 Digital Calibration Session
**Migration:** `343_succession_enhancements.sql`
```sql
CREATE TABLE IF NOT EXISTS calibration_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  created_by   UUID REFERENCES profiles(id),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  participants JSONB NOT NULL DEFAULT '[]',  -- array of profile_id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS calibration_changes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
  changed_by    UUID NOT NULL REFERENCES profiles(id),
  candidate_id  UUID NOT NULL REFERENCES succession_candidates(id),
  field_changed TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  notes         TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Endpoints:**
- `POST /succession/calibration` — create session (body: `{title, participant_profile_ids[]}`)
- `GET /succession/calibration/:id` — full session view with all plans + current scores
- `PATCH /succession/calibration/:id/candidates/:cid` — make a change; writes to `calibration_changes` + updates `succession_candidates`
- `POST /succession/calibration/:id/close` — close session; generate report (list of all changes with who/when/what)
- `GET /succession/calibration/:id/report` — downloadable PDF of session changes

**Frontend:** New page `AdminCalibration.tsx`:
- List of open/closed calibration sessions
- Session detail: all succession plans in a table view; editable scores; change log sidebar
- Polling every 10 seconds to refresh changes from other participants
- "Close Session & Generate Report" button

#### 10.6 AI What-If Scenario Modelling
**New endpoint:** `POST /succession/scenarios`
```typescript
// Body: { scenario_name: string, affected_employee_ids: string[] }
// Logic:
// 1. Find all succession plans where any of the affected_employee_ids is the incumbent
// 2. For each: find ready_now successors; if none → 'uncovered'
// 3. Check if ready_now successors are themselves in affected_employee_ids → 'cascade_gap'
// 4. Return: { uncovered_roles, covered_roles, cascade_gaps, estimated_recovery_weeks }
// estimated_recovery_weeks: uncovered → 8-12w (external hire), cascade → 12-16w
```
**Frontend:** Scenario panel in `AdminSuccession.tsx` (side panel):
- EmployeeSelector (multi) to pick affected employees
- "Run Scenario" button → shows result cards: X roles uncovered, Y cascade gaps, Z roles covered
- "Download scenario report" PDF

#### 10.7 Mentorship Matching Engine
**Migration:** `343_succession_enhancements.sql`
```sql
CREATE TABLE IF NOT EXISTS mentor_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  skill_tags       TEXT[] NOT NULL DEFAULT '{}',
  max_mentees      INT NOT NULL DEFAULT 2,
  current_mentees  INT NOT NULL DEFAULT 0,
  available        BOOLEAN NOT NULL DEFAULT true,
  engagement_score NUMERIC(4,1),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**New endpoint:** `POST /succession/plans/:planId/candidates/:cid/match-mentor`
```typescript
// 1. Get candidate's top 2 skill gaps
// 2. Query mentor_profiles WHERE available = true AND current_mentees < max_mentees
// 3. Score each mentor:
//    - Skill overlap: count(mentor.skill_tags ∩ candidate_gap_skills) / candidate_gap_skills.length
//    - Proximity: same cluster_id → +0.3, same region → +0.2, different → 0
//    - Engagement: mentor.engagement_score / 10
//    - Weighted score: skill*0.5 + proximity*0.3 + engagement*0.2
// 4. Return top 3 mentors with match_score + skill_overlap explanation
```
**Endpoint:** `POST /succession/plans/:planId/candidates/:cid/assign-mentor` — assigns mentor; increments `current_mentees`  
**Frontend:** "Find Mentor" section in IDP tab of candidate detail; shows top-3 mentor cards with match score.

#### 10.8 Color-coded bench strength dashboard tiles
**Files:** `apps/api/src/routes/succession/index.ts` — extend `GET /succession/dashboard`:
```typescript
// For each plan: compute bench_strength_color
// 🟢 Green: ready_now_count >= 2
// 🟡 Amber: ready_now_count == 1 OR ready_12m_count >= 1
// 🔴 Red: ready_now_count == 0 AND ready_12m_count == 0
// ⚫ Critical: Red AND (successor has attrition_risk_flag == true OR no successors at all)
```
Add `bench_strength_summary: { green: N, amber: N, red: N, critical: N }` to dashboard response.  
**Frontend:** `AdminSuccession.tsx` — 4 color-coded KPI tiles at the top of the dashboard; click each to filter plan list by that color.

---

## INFRASTRUCTURE — Cross-Cutting

### WhatsApp Provider (used by Modules 01, 02, 05, 06, 07, 08, 09)

**Migration:** `336_whatsapp_outbox.sql`
```sql
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_phone       TEXT NOT NULL,
  template_name  TEXT NOT NULL,
  variables      JSONB NOT NULL DEFAULT '{}',
  body_preview   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sent','failed')),
  sent_at        TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_status ON whatsapp_outbox(status, created_at);
```

**New file:** `apps/api/src/lib/whatsapp-provider.ts`
```typescript
export class WhatsAppProvider {
  constructor(private supabase: SupabaseClient) {}

  async sendTemplate(tenantId: string, phone: string, template: string, variables: Record<string, string>) {
    // Always log to whatsapp_outbox
    await this.supabase.from('whatsapp_outbox').insert({ tenant_id: tenantId, to_phone: phone, template_name: template, variables, body_preview: this.preview(template, variables), status: 'pending' })
    // If credentials present, send real HTTP call to WhatsApp Cloud API
    const apiToken = process.env.WHATSAPP_API_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!apiToken || !phoneNumberId) return  // queued only
    // POST https://graph.facebook.com/v18.0/{phoneNumberId}/messages
    // ... HTTP call, update status to 'sent' or 'failed'
  }
}
```

**Templates to register in WhatsApp Business Manager** (document names for reference):
| Template name | Module | Content |
|---|---|---|
| `mood_poll_weekly` | 05 | "Hi {{name}}! How are you feeling at work this week? Reply 1 (Great) / 2 (OK) / 3 (Not Good)" |
| `ticket_acknowledgement` | 02 | "Your query has been received. Ticket {{ticket_number}} — expected resolution within {{sla_hours}}h." |
| `policy_published` | 08 | "New HR Policy: {{title}}. Please read and acknowledge at {{link}}." |
| `peer_recognition` | 06 | "🌟 {{giver_name}} appreciated you! '{{message}}'" |
| `formal_award_won` | 06 | "🏆 Congratulations! You are the winner of {{award_name}}." |
| `mood_theme_alert` | 05 | (HR-side alert — via inbox, not WhatsApp) |
| `new_joiner_policies` | 08 | "Welcome to Citykart! Please acknowledge your mandatory policies at {{link}}." |

**WhatsApp Inbound Webhook:**  
**New endpoint:** `POST /whatsapp/webhook` (public, verified by `WHATSAPP_WEBHOOK_SECRET`)  
Routes inbound messages:
- Body = `1|2|3` after a mood poll dispatch → create `mood_checkin`
- Body = `ACK {policyId}` → call policy acknowledgement
- Free text after mood reply → store as `note` on checkin
- Any other text → forward to AI Copilot chat handler

### PDF Generation (used by Modules 04, 01)

**New package:** `pdfkit` added to `apps/api/package.json`  
**New file:** `apps/api/src/lib/pdf-generator.ts`
```typescript
export async function generateLetterPDF(opts: {
  type: 'wl1' | 'wl2' | 'termination' | 'payslip'
  variables: Record<string, string | number>
  tenantId: string
  refNumber: string
}): Promise<Buffer> { ... }

export async function uploadPDF(buffer: Buffer, path: string, supabase: SupabaseClient): Promise<string> {
  // Upload to Supabase Storage bucket 'generated-documents'
  // Return signed URL (1-year expiry)
}
```

### Intelligence Scanner — New Scan Targets Summary

| Target # | Name | Trigger condition |
|---|---|---|
| 9 | `scanAutoPolls` | Event-based poll dispatch (onboarding, post-transfer, post-appraisal dates) |
| 10 | `scanMoodThemeAlerts` | 3+ employees same store, same LLM-extracted theme, negative sentiment |
| 11 | `scanBenefitsEnrolment` | `enrollment_opens_at / closes_at` threshold crossing |
| 12 | `scanNewJoinerPolicyAssignment` | `joining_date = TODAY` |
| 13 | `scanOnboardingSurveys` | `joining_date + 30/60/90 = TODAY` |
| 14 | `scanPostAppraisalSurveys` | `appraisal.completed_at + 3 = TODAY` |
| 15 | `scanPostTransferSurveys` | `transfer.effective_date + 14 = TODAY` |
| 16 | `scanSurveyNegativeClusters` | 3+ high-urgency negative survey responses in same location |
| 17 | `scanOnboardingDegradation` | D60 avg score < D30 avg by ≥ 1.0 point |
| 18 | `scanSuccessionAttritionRisk` | Ready-Now successor has mood avg ≤ 2.5 in last 3 months |

All registered in `runAllScans()` in `apps/api/src/lib/intelligence-scanner.ts`.

---

## Migrations Checklist

| Migration | File | Contents |
|---|---|---|
| 336 | `336_whatsapp_outbox.sql` | `whatsapp_outbox` table + index |
| 337 | `337_helpdesk_enhancements.sql` | Ticket number sequence; POSH/compliance categories; `ai_suggested_team`; KB promotion columns; `helpdesk_escalation_matrix` table |
| 338 | `338_absconding_enhancements.sql` | `second_escalation` status; `asset_recovery_required` columns |
| 339 | `339_mood_enhancements.sql` | `sentiment_category` column; `mood_cluster_monthly` + `mood_region_monthly` views; min-5 guard on existing view |
| 340 | `340_benefits_enhancements.sql` | `eligible_bands` on plans; `esic_eligible` on employees; NPS plan type; `insurance_outbox` table |
| 341 | `341_policy_enhancements.sql` | `is_mandatory` on policies; attendance/payroll/notice_period/faq categories |
| 342 | `342_survey_enhancements.sql` | D60/D90 templates; `survey_response_analysis` table; `feedback_360_rounds` + `feedback_360_nominators` tables; expand annual engagement to 35 Q |
| 343 | `343_succession_enhancements.sql` | `calibration_sessions` + `calibration_changes` + `mentor_profiles` tables |
| 344 | `344_rr_enhancements.sql` | Award nomination approval-level columns; `Best Billing Associate` seed award |

---

## New Files Checklist

| File | Purpose |
|---|---|
| `apps/api/src/lib/whatsapp-provider.ts` | WhatsApp send abstraction; outbox logging; real API call when credentials present |
| `apps/api/src/lib/pdf-generator.ts` | PDFKit-based letter + payslip PDF rendering; Supabase Storage upload |
| `apps/api/src/lib/poll-scheduler.ts` | Weekly Monday 9AM mood poll dispatch scheduler |
| `apps/api/src/lib/insurance-provider.ts` | GMC/insurer integration stub; `insurance_outbox` logging |
| `apps/api/src/routes/whatsapp/index.ts` | Inbound WhatsApp webhook handler |
| `apps/web/src/pages/admin/AdminCalibration.tsx` | Digital Calibration Session UI (Module 10 F7) |

---

## Modified Files Checklist (major changes)

| File | Changes |
|---|---|
| `apps/api/src/lib/ai/assistant-tools.ts` | +8 new tools (policy search, pay breakdown, attendance calendar, bank update, emergency contact update, ticket status, escalate ticket, onboarding guide) |
| `apps/api/src/lib/intelligence-scanner.ts` | +10 new scan targets (9–18); `runAllScans()` updated |
| `apps/api/src/routes/helpdesk/index.ts` | Ticket number; POSH/compliance; sub-team suggestion; similar-ticket AI suggest; auto-ack; KB promotion; escalation matrix endpoints; SLA urgency sort |
| `apps/api/src/routes/absconding/index.ts` | Day-5 state; full merge fields; PDF download endpoint |
| `apps/api/src/lib/absconding-engine.ts` | Day 1-2 early alert; Day 5 state; full letter variables; FnF trigger; asset recovery flag |
| `apps/api/src/routes/mood/index.ts` | LLM theme categorization; store/cluster/region breakdown; participation rate; min-5 guard |
| `apps/api/src/routes/recognition/index.ts` | Multi-level approval endpoints; WhatsApp notifications |
| `apps/api/src/routes/benefits/index.ts` | Band filtering; ESIC distinction; NPS plan type; insurance stub call |
| `apps/api/src/routes/policy/index.ts` | Hindi detection; location ack breakdown; new joiner auto-assign; WhatsApp on publish; faq category |
| `apps/api/src/routes/surveys/index.ts` | LLM sentiment on submission; 360 endpoints; location breakdown; negative cluster alert |
| `apps/api/src/routes/succession/index.ts` | Live-data recommendations; 9-box auto-plot; IDP AI generate; calibration endpoints; what-if scenario; mentor matching; color-coded dashboard |
| `apps/web/src/pages/admin/AdminHelpdesk.tsx` | Ticket number display; POSH category; SLA urgency sort; escalation matrix tab; KB promotion button |
| `apps/web/src/pages/admin/AdminMoodDashboard.tsx` | Cluster/region tabs; participation gauge; min-5 guard display |
| `apps/web/src/pages/admin/AdminBenefits.tsx` | Band eligibility; ESIC flag; NPS plan type |
| `apps/web/src/pages/admin/AdminPolicyLibrary.tsx` | Location ack breakdown; mandatory flag; new categories |
| `apps/web/src/pages/admin/AdminSurveyDetail.tsx` | 360 setup tab; location breakdown results tab; LLM sentiment display |
| `apps/web/src/pages/admin/AdminSuccession.tsx` | Color-coded bench strength tiles; scenario panel; IDP AI generate button |
| `apps/web/src/pages/ess/EssHelpdesk.tsx` | Ticket number; POSH category |
| `apps/web/src/pages/ess/EssBenefits.tsx` | ESIC banner; band filtering |
| `apps/web/src/pages/ess/EssSurveys.tsx` | 360 peer nomination panel |

---

## Implementation Order (suggested)

### Phase 1 — Infrastructure (unblocks everything)
1. WhatsApp Provider + outbox table (Migration 336)
2. PDF Generator (pdfkit)
3. Poll Scheduler registration

### Phase 2 — Data / Schema (migrations first, then logic)
4. Migrations 337–344 (all DB changes)

### Phase 3 — Backend (scan targets + routes)
5. Intelligence scanner scan targets 9–18
6. Helpdesk enhancements (2.1–2.8)
7. Absconding enhancements (4.1–4.6)
8. Mood route enhancements (5.3–5.8)
9. Survey enhancements incl. 360 flow (9.1–9.10)
10. Succession enhancements (10.1–10.8)
11. Benefits, Policy, R&R route updates
12. AI Copilot new tools (1.1–1.9)

### Phase 4 — Frontend
13. Admin pages: Helpdesk, MoodDashboard, Benefits, PolicyLibrary, SurveyDetail, Succession, new Calibration page
14. ESS pages: Helpdesk, Benefits, Surveys (360 nomination)

### Phase 5 — WhatsApp Inbound + Integration
15. Webhook handler for inbound messages
16. Wire WhatsApp sends across all modules
17. Insurance provider stub
