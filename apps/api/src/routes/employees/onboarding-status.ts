/**
 * Employee Onboarding Status Route
 *
 * GET /employees/:id/onboarding-status
 *
 * Returns the most recent onboarding draft linked to this employee
 * (via draft_employee_profiles.linked_employee_id), along with its
 * parent session and document extraction summary.
 *
 * Returns { data: null } when no onboarding draft is linked.
 *
 * Protected: self-or-HR-admin. Used both by the ESS sidebar/onboarding
 * widget (employee viewing their own status) and the admin Employee
 * Profile console — was previously any authenticated user with no
 * ownership check, letting any employee read a colleague's onboarding
 * draft/document extraction status.
 */
import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
  return !!data
}

async function resolveCallerEmployeeId(fastify: any, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles').select('employee_id').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  return (data as any)?.employee_id ?? null
}

export default async function onboardingStatusRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/employees/:id/onboarding-status', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      const callerEmpId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
      if (!callerEmpId || callerEmpId !== req.params.id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own onboarding status' })
      }
    }

    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // Find the most recent draft profile linked to this employee
    const { data: draft, error: draftError } = await fastify.supabase
      .from('draft_employee_profiles')
      .select('id, session_id, status, created_at, updated_at')
      .eq('linked_employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (draftError) return serverError(req, reply, draftError, ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding status')
    if (!draft) return reply.send({ data: null })

    // Fetch the parent session
    const { data: session, error: sessionError } = await fastify.supabase
      .from('onboarding_sessions')
      .select('id, status, created_by, created_at, updated_at')
      .eq('id', draft.session_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (sessionError) return serverError(req, reply, sessionError, ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding session')

    // Fetch documents for this session
    const { data: docs, error: docsError } = await fastify.supabase
      .from('onboarding_documents')
      .select('id, document_type, extraction_status, uploaded_at')
      .eq('session_id', draft.session_id)
      .eq('tenant_id', req.tenantId)

    if (docsError) return serverError(req, reply, docsError, ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding documents')

    const documents    = docs ?? []
    const totalDocs    = documents.length
    const extractedDocs = documents.filter((d: any) => d.extraction_status === 'completed').length
    const failedDocs   = documents.filter((d: any) => d.extraction_status === 'failed').length

    return reply.send({
      data: {
        session: session ? {
          id:         session.id,
          status:     session.status,
          created_at: session.created_at,
          updated_at: session.updated_at,
        } : null,
        draft: {
          id:         draft.id,
          status:     draft.status,
          created_at: draft.created_at,
          updated_at: draft.updated_at,
        },
        documents: {
          total:     totalDocs,
          extracted: extractedDocs,
          failed:    failedDocs,
          items:     documents,
        },
      },
    })
  })
}
