-- ============================================================
-- 417_link_related_incidents_atomic.sql
--
-- PEND-60 (AUDIT_CONSTITUTION.md §14.6): IncidentService.linkRelatedIncidents
-- did a plain read-then-write on operational_incidents.metadata's
-- related_incidents array — SELECT metadata, compute the new array in JS,
-- then UPDATE unconditionally with no concurrency guard. Two concurrent
-- calls linking different related incidents onto the same incident_id both
-- read the same stale snapshot; whichever UPDATE lands second silently
-- overwrites the first caller's addition, losing one relationship with no
-- error surfaced.
--
-- Fix: link_related_incidents_atomic() folds the read-modify-write into a
-- single UPDATE statement. The new related_incidents array is computed from
-- the row's own current metadata inside that same statement, under the row's
-- write lock — there is no window between reading and writing for a
-- concurrent caller to race into.
-- ============================================================

CREATE OR REPLACE FUNCTION link_related_incidents_atomic(
  p_tenant_id           UUID,
  p_incident_id         UUID,
  p_related_incident_id UUID
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE operational_incidents
  SET    metadata = jsonb_set(
           metadata,
           '{related_incidents}',
           (
             SELECT to_jsonb(array_agg(DISTINCT elem))
             FROM   jsonb_array_elements_text(
                      COALESCE(metadata -> 'related_incidents', '[]'::jsonb)
                      || to_jsonb(p_related_incident_id::text)
                    ) AS elem
           )
         ),
         updated_at = now()
  WHERE  id = p_incident_id AND tenant_id = p_tenant_id;
$$;
