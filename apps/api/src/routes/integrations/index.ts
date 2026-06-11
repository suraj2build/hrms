import type { FastifyInstance } from 'fastify'
import {
  panVerificationAdapter,
  ifscVerificationAdapter,
  accountingExportService,
  isIntegrationEnabled,
} from '../../platform/integrations/index.js'
import type { AccountingFormat, PayrollExportInput } from '../../platform/integrations/index.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

export default async function integrationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  // PAN verification (paid external PII lookup) and accounting export
  // (tenant-wide financial data) are HR-admin actions.
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // -------------------------------------------------------------------------
  // GET /integrations/status
  // -------------------------------------------------------------------------
  fastify.get('/integrations/status', auth, async (_req, _reply) => {
    const integrations = [
      { provider: 'surepass_pan',      status: isIntegrationEnabled('surepass_pan')      ? 'active' : 'not_configured' },
      { provider: 'razorpay_ifsc',     status: isIntegrationEnabled('razorpay_ifsc')     ? 'active' : 'not_configured' },
      { provider: 'tally_export',      status: isIntegrationEnabled('tally_export')      ? 'active' : 'not_configured' },
      { provider: 'quickbooks_export', status: isIntegrationEnabled('quickbooks_export') ? 'active' : 'not_configured' },
      { provider: 'regulatory_feed',   status: isIntegrationEnabled('regulatory_feed')   ? 'active' : 'not_configured' },
    ]
    return { integrations }
  })

  // -------------------------------------------------------------------------
  // POST /integrations/pan/verify
  // -------------------------------------------------------------------------
  fastify.post('/integrations/pan/verify', hrAdminAuth, async (req, reply) => {
    const body = req.body as { pan?: string }
    if (!body.pan || typeof body.pan !== 'string') {
      return reply.status(400).send({ error: 'pan is required' })
    }
    try {
      const result = await panVerificationAdapter.verify(body.pan)
      return result
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })

  // -------------------------------------------------------------------------
  // GET /integrations/ifsc/:ifsc
  // -------------------------------------------------------------------------
  fastify.get('/integrations/ifsc/:ifsc', auth, async (req, reply) => {
    const { ifsc } = req.params as { ifsc: string }
    try {
      const result = await ifscVerificationAdapter.lookup(ifsc)
      return result
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })

  // -------------------------------------------------------------------------
  // POST /integrations/accounting/export
  // -------------------------------------------------------------------------
  fastify.post('/integrations/accounting/export', hrAdminAuth, async (req, reply) => {
    const body = req.body as {
      format?:   string
      period?:   string
      org_name?: string
      entries?:  PayrollExportInput['entries']
    }

    const { format, period, org_name, entries } = body

    const validFormats: AccountingFormat[] = ['csv_journal', 'tally_xml', 'quickbooks_iif']
    if (!format || !validFormats.includes(format as AccountingFormat)) {
      return reply.status(400).send({ error: `format must be one of: ${validFormats.join(', ')}` })
    }
    if (!period || typeof period !== 'string') {
      return reply.status(400).send({ error: 'period is required (e.g. "2024-01")' })
    }
    if (!org_name || typeof org_name !== 'string') {
      return reply.status(400).send({ error: 'org_name is required' })
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return reply.status(400).send({ error: 'entries array is required and must not be empty' })
    }

    try {
      const input: PayrollExportInput = { period, org_name, entries }
      const output = accountingExportService.export(input, format as AccountingFormat)

      switch (format as AccountingFormat) {
        case 'csv_journal':
          reply.header('Content-Type', 'text/csv')
          reply.header('Content-Disposition', `attachment; filename="payroll-${period}-csv_journal.csv"`)
          return reply.send(output)

        case 'tally_xml':
          reply.header('Content-Type', 'application/xml')
          return reply.send(output)

        case 'quickbooks_iif':
          reply.header('Content-Type', 'text/plain')
          reply.header('Content-Disposition', `attachment; filename="payroll-${period}.iif"`)
          return reply.send(output)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })
}
