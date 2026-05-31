/**
 * Organization Readiness Evaluator
 *
 * Evaluates the org structure foundation:
 *   Sites → Work Locations → Departments → Cost Centers → Employee placement
 *
 * Data sources (all already used by existing pages, zero new API calls):
 *   /masters/sites
 *   /masters/work-locations
 *   /masters/departments
 *   /masters/cost-centers
 *   /employees
 */
import type { ReadinessCheck } from '../types'

interface OrgEvalData {
  sites:       { id: string; code: string | null }[]
  locations:   { id: string; site_id: string | null; is_active: boolean }[]
  departments: { id: string }[]
  costCenters: { id: string }[]
  employees:   { id: string; work_location?: { id: string } | null; status?: string }[]
}

export function evaluateOrganization(data: OrgEvalData): ReadinessCheck[] {
  const { sites, locations, departments, costCenters, employees } = data

  const unassignedLocs = locations.filter(l => !l.site_id).length
  const activeEmps     = employees.filter(e => e.status !== 'inactive' && e.status !== 'separated')
  const empsNoLocation = activeEmps.filter(e => !e.work_location?.id).length
  const empsTotal      = activeEmps.length

  return [
    // ── Sites ──────────────────────────────────────────────────────────────────
    {
      id:          'org-sites',
      label:       'Sites configured',
      status:      sites.length === 0 ? 'error' : 'ok',
      severity:    'warning',
      isBlocking:  false,
      value:       sites.length,
      recommendation: sites.length === 0
        ? 'Create at least one site (campus/branch) to group work locations into an org hierarchy.'
        : undefined,
      actionLabel: sites.length === 0 ? 'Create First Site' : 'View Sites',
      actionPath:  '/masters/sites',
      detail:      sites.length > 0
        ? `${sites.filter(s => s.code).length} of ${sites.length} have codes (needed for import referencing)`
        : undefined,
    },

    // ── Work Locations ─────────────────────────────────────────────────────────
    {
      id:         'org-locations',
      label:      'Work locations configured',
      status:     locations.length === 0     ? 'error'
                : unassignedLocs > 0         ? 'warning'
                : 'ok',
      severity:   unassignedLocs > 0         ? 'warning' : 'info',
      isBlocking: false,
      value:      locations.length,
      recommendation: locations.length === 0
        ? 'Add work locations (office addresses) and link them to sites.'
        : unassignedLocs > 0
        ? `${unassignedLocs} location${unassignedLocs !== 1 ? 's are' : ' is'} not assigned to a site — hierarchy filters and reports will be incomplete.`
        : undefined,
      actionLabel: unassignedLocs > 0 ? 'Assign Locations' : locations.length === 0 ? 'Add Location' : 'View',
      actionPath:  '/masters/work-locations',
    },

    // ── Departments ────────────────────────────────────────────────────────────
    {
      id:         'org-departments',
      label:      'Departments configured',
      status:     departments.length === 0 ? 'warning' : 'ok',
      severity:   'warning',
      isBlocking: false,
      value:      departments.length,
      recommendation: departments.length === 0
        ? 'Configure departments to organise your workforce. Employees reference departments for org hierarchy and reporting.'
        : undefined,
      actionLabel: departments.length === 0 ? 'Add Department' : undefined,
      actionPath:  '/admin/masters?tab=departments',
    },

    // ── Cost Centers ───────────────────────────────────────────────────────────
    {
      id:         'org-cost-centers',
      label:      'Cost centers configured',
      status:     costCenters.length === 0 ? 'warning' : 'ok',
      severity:   'info',
      isBlocking: false,
      value:      costCenters.length,
      recommendation: costCenters.length === 0
        ? 'Cost centers enable payroll allocation reporting and financial breakdowns by business unit.'
        : undefined,
      actionLabel: costCenters.length === 0 ? 'Add Cost Center' : undefined,
      actionPath:  '/masters/cost-centers',
    },

    // ── Employee → Location assignment ─────────────────────────────────────────
    {
      id:         'org-emp-placement',
      label:      'Employees assigned to work locations',
      status:     empsTotal === 0   ? 'unknown'
                : empsNoLocation === 0 ? 'ok'
                : empsNoLocation > empsTotal * 0.3 ? 'warning'
                : 'warning',
      severity:   'info',
      isBlocking: false,
      value:      empsTotal === 0 ? 0 : `${empsTotal - empsNoLocation} / ${empsTotal}`,
      recommendation: empsNoLocation > 0
        ? `${empsNoLocation} active employee${empsNoLocation !== 1 ? 's' : ''} have no work location — they will be excluded from site hierarchy views and location-based filters.`
        : undefined,
      actionLabel: empsNoLocation > 0 ? 'Review Employee Profiles' : undefined,
      actionPath:  '/employees',
      dependsOn:   'workforce',
    },
  ]
}
