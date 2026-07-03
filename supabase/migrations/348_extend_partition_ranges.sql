-- Migration 348: Extend monthly partition ranges for security_events and trace_spans
--
-- Context (ISSUE-079):
--   Migrations 125 (security_events) and 126 (trace_spans) created monthly partitions
--   for May–July 2026 only. Both tables have a DEFAULT catch-all partition so no data
--   is lost, but all writes from August 2026 onward land in DEFAULT — degrading query
--   performance for range scans. This migration provisions monthly partitions through
--   December 2027, giving 18 months of headroom before the next extension is needed.
--
--   The 'partition_maintenance' scheduler job referenced in migrations 125/126 was
--   never implemented (see ISSUE-011). These partitions are created explicitly here
--   until a pg_cron-based auto-provisioner is in place.
--
--   All statements use IF NOT EXISTS so this migration is safe to re-apply.

-- ── security_events — Aug 2026 through Dec 2027 ───────────────────────────────

CREATE TABLE IF NOT EXISTS security_events_2026_08 PARTITION OF security_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS security_events_2026_09 PARTITION OF security_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE IF NOT EXISTS security_events_2026_10 PARTITION OF security_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS security_events_2026_11 PARTITION OF security_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS security_events_2026_12 PARTITION OF security_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS security_events_2027_01 PARTITION OF security_events
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE TABLE IF NOT EXISTS security_events_2027_02 PARTITION OF security_events
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');

CREATE TABLE IF NOT EXISTS security_events_2027_03 PARTITION OF security_events
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');

CREATE TABLE IF NOT EXISTS security_events_2027_04 PARTITION OF security_events
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');

CREATE TABLE IF NOT EXISTS security_events_2027_05 PARTITION OF security_events
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');

CREATE TABLE IF NOT EXISTS security_events_2027_06 PARTITION OF security_events
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');

CREATE TABLE IF NOT EXISTS security_events_2027_07 PARTITION OF security_events
  FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');

CREATE TABLE IF NOT EXISTS security_events_2027_08 PARTITION OF security_events
  FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');

CREATE TABLE IF NOT EXISTS security_events_2027_09 PARTITION OF security_events
  FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');

CREATE TABLE IF NOT EXISTS security_events_2027_10 PARTITION OF security_events
  FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');

CREATE TABLE IF NOT EXISTS security_events_2027_11 PARTITION OF security_events
  FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');

CREATE TABLE IF NOT EXISTS security_events_2027_12 PARTITION OF security_events
  FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');

-- ── trace_spans — Aug 2026 through Dec 2027 ───────────────────────────────────

CREATE TABLE IF NOT EXISTS trace_spans_2026_08 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS trace_spans_2026_09 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE IF NOT EXISTS trace_spans_2026_10 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS trace_spans_2026_11 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS trace_spans_2026_12 PARTITION OF trace_spans
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_01 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_02 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_03 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_04 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_05 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_06 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_07 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_08 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_09 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_10 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_11 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');

CREATE TABLE IF NOT EXISTS trace_spans_2027_12 PARTITION OF trace_spans
  FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
