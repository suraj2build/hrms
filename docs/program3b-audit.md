# Program 3B — Certification Governance · Data Model Audit

**Date:** 2026-06-13 · **Status:** P3B.1 AUDIT COMPLETE — awaiting approval to implement
**Principle:** Extend CognixHR — reuse Program 3A lifecycle infrastructure.
Do NOT create a Certification Engine, Certification Scheduler, or Certification Dashboard.

---

## 1. Audit Findings

### 1.1 How certifications are stored today

`doc_type = 'certificate'` rows in the **`documents`** table are the only current
representation of certifications. That table's schema:

```
documents (
  id, tenant_id, employee_id,
  doc_type  CHECK ('aadhaar','pan','offer_letter','contract',
                   'certificate','relieving_letter','experience_letter','other'),
  name, storage_path, file_size, mime_type,
  expires_at,           -- only expiry tracking available
  uploaded_by, created_at
)
```

Additional FK added in migration 010:
`document_type_id UUID REFERENCES document_types(id)` — allows custom types beyond
the hardcoded CHECK, but no domain fields were added.

**What `documents` cannot express about certifications:**
- Issuing authority / credentialing body
- Credential / licence number
- Renewal-due date (distinct from expiry)
- Status lifecycle (active / expiring / expired / revoked)
- Notes / remarks

### 1.2 Related tables reviewed

| Table | Purpose | Relevant signal |
|---|---|---|
| `employee_identity` | Identity documents (Aadhaar, PAN…) with `expiry_date` | Pattern: `identity_type_id` FK to master, dedicated table |
| `employee_passport_visa` | Passports + visas with `expiry_date` | **Best precedent** — domain-rich dedicated table per type |
| `document_types` | Custom document type master | Could classify certs but still lacks domain fields |
| `identity_types` | Custom identity type master | Same limitation |

### 1.3 No `employee_certifications` table exists

Confirmed across all 245 migrations: zero references to `employee_certifications`.
Certifications are not tracked as a lifecycle category anywhere in the system.

---

## 2. Decision

### Can we extend the `documents` table?

**No.** The `documents` table is a file-storage record — it exists to track uploaded
blobs with minimal metadata. Adding columns like `issuing_authority`, `credential_id`,
`status` enum, and `renewal_due_date` would corrupt that generic contract with
certification-specific domain logic. It would also make the lifecycle engine treat
certifications identically to offer letters and Aadhaar cards, with no ability to
filter or report on certifications separately.

### Recommendation: new `employee_certifications` table (migration 246)

Follow the **`employee_passport_visa` pattern** — a dedicated table per domain entity,
with domain-specific attributes and its own `expiry_date` that feeds directly into the
existing `computeLifecycleRisks()` engine.

**Reasons this is the right call:**
1. The `employee_passport_visa` precedent is exact: separate table, expiry tracking,
   rich attributes, slots directly into lifecycle-expiry.ts.
2. The lifecycle engine is already multi-table — adding one more parallel query is
   three lines. No new scanner, no new alert path, no new notification engine.
3. Status lifecycle (`active | expiring | expired | revoked`) has no analogue in the
   generic `documents` table and must be modelled explicitly.
4. A `certification_name` + `issuing_authority` + `credential_id` triple is the
   minimum viable credentialing record — impossible to express in `name` alone.

---

## 3. Proposed Schema (migration 246)

```sql
CREATE TABLE IF NOT EXISTS employee_certifications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id        UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  certification_name TEXT        NOT NULL,
  issuing_authority  TEXT,
  credential_id      TEXT,
  issue_date         DATE,
  expiry_date        DATE,
  renewal_due_date   DATE,          -- may differ from expiry_date
  status             TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','expiring','expired','revoked')),
  notes              TEXT,
  storage_path       TEXT,          -- attached certificate file in Supabase Storage
  uploaded_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_certs_tenant_employee
  ON employee_certifications (tenant_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_emp_certs_expiry
  ON employee_certifications (tenant_id, expiry_date)
  WHERE expiry_date IS NOT NULL;
```

RLS: same tenant-isolation pattern as every other employee table.

---

## 4. Lifecycle Engine Integration Path

**Minimal delta to `lifecycle-expiry.ts`** (no new scanner, no new engine):

```typescript
// 1. Add to LifecycleCategory union:
export type LifecycleCategory =
  'document' | 'identity' | 'passport' | 'visa' | 'contract' | 'probation' | 'certification'

// 2. Add one query in the computeLifecycleRisks() parallel block:
cats.has('certification')
  ? supabase.from('employee_certifications')
      .select('id, employee_id, certification_name, issuing_authority, credential_id, expiry_date, status')
      .eq('tenant_id', tenantId).not('expiry_date', 'is', null).lte('expiry_date', horizon)
      .then(r => r.data ?? [])
  : Promise.resolve([] as any[])

// 3. Map rows → LifecycleRiskItem (same shape as document/passport rows)
// 4. Add to categoryLabel() / categoryIcon switch
// 5. Scanner self-heal: active→expired once expiry_date passes (same as contracts)
```

All downstream consumers — `GET /workforce/expiry`, Workforce Command observations,
Executive metrics, inbox scanner alerts — receive certification risk automatically,
with zero additional plumbing.

---

## 5. Build Order for Program 3B

| Item | Deliverable | Notes |
|---|---|---|
| **P3B.1** | This audit + schema decision | ✅ Done |
| **P3B.2** | Migration 246 + CRUD API (`/employees/:id/certifications`) + EmployeeProfile section | Schema creates table; API enables add/edit/view/delete |
| **P3B.3** | Extend `lifecycle-expiry.ts` + scanner self-heal | Plug `employee_certifications` into existing engine |
| **P3B.4** | Expiry Management workspace — add `certification` filter chip | Zero new pages — extend existing ExpiryManagement.tsx |
| **P3B.5** | Workforce Command observation | `computeLifecycleRisks` already surfaces it; add cert-specific observation text |
| **P3B.6** | Executive Intelligence — Certification Compliance % | Add cert row to existing lifecycle block in `/executive/compliance` |
| **P3B closure** | Closure audit | Mirror Program 3A audit document |

**No new scheduler. No new scanner. No new notification engine. No new dashboard.**
All surfaces are projections of the single `computeLifecycleRisks()` brain.

---

## 6. Migrations to apply

| # | File | Content |
|---|---|---|
| 246 | `246_employee_certifications.sql` | CREATE TABLE + 2 indexes + RLS |

No other migrations required for Program 3B.
