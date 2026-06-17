# Master Data Spec — Site / State / Cluster (+ UDF design)

Status: **DRAFT for review** · Scope: **India-only** · Owner: HRMS
Decisions captured: India-only statutory; `Site → State + Cluster` (two independent
axes); UDF mechanism **deferred** (options outlined, not yet chosen).

---

## 1. Why

The Site master today is a stub. Current `sites` columns:

| column | notes |
|---|---|
| `code` | added in migration 116 (import reference key) |
| `name` | |
| `location` | free text — not structured |
| `timezone` | default `Asia/Kolkata` |
| `state_code` | **free text** (migration 166) — should become an FK to a State master |
| `default_rotation_policy_id` | |

There is **no State master**, **no Cluster master**, and **no user-defined-field**
mechanism anywhere in the system. Statutory filing (PF/ESI/PT/LWF) is done per
registration/location, and PT/min-wage/LWF rules are **state-specific** — so State
must be a first-class master, not a text field.

---

## 2. Target model (relationships)

```
            ┌──────────────┐         ┌──────────────┐
            │  states      │         │  clusters    │  (Region → Cluster)
            │ (statutory)  │         │ (operational)│
            └──────┬───────┘         └──────┬───────┘
                   │ state_id               │ cluster_id
                   ▼                         ▼
                  ┌─────────────────────────────┐
                  │            sites            │
                  │  (links to BOTH axes)       │
                  └─────────────────────────────┘
```

- **State** = geographic + statutory axis (PT, min-wage, LWF, GST code).
- **Cluster** = operational axis (Region → Cluster → Site; cluster/area manager).
- A site references **both** `state_id` and `cluster_id` independently.

---

## 3. State Master  (new)

Migration: **`273_state_master.sql`** · table `states`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid fk → tenants | RLS-scoped (per-tenant; seed copied per tenant or global read — see §3.1) |
| `code` | text | **GST state code** (2-digit, e.g. `27`). Unique per tenant. |
| `name` | text | e.g. `Maharashtra` |
| `region` | text | North / South / East / West / NE / Central (free or enum) |
| `country` | text | default `India` |
| `pt_applicable` | bool | Professional Tax levied in this state |
| `lwf_applicable` | bool | Labour Welfare Fund applies |
| `lwf_frequency` | text | `monthly` / `half_yearly` / `annual` / null |
| `min_wage_zone` | text | optional default zone label |
| `is_active` | bool | default true |
| `custom_fields` | jsonb | reserved for UDF (§6) |
| `created_at` / `updated_at` | timestamptz | |

Unique: `(tenant_id, code)`, `(tenant_id, name)`. RLS: tenant read, hr_admin write
(same pattern as other masters).

### 3.1 Seed
Ship a seed of **all 36 states + UTs** with GST codes and correct `pt_applicable` /
`lwf_applicable` flags, e.g.:

| code | name | pt | lwf |
|---|---|---|---|
| 27 | Maharashtra | ✓ | ✓ |
| 29 | Karnataka | ✓ | ✓ |
| 19 | West Bengal | ✓ | ✓ |
| 33 | Tamil Nadu | ✓ | ✓ |
| 24 | Gujarat | ✓ | ✓ |
| 36 | Telangana | ✓ | ✗ |
| 07 | Delhi | ✗ | ✗ |
| 09 | Uttar Pradesh | ✗ | ✗ |
| 08 | Rajasthan | ✗ | ✗ |
| … | (full 36/38 list in the seed) | | |

Open question (§7): seed **per tenant on creation** vs a **global reference table**
read by all tenants. Recommendation: per-tenant seed (keeps the existing tenant-scoped
RLS model uniform; tenants can tweak flags).

---

## 4. Cluster Master  (new)

Migration: **`274_cluster_master.sql`** · table `clusters`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid fk → tenants | |
| `code` | text | unique per tenant |
| `name` | text | e.g. `Bengaluru South` |
| `region` | text | for Region → Cluster roll-ups |
| `cluster_manager_id` | uuid fk → employees (set null) | area/cluster manager |
| `parent_cluster_id` | uuid fk → clusters (set null) | optional hierarchy |
| `is_active` | bool | |
| `description` | text | |
| `custom_fields` | jsonb | UDF (§6) |
| `created_at` / `updated_at` | timestamptz | |

Unique `(tenant_id, code)`. RLS tenant read / hr_admin write.

Drives: payroll-cost / attendance / headcount roll-ups by cluster, and cluster-manager
scoping (future: a cluster manager sees their sites).

---

## 5. Site Master enhancement

Migration: **`275_site_master_expansion.sql`** — all **additive** `ADD COLUMN IF NOT
EXISTS` on the existing `sites` table (no breaking change).

**Identity & type**
`short_name`, `site_type` (`head_office|branch|regional_office|warehouse|factory|retail_store|project_site`), `status` (`active|inactive`), `opening_date`

**Grouping**
`state_id` uuid → `states`, `cluster_id` uuid → `clusters`, `cost_center_id` uuid → `cost_centers`, `parent_site_id` uuid → `sites`

**Address & geo**
`address_line1`, `address_line2`, `city`, `district`, `pincode`, `country` (default India), `latitude` numeric, `longitude` numeric, `geofence_radius_m` int

**Statutory (India)**
`gstin`, `state_code` (keep — now derivable from `states.code`), `pf_registration_no`, `esi_registration_no`, `pt_registration_no`, `lwf_registration_no`, `shops_estab_reg_no`, `factory_license_no`

**Operations**
`default_shift_id` uuid → shifts, `default_roster_id` uuid → rosters, `default_rotation_policy_id` (exists), `contact_person`, `contact_phone`, `contact_email`, `sanctioned_headcount` int

**UDF**
`custom_fields` jsonb

**Back-compat:** existing free-text `state_code` rows are preserved; a one-time helper
can map `state_code` → `state_id` by matching `states.code`/`name`.

---

## 6. UDF (User-Defined Fields) — design, decision deferred

Goal: let a tenant add custom attributes to any master without a schema change.

**Option A — JSONB + definition registry (recommended)**
- New table `master_field_definitions(tenant_id, master_type, field_key, label,
  data_type, required, options[], display_order, is_active)`.
- Each master carries a `custom_fields jsonb` column (already included above).
- Forms render UDFs dynamically from the registry; the **import template
  auto-appends UDF columns**; the validator checks type/required; the importer
  writes them into `custom_fields`.
- Pros: zero schema churn, per-tenant, uniform across masters.
- Cons: JSONB not strongly typed at DB level (validated at app layer); filtering via
  JSONB operators.

**Option B — EAV** (`master_custom_values` key/value table)
- Normalized + queryable, but heavier joins and dynamic-UI plumbing.

**Option C — fixed spare columns** — rejected.

> Decision pending. The `custom_fields jsonb` columns are included now so adopting
> Option A later needs **no further migration on the masters themselves** — only the
> `master_field_definitions` table + the dynamic form/import wiring.

---

## 7. Import-engine integration

The universal importer (`apps/api/src/lib/import-engine/{templates,validator,importer}.ts`)
gets:

- **New master types** `states`, `clusters`: template columns + `mapRow` + (slug-style)
  required-field coverage, mirroring existing masters.
- **Updated `sites` template/mapRow/validator**: new columns; cross-reference resolve
  `state_code → state_id` and `cluster_code → cluster_id` (the validator already does
  this pattern for `department_code`, `site_code`, etc.).
- UDF columns (if Option A) are injected into templates dynamically from
  `master_field_definitions`.

Reminder (carried from the departments fix): every new master's `mapRow` must supply
all NOT-NULL columns (e.g. generate `slug` where the table requires it).

---

## 8. API + UI surface

- **API:** `masters/states`, `masters/clusters` route plugins (GET = `auth`, mutations =
  `hrAdminAuth`), registered in `apps/api/src/routes/masters/index.ts`. Extend the sites
  route with the new fields.
- **Web:** new master screens for State & Cluster under **Setup → Org masters**; expand
  the Site form with the new sections (Address, Statutory, Operations). Add nav entries.
- **Import:** State/Cluster appear in the Upload Masters picker with downloadable templates.

---

## 9. Migration / build sequence

| # | item |
|---|---|
| 273 | `state_master.sql` — table + RLS + seed (36/38 states, GST codes, PT/LWF flags) |
| 274 | `cluster_master.sql` — table + RLS |
| 275 | `site_master_expansion.sql` — additive columns + FKs to states/clusters |
| (later) | `master_field_definitions.sql` — only if UDF Option A is chosen |
| API | masters/states, masters/clusters routes; sites route fields; importer entries |
| Web | State/Cluster screens; Site form expansion; nav; import templates |

Phasing suggestion: **P1** State + Site columns (statutory value first) → **P2** Cluster →
**P3** UDF.

---

## 10. Resolved decisions (2026-06-17)
1. **State seed:** ✅ **per-tenant copy** — seeded into each tenant; tenants may edit flags.
2. **`site_type` list:** ✅ proposed enum accepted as-is.
3. **Region values:** ✅ **free text** (on both `states.region` and `clusters.region`).
4. **Cluster ↔ manager scope:** ✅ **required** — a cluster manager gets RBAC visibility
   over that cluster's sites/employees. Tracked as **Phase 4** (RBAC change).
5. **UDF:** still **deferred** — Option A vs B chosen later; `custom_fields jsonb` columns
   ship now so no further master migration is needed when adopted.

### Build phasing (chosen)
- **P1 — Schema:** migrations 273 (states + per-tenant seed), 274 (clusters), 275 (site expansion).
- **P2 — API + importer:** masters/states, masters/clusters routes; sites route fields; import templates/validator/mapRow.
- **P3 — Web UI:** State & Cluster master screens; expanded Site form; nav; import picker entries.
- **P4 — RBAC:** cluster-manager visibility over cluster sites/employees.
