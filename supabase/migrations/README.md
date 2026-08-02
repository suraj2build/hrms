# Migration numbering

Files are applied in sorted-filename order (see `scripts/db/check-schema-drift.mjs`,
which just does `fs.readdirSync(...).sort()`) — the runner has no notion of numeric
contiguity and does not require one.

**Numbers are sequential but not contiguous by design.** A few are pre-allocated during
feature-branch work and never committed if that branch's migration was abandoned or
folded into another number before landing. Known gaps: **228**, **256–259**. These are
confirmed non-issues (SYSCERT_AUDIT_2026-08-02.md Medium finding, investigated and
closed) — not missing/lost files, not a broken sequence. Do not attempt to
"fill" a gap by reusing a skipped number, and do not renumber later migrations to close
one — later files are cross-referenced by number throughout the codebase and in
`AUDIT_CONSTITUTION.md`'s pendency history, so renumbering would be high-risk for zero
functional benefit.
