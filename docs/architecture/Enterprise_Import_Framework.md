# Enterprise Import Framework

**Status:** Architecture Frozen (v1.0)
**Location:** `apps/api/src/lib/enterprise-import/`
**Governed by:** Platform Engineering

---

## Table of Contents

1. [Purpose](#purpose)
2. [Architectural Invariants](#architectural-invariants)
3. [Pipeline Overview](#pipeline-overview)
4. [Stage Descriptions](#stage-descriptions)
5. [Public Interface](#public-interface)
6. [Workbook Contract](#workbook-contract)
7. [Sequence Diagrams](#sequence-diagrams)
8. [Failure Modes](#failure-modes)
9. [Extension Guide](#extension-guide)
10. [Versioning Policy](#versioning-policy)
11. [Rules for Future Developers](#rules-for-future-developers)

---

## Purpose

The Enterprise Import Framework is the mandatory ingestion layer for all master-driven workbook imports in CognixHR. It was created to replace a generation of fragile, name-based column matching with a deterministic, position-based, ID-driven pipeline.

Every workbook import in CognixHR — salary, variable pay, assets, bonuses, FBP, employee master — must enter the system through this framework. No import implementation may bypass it.

---

## Architectural Invariants

These are non-negotiable constraints. Any change that violates one of these requires explicit architectural review.

### 1 — Identity
> **Entity IDs are the only authoritative identifiers for import resolution.**

Display names, codes, labels, and column headers are never used to resolve which master record a workbook column maps to. The workbook manifest is the only source of `entityId → column` mapping.

### 2 — Workbook Contract
> **Workbook metadata is the system contract.**

The `CognixHR_Metadata` sheet in every enterprise XLSX is the contract between the template generator and the importer. It carries the `schemaVersion`, `workbookType`, `tenantId`, `masterHash`, `signature`, and the structured `components` manifest. Validation of this contract happens before any row is touched.

### 3 — Resolution is Positional, Never Textual
> **Column identity is determined by 1-based Excel column position. Column header text is irrelevant.**

The frontend emits component columns as `{ "<position>": "<amount>" }` (e.g., `"4": "10000"` for column D). The backend resolves `position → entityId` from the workbook manifest. Users may rename, translate, or reformat column headers without affecting imports.

### 4 — Frontend Carries No Business Logic
> **The frontend uploads data and displays results. It never resolves entities.**

The frontend parser reads the `CognixHR_Metadata` sheet and forwards it to the backend verbatim. It does not perform column-to-component matching, does not validate against master data, and does not make business decisions about which entity a column maps to.

### 5 — Framework Owns Workbook Parsing
> **Only `lib/enterprise-import` may parse workbooks. Domain modules are consumers.**

No payroll route, no salary upload function, and no future import type may call ExcelJS or SheetJS directly. `parseWorkbook()` is the single entry point for binary workbook parsing. The domain layer receives a `WorkbookDescriptor` and never touches raw XLSX objects.

### 6 — Display Names Are Immutable at Import Time
> **A master record may be renamed at any time without affecting in-flight or future imports.**

Because resolution uses `entityId` (a stable UUID), renaming a salary component from "Basic Salary" to "Base Pay" has no effect on imports. The workbook's manifest continues to bind the correct column to the correct entity by ID.

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TEMPLATE GENERATION (GET /import/templates/employee_salary_upload)      │
│                                                                          │
│  fetchActiveComponents() → sorted by display_order                       │
│        ↓                                                                 │
│  generateSalaryUploadXlsx()                                              │
│    ├─ Sheet 1: Instructions                                              │
│    ├─ Sheet 2: Upload Sheet  (columns A–C fixed, D+ = components)        │
│    ├─ Sheet 3: Reference     (active component list)                     │
│    └─ Sheet 4: CognixHR_Metadata (veryHidden)                           │
│         workbook_id, workbook_type, schema_version, component_hash,      │
│         signature, components JSON [{position, id, code, name}]          │
└─────────────────────────────────────────────────────────────────────────┘

                                    ↓  (user fills in XLSX, re-uploads)

┌─────────────────────────────────────────────────────────────────────────┐
│  UPLOAD (POST /import/validate or /import/run)                           │
│                                                                          │
│  Frontend:                                                               │
│    1. Parse CognixHR_Metadata → build manifest object                   │
│    2. Parse Upload Sheet → rows with fixed-name keys + position keys     │
│       { employee_code: "EMP001", "4": "10000", "5": "5000", ... }       │
│    3. POST { rows, manifest } to /import/validate                        │
│                                                                          │
│  Backend:                                                                │
│    Stage 1 — MetadataResolver (5 sub-stages)                            │
│      1a  Schema:    schemaVersion ∈ SUPPORTED_SCHEMA_VERSIONS            │
│      1b  Identity:  workbookType matches expected type                   │
│      1c  Tenant:    tenantId matches authenticated tenant                │
│      1d  Hash:      masterHash matches current component snapshot        │
│      1e  Signature: djb2(tenantId|workbookId|version|hash|date) matches  │
│          → throws MetadataValidationError on any failure                 │
│                                                                          │
│    Stage 2 — ReferenceIntegrityValidator (3 sub-stages)                 │
│      2a  Structure:  mappings.length > 0, count matches componentCount   │
│      2b  Manifest:   no null entityIds, no duplicate IDs/positions,      │
│                      positions are positive and strictly ascending        │
│      2c  Reference:  every entityId resolves to an active master record  │
│          → throws ReferenceIntegrityError on any failure                 │
│                                                                          │
│    Stage 3 — Row Validation                                              │
│      employee_code → required                                            │
│      effective_from → required, YYYY-MM-DD                               │
│      "4" → manifestByPosition.get(4) → entityId → amount (numeric ≥ 0)  │
│      → returns ValidatedRow[] with per-row errors                        │
│                                                                          │
│    Stage 4 — DB Checks                                                   │
│      employee_code → employee_id (tenant-scoped)                         │
│      duplicate compensation check                                        │
│                                                                          │
│    Stage 5 — Chunk Import (run only)                                     │
│      INSERT employee_compensations                                       │
│      INSERT employee_compensation_components (by entityId)               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Stage Descriptions

### MetadataResolver
**File:** `lib/enterprise-import/metadata-resolver.ts`

Validates workbook provenance before any DB work. Accepts a `WorkbookManifest` directly so callers with a full `WorkbookDescriptor` pass `descriptor.manifest`, and callers working with a sparse JSON manifest can construct one without a full descriptor.

Stage 4 (hash) and Stage 5 (signature) are skipped gracefully when the corresponding manifest fields are absent. This allows the framework to accept minimally-structured manifests while still enforcing the full contract for v2 workbooks.

The `computeCurrentHash` callback is injected by the caller — the resolver never queries the database directly.

### ReferenceIntegrityValidator
**File:** `lib/enterprise-import/reference-integrity-validator.ts`

Three-stage gate that runs before a single row is parsed. Stages 1–2 (structure and manifest integrity) run entirely in memory. Stage 3 (DB reference) is only reached if Stages 1–2 pass, avoiding a DB round-trip when the manifest is obviously broken.

The `lookupActiveEntities` callback is injected by the caller. For salary upload, this is fulfilled by the already-fetched `activeComponents` list with no additional DB query.

### MasterColumnResolver
**File:** `lib/enterprise-import/master-column-resolver.ts`

Resolves a list of `MasterMapping[]` (position + entityId) to `ResolvedColumn<T>[]` by calling an injected `EntityLookup<T>`. Used directly when binary XLSX upload (Phase 4) is wired in. In the current JSON-rows path, the equivalent lookup is inline in `validateSalaryUploadRows`.

---

## Public Interface

All types and functions are exported from `lib/enterprise-import/index.ts`.

### Types

```typescript
// Workbook identity and provenance
WorkbookManifest {
  schemaVersion:    number          // required — always validated
  workbookId?:      string
  workbookType?:    string
  tenantId?:        string
  generatedBy?:     string
  generatedAt?:     string
  generatorVersion?: string
  masterHash?:      string          // Stage 4 skipped when absent
  signature?:       string          // Stage 5 skipped when absent
}

// One column in the workbook's component manifest
MasterMapping {
  position: number   // 1-based Excel column index
  entityId: string   // UUID of the master entity — THE identity field
  code:     string   // for error messages only
  name:     string   // for error messages only — never used for resolution
}

// Fully parsed workbook (output of parseWorkbook)
WorkbookDescriptor {
  workbookId:    string
  workbookType:  string
  schemaVersion: number
  manifest:      WorkbookManifest
  mappings:      MasterMapping[]
  sheets:        WorkbookSheet[]
  dataSheet:     WorkbookSheet
  rows:          unknown[][]
  metadata:      Record<string, string>
  warnings:      string[]
}

// Per-request context passed through the pipeline
ImportContext {
  tenantId:     string
  userId:       string
  workbookType: string
  requestId:    string
  workbookId?:  string
  importJobId?: string
}

// Domain-provided entity lookup (injected into ReferenceIntegrityValidator)
ActiveEntityLookup<T> = (entityIds: string[]) => Promise<Map<string, T>>

// Domain-provided entity lookup (injected into MasterColumnResolver)
EntityLookup<T> = (entityIds: string[]) => Promise<Map<string, T>>

// Resolved column after entity lookup
ResolvedColumn<T> {
  position: number
  entityId: string
  entity:   T
}

// One integrity violation (collected across all stages before throwing)
IntegrityViolation {
  stage:   'structure' | 'manifest' | 'reference'
  code:    string
  message: string
}
```

### Functions

```typescript
// Parse binary XLSX buffer into a WorkbookDescriptor
parseWorkbook(
  buffer: Buffer | ArrayBuffer,
  expectedDataSheets?: string[],
): Promise<WorkbookDescriptor>

// Validate workbook provenance (5 stages)
resolveMetadata(
  manifest: WorkbookManifest,
  opts: {
    tenantId:             string
    expectedWorkbookType: string
    computeCurrentHash:   () => Promise<string>
  },
): Promise<void>

// Validate column mappings (3 stages — structure, manifest, reference)
validateReferenceIntegrity<T>(
  mappings: MasterMapping[],
  opts: {
    context:               ImportContext
    expectedMappingCount?: number
    lookupActiveEntities:  ActiveEntityLookup<T>
  },
): Promise<void>

// Resolve MasterMappings to domain entities
resolveMasterColumns<T>(
  mappings: MasterMapping[],
  lookupEntities: EntityLookup<T>,
): Promise<ResolvedColumn<T>[]>
```

### Error Classes

```typescript
WorkbookParseError        // XLSX parsing failure (missing sheet, corrupted binary)
MetadataValidationError   // Schema version, type mismatch, tenant, hash, signature
MasterResolutionError     // Entity lookup failure during column resolution
ReferenceIntegrityError   // Carries violations[]: IntegrityViolation[]
```

---

## Workbook Contract

### Metadata Sheet Format (`CognixHR_Metadata`, veryHidden)

| Key (column A)           | Value (column B)                    | Version |
|--------------------------|-------------------------------------|---------|
| `manifest_version`       | `"2"`                               | v2      |
| `workbook_type`          | e.g. `"employee_salary_upload"`     | v2      |
| `schema_version`         | `"2"`                               | v2      |
| `component_count`        | `"<N>"` — number of component cols  | v2      |
| `component_hash`         | djb2 fingerprint of component set   | v2      |
| `generator_version`      | `"1.0.0"`                           | v2      |
| `generated_at`           | `"YYYY-MM-DD"`                      | v2      |
| `workbook_id`            | UUID                                | v2      |
| `signature`              | djb2 of canonical fields            | v2      |
| `components`             | JSON `[{position,id,code,name}]`    | v2      |
| `tenant_id`              | tenant UUID                         | v2      |
| `generated_by`           | user UUID                           | v2      |
| `template_version`       | same as `component_hash` (compat)   | v1 compat |
| `manifest_schema_version`| `"2"` (compat)                      | v1 compat |
| `manifest_import_type`   | workbook type (compat)              | v1 compat |
| `manifest_expected_columns` | same as `component_count` (compat)| v1 compat |
| `manifest_tenant_id`     | same as `tenant_id` (compat)        | v1 compat |
| `manifest_generated_by`  | same as `generated_by` (compat)     | v1 compat |

### Component Manifest JSON (`components` field)

```json
[
  { "position": 4, "id": "uuid-basic",  "code": "BASIC", "name": "Basic Salary" },
  { "position": 5, "id": "uuid-hra",    "code": "HRA",   "name": "HRA"          },
  { "position": 6, "id": "uuid-bonus",  "code": "BONUS", "name": "Performance Bonus" }
]
```

Positions are 1-based, strictly ascending. Positions 1–3 are always fixed columns (employee_code, employee_name, effective_from). Notes is always the last column after all components.

### Signature Algorithm

```
sigPayload = [tenantId, workbookId, schemaVersion, masterHash, generatedAt].join('|')
signature  = djb2(sigPayload).toString(16).padStart(8, '0')
```

djb2 implementation (same in both generator and validator — must stay in sync):
```typescript
let h = 5381
for (let i = 0; i < input.length; i++) {
  h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0
}
return h.toString(16).padStart(8, '0')
```

### Component Hash Algorithm

```
payload = components
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(c => `${c.id}|${c.display_order ?? ''}|${c.component_type}|${c.is_active}`)
  .join(',')
hash = `v${components.length}_${djb2(payload)}`
```

Any change to a component's ID, display_order, component_type, or is_active status invalidates all in-flight workbooks for that tenant. HR users are prompted to re-download the template.

---

## Sequence Diagrams

### Template Download

```
HR User         Frontend           /import/templates          salary-upload.ts
   |                |                      |                         |
   |--[Download]--->|                      |                         |
   |                |---GET /templates/--->|                         |
   |                |   employee_salary_upload                       |
   |                |                      |--fetchActiveComponents->|
   |                |                      |<--ComponentMeta[]-------|
   |                |                      |--generateSalaryUpload-->|
   |                |                      |   Xlsx(components,      |
   |                |                      |   tenantId, userId)     |
   |                |                      |<--Buffer (XLSX)---------|
   |                |<--XLSX file (200)----|                         |
   |<--Download-----|                      |                         |
```

### Validate Flow

```
HR User     ImportWorkspace.tsx      /import/validate      validateSalaryUploadRows
   |                |                      |                         |
   |--[Upload XLSX]->|                     |                         |
   |                |--parse CognixHR_Metadata                       |
   |                |  → manifest (workbookId, components, hash, sig)|
   |                |--parse Upload Sheet                            |
   |                |  → rows [{employee_code, "4": amt, "5": amt}] |
   |                |                      |                         |
   |--[Validate]--->|                      |                         |
   |                |--POST /validate----->|                         |
   |                |  { rows, manifest }  |                         |
   |                |                      |--resolveMetadata------->| Stage 1–5
   |                |                      |  ← MetadataValidationError (400) on fail
   |                |                      |                         |
   |                |                      |--fetchActiveComponents->| (for hash + types)
   |                |                      |                         |
   |                |                      |--validateReferenceIntegrity
   |                |                      |  ← ReferenceIntegrityError (400) on fail
   |                |                      |                         |
   |                |                      |--Row validation loop--->|
   |                |                      |  "4" → pos 4 → entityId|
   |                |                      |  entityId → amount      |
   |                |                      |                         |
   |                |                      |--DB: resolve emp codes  |
   |                |                      |<--ValidationResult------|
   |                |<--200 { data }-------|                         |
   |<--Review UI----|                      |                         |
```

### Run Flow (async)

```
HR User     ImportWorkspace.tsx     /import/run          runSalaryUploadJob
   |                |                      |                    |
   |--[Import]--->  |                      |                    |
   |                |--POST /run---------->|                    |
   |                |  { rows, manifest }  |--createImportJob   |
   |                |                      |<--jobId            |
   |                |<--202 { jobId }------|                    |
   |                |                      |                    |
   |  (background)  |                      |--runSalaryUploadJob (unawaited)
   |                |                      |                    |--validate
   |                |                      |                    |--import chunks
   |                |                      |                    |--UPDATE import_jobs
   |                |                      |                    |--INSERT job_rows
   |                |                      |                    |
   |--[Poll /jobs]->|                      |                    |
   |<--status-------|                      |                    |
```

---

## Failure Modes

### Stage 1 — Metadata Failures → HTTP 400 `MANIFEST_ERROR`

| Condition | Error Code | User Action |
|-----------|-----------|-------------|
| `schemaVersion` not in `[2]` | `SCHEMA_VERSION_UNSUPPORTED` | Download fresh template |
| `workbookType` ≠ expected | `WORKBOOK_TYPE_MISMATCH` | Upload the correct file |
| `tenantId` ≠ authenticated tenant | `TENANT_MISMATCH` | Download your own template |
| `masterHash` ≠ current hash | `MASTER_HASH_MISMATCH` | Master changed; download fresh |
| `signature` invalid | `SIGNATURE_INVALID` | Metadata tampered; download fresh |
| `manifest.components` absent | `MANIFEST_FIELD_MISSING` | Use XLSX template (not CSV) |

### Stage 2 — Reference Integrity Failures → HTTP 400 `INTEGRITY_ERROR`

Response includes `violations[]` array. All violations are collected before throwing.

| Stage | Condition | Code |
|-------|-----------|------|
| structure | No mappings in manifest | `NO_MAPPINGS` |
| structure | Count ≠ `componentCount` | `MAPPING_COUNT_MISMATCH` |
| manifest | Null or empty `entityId` | `NULL_ENTITY_ID` |
| manifest | Same `entityId` twice | `DUPLICATE_ENTITY_ID` |
| manifest | Same column position twice | `DUPLICATE_POSITION` |
| manifest | Position < 1 or non-integer | `INVALID_POSITION` |
| manifest | Positions not ascending | `POSITIONS_NOT_ASCENDING` |
| reference | `entityId` not in active master | `ENTITY_NOT_FOUND` |

### Stage 3 — Row Validation Failures → HTTP 200 with `invalidRows > 0`

Row errors are not thrown — they are collected per-row in `ValidationResult.rows[].errors`. The import proceeds; only valid rows are imported on `/run`.

### Infrastructure Failures → HTTP 500

Unexpected DB errors, ExcelJS parse exceptions, and unhandled exceptions surface as `VALIDATION_ERROR` or `IMPORT_ERROR` with the underlying message. The import job is marked `failed` in `import_jobs`.

---

## Extension Guide

### Adding a New Import Type

A new workbook import (e.g., Variable Pay) requires:

**1. Template generator**

Create `apps/api/src/lib/import-engine/<type>-upload.ts` with:
- `fetchActive<Entities>()` — query the master table, sorted by display_order
- `generate<Type>Xlsx(entities, date, tenantId, generatedBy)` — produce a 4-sheet enterprise workbook
- Include the `components` JSON in `CognixHR_Metadata` using the same format
- The `workbook_type` key must match your route's `expectedWorkbookType`

**2. Validation function**

```typescript
export async function validate<Type>Rows(
  supabase:  SupabaseClient,
  tenantId:  string,
  rows:      Record<string, string>[],
  manifest?: YourManifest,
  userId?:   string,
): Promise<YourValidationResult> {
  // 1. resolveMetadata(workbookManifest, { tenantId, expectedWorkbookType, computeCurrentHash })
  // 2. Mandatory manifest guard: throw if !manifest?.components
  // 3. fetchActiveEntities → build entityById map
  // 4. validateReferenceIntegrity(mappings, { context, lookupActiveEntities })
  // 5. Build manifestByPosition from manifest.components
  // 6. Row validation loop using manifestByPosition.get(parseInt(key))
  // 7. Domain-specific DB checks
}
```

**3. Route registration**

Add `<type>-upload` to `VALID_MASTER_TYPES` in `apps/api/src/routes/import/index.ts`. Add the template download, validate, and run handlers following the same pattern as `employee_salary_upload`.

**4. Frontend parser**

In `ImportWorkspace.tsx`, add the new master type to the `selectedMaster === 'employee_salary_upload'` checks so the metadata parser and positional key emission apply to your type.

**Invariant check before submitting:**
- [ ] No direct ExcelJS or SheetJS imports in the domain module
- [ ] `resolveMetadata` called before any row processing
- [ ] `validateReferenceIntegrity` called with an injected lookup function
- [ ] Column resolution uses `manifestByPosition.get(parseInt(key))`, not name lookup
- [ ] Mandatory manifest guard throws `MetadataValidationError(MANIFEST_FIELD_MISSING)` when components absent

---

## Versioning Policy

### `SCHEMA_VERSION` (currently `2`)

Bump `SCHEMA_VERSION` in `salary-upload.ts` and add the new version to `SUPPORTED_SCHEMA_VERSIONS` in `metadata-resolver.ts` when:

- The `CognixHR_Metadata` sheet structure changes in a breaking way
- The `components` JSON format changes
- The column layout contract changes (e.g., fixed column positions change)
- The signature algorithm changes

**Do not bump** for: adding optional metadata fields, adding new master-specific metadata rows, changing component display order only.

When bumping:
1. Keep the old version in `SUPPORTED_SCHEMA_VERSIONS` during a grace period
2. Set a deprecation date, after which the old version is removed
3. All existing templates become invalid on removal — HR users must re-download

### `generatorVersion` (currently `"1.0.0"`)

Semver of the generation code. Informational only — not validated by `MetadataResolver`. Bump major when the workbook layout changes visually (column additions, sheet restructure). Bump minor for template content improvements. Bump patch for bug fixes.

### Component Hash

The hash invalidates automatically when any component's `id`, `display_order`, `component_type`, or `is_active` changes. No manual versioning needed. HR users are shown a "template outdated" warning on the upload screen.

### Signature

The signature is a tamper-detection mechanism, not a version signal. It is tied to `workbookId + tenantId + schemaVersion + masterHash + generatedAt`. It does not version the format.

---

## Rules for Future Developers

### MUST

- Use `lib/enterprise-import` as the entry point for all workbook parsing and validation
- Call `resolveMetadata` before processing any row data
- Call `validateReferenceIntegrity` after fetching master data but before the row loop
- Use `manifestByPosition.get(parseInt(key))` for component column resolution
- Inject `lookupActiveEntities` and `computeCurrentHash` as callbacks — never call DB from framework internals
- Include `components` JSON in every new enterprise XLSX metadata sheet
- Keep the dependency rule: framework modules import nothing from domain (payroll, salary, assets, etc.)

### MUST NOT

- Build a `name → entityId` map and use it for column matching
- Perform name normalization (`toLowerCase`, regex replacement) for resolution purposes
- Call `ExcelJS` or `XLSX` outside of `lib/enterprise-import/workbook-parser.ts`
- Add domain-specific types or imports to any file under `lib/enterprise-import/`
- Skip `resolveMetadata` for "simple" or "trusted" workbooks
- Use `.limit(N)` instead of `fetchAllRows()` for tables that may exceed 1,000 rows
- Add business logic to the frontend that determines which entity a column maps to

### DEPENDENCY RULE

```
lib/enterprise-import/
    ↑ imports from
payroll/ salary-upload/ assets/ variable-pay/ (domain modules)
    ↑ imports from
routes/import/
```

The arrow flows upward. `lib/enterprise-import` has zero knowledge of any domain. Reversing this dependency is a critical architectural violation.

---

## Adoption Status

| Import Type | Framework? | Notes |
|-------------|-----------|-------|
| Employee Salary Upload | ✅ Complete (v1.0) | Reference implementation |
| Salary Components | ⏳ Wave 2 | Static template, no manifest yet |
| Employee Master | ⏳ Wave 2 | Static template, no manifest yet |
| Variable Pay | ⏳ Wave 3 | Pending |
| Leave Opening Balance | ⏳ Wave 3 | Pending |
| Asset Assignment | ⏳ Wave 3 | Pending |
| Bonus | ⏳ Wave 4 | Pending |
| FBP | ⏳ Wave 4 | Pending |

All new import types must use the framework from day one. Migration of existing types follows the wave plan above.
