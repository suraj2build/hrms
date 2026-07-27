-- simulation_runs.simulation_type CHECK constraint (migration 188) never
-- included 'governance_drift_projection', even though UnifiedSimulationType
-- (unified-simulation.service.ts) has included it since that service was
-- introduced and simulateGovernanceDrift() has always been reachable via
-- POST /fabric/simulate/governance-drift. The app worked around the gap by
-- hardcoding simulation_type: 'policy_change' when persisting a governance
-- drift run, silently mislabeling every such run as a policy-change
-- simulation in the DB. Extend the constraint so the real type can be
-- persisted; the app-side fallback is removed in the same change.

ALTER TABLE simulation_runs DROP CONSTRAINT IF EXISTS simulation_runs_simulation_type_check;

ALTER TABLE simulation_runs ADD CONSTRAINT simulation_runs_simulation_type_check
  CHECK (simulation_type IN (
    'payroll_impact', 'compliance_threshold', 'workforce_overtime',
    'policy_change', 'governance_drift_projection'
  ));
