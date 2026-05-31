import type { FastifyInstance } from 'fastify'
import sitesRoutes                  from './sites.js'
import rostersRoutes                from './rosters.js'
import workLocationsRoutes          from './work-locations.js'
import costCentersRoutes            from './cost-centers.js'
import shiftsRoutes                 from './shifts.js'
import employeeShiftsRoutes         from './employee-shifts.js'
import salaryComponentsRoutes       from './salary-components.js'
import salaryStructuresRoutes       from './salary-structures.js'
import documentTypesRoutes          from './document-types.js'
import identityTypesRoutes          from './identity-types.js'
import relationshipTypesRoutes      from './relationship-types.js'
import holidaysRoutes               from './holidays.js'
import leaveTypesRoutes             from './leave-types.js'
import leavePoliciesRoutes          from './leave-policies.js'
// ── Leave Policy Engine (migration 054) ──────────────────────────────────────
import leavePolicyMastersRoutes     from './leave-policy-masters.js'
import leavePolicyRulesRoutes, {
  leavePolicyRulesMutationsRoutes,
} from './leave-policy-rules.js'
import leavePolicyAssignmentsRoutes from './leave-policy-assignments.js'
// ── Attendance Policy Engine ──────────────────────────────────────────────────
import attendancePoliciesRoutes     from './attendance-policies.js'
// ── Enterprise Operational Masters ───────────────────────────────────────────
import gradesRoutes                 from './grades.js'
import payrollGroupsRoutes          from './payroll-groups.js'
import employmentCategoriesRoutes   from './employment-categories.js'
import statutoryGroupsRoutes        from './statutory-groups.js'
import assetCategoriesRoutes        from './asset-categories.js'
// ── Rotation Policy Engine ────────────────────────────────────────────────────
import rotationPoliciesRoutes       from './rotation-policies.js'
// ── Leave Governance — Important Date Types ───────────────────────────────────
import importantDateTypesRoutes     from './important-date-types.js'

export default async function mastersRoutes(fastify: FastifyInstance) {
  fastify.register(sitesRoutes,             { prefix: '/sites' })
  fastify.register(rostersRoutes,           { prefix: '/rosters' })
  fastify.register(workLocationsRoutes,     { prefix: '/work-locations' })
  fastify.register(costCentersRoutes,       { prefix: '/cost-centers' })
  fastify.register(shiftsRoutes,            { prefix: '/shifts' })
  fastify.register(employeeShiftsRoutes,    { prefix: '/employee-shifts' })
  fastify.register(salaryComponentsRoutes,  { prefix: '/salary-components' })
  fastify.register(salaryStructuresRoutes,  { prefix: '/salary-structures' })
  fastify.register(documentTypesRoutes,     { prefix: '/document-types' })
  fastify.register(identityTypesRoutes,     { prefix: '/identity-types' })
  fastify.register(relationshipTypesRoutes, { prefix: '/relationship-types' })
  fastify.register(holidaysRoutes,          { prefix: '/holidays' })
  fastify.register(leaveTypesRoutes,        { prefix: '/leave-types' })
  fastify.register(leavePoliciesRoutes,     { prefix: '/leave-policies' })

  // ── Leave Policy Engine — new policy-driven layer ─────────────────────────
  // Policy masters: GET/POST /masters/leave-policy-masters
  //                 GET/PUT/DELETE /masters/leave-policy-masters/:id
  fastify.register(leavePolicyMastersRoutes, { prefix: '/leave-policy-masters' })

  // Policy rules nested under a master:
  //   GET/POST /masters/leave-policy-masters/:policyId/rules
  fastify.register(leavePolicyRulesRoutes, { prefix: '/leave-policy-masters' })

  // Policy rules flat CRUD (PUT/DELETE by rule id):
  //   PUT/DELETE /masters/leave-policy-rules/:id
  fastify.register(leavePolicyRulesMutationsRoutes, { prefix: '/leave-policy-rules' })

  // Assignments: GET/POST /masters/leave-policy-assignments
  //              DELETE   /masters/leave-policy-assignments/:id
  fastify.register(leavePolicyAssignmentsRoutes, { prefix: '/leave-policy-assignments' })

  // ── Attendance Policy Engine ─────────────────────────────────────────────
  // GET/POST /masters/attendance-policies
  // PUT/DELETE /masters/attendance-policies/:id
  // POST /masters/attendance-policies/:id/set-default
  // GET/POST /masters/attendance-policies/assignments
  // DELETE   /masters/attendance-policies/assignments/:assignId
  fastify.register(attendancePoliciesRoutes, { prefix: '/attendance-policies' })

  // ── Enterprise Operational Masters ───────────────────────────────────────
  // Grades / Bands:       GET/POST/PUT/DELETE /masters/grades
  // Payroll Groups:       GET/POST/PUT/DELETE /masters/payroll-groups
  // Employment Categories:GET/POST/PUT/DELETE /masters/employment-categories
  // Statutory Groups:     GET/POST/PUT/DELETE /masters/statutory-groups
  // Asset Categories:     GET/POST/PUT/DELETE /masters/asset-categories
  fastify.register(gradesRoutes,               { prefix: '/grades' })
  fastify.register(payrollGroupsRoutes,        { prefix: '/payroll-groups' })
  fastify.register(employmentCategoriesRoutes, { prefix: '/employment-categories' })
  fastify.register(statutoryGroupsRoutes,      { prefix: '/statutory-groups' })
  fastify.register(assetCategoriesRoutes,      { prefix: '/asset-categories' })

  // ── Rotation Policy Engine ───────────────────────────────────────────────
  // GET/POST  /masters/rotation-policies
  // GET/PUT/DELETE /masters/rotation-policies/:id
  // GET       /masters/rotation-policies/:id/impact
  // POST      /masters/rotation-policies/:id/duplicate
  fastify.register(rotationPoliciesRoutes,    { prefix: '/rotation-policies' })

  // ── Leave Governance — Important Date Types ──────────────────────────────
  // GET      /masters/important-date-types
  // POST     /masters/important-date-types
  // PUT      /masters/important-date-types/:id
  // DELETE   /masters/important-date-types/:id
  fastify.register(importantDateTypesRoutes,  { prefix: '/important-date-types' })
}
