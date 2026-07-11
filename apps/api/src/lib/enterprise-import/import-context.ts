// ── Enterprise Import Framework — ImportContext ───────────────────────────────
// Immutable context passed through every stage of the import pipeline.
// Uniform across all workbook types — no domain-specific fields.

export interface ImportContext {
  tenantId:      string
  userId:        string
  workbookId?:   string   // present from Phase 3+ when binary upload provides the workbook
  workbookType:  string
  requestId:     string   // per-request UUID for log correlation
  importJobId?:  string   // set once the import_jobs row is created
}
