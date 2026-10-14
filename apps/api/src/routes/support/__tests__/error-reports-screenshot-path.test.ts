/**
 * POST /support/error-reports — screenshot_path tenant-folder validation
 * (SYSTEM_AUDIT_2026-10-14 item 3 follow-up finding).
 *
 * screenshot_path was accepted as an arbitrary client-supplied string with
 * no server-side check that it actually lives inside the REPORTING
 * tenant's own feedback folder (`${tenantId}/feedback/...`, the only path
 * shape the real upload flow — uploadFeedbackScreenshot — ever produces).
 * Without this check, a malicious or buggy client could submit any storage
 * path — another tenant's upload, an unrelated bucket object — and the
 * owner panel's screenshot-signing endpoint would later sign a URL for it.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import supportRoutes from '../index.js'

const TENANT_ID = 'tenant-abc'

function buildApp() {
  const app = Fastify()
  const insertSpy = vi.fn((row: any) => ({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'report-1', ...row }, error: null }) }),
  }))
  app.decorateRequest('tenantId', '')
  app.decorateRequest('userId', '')
  app.decorateRequest('employeeId', '')
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT_ID
    req.userId = 'user-1'
    req.employeeId = 'emp-1'
  })
  app.decorate('supabase', {
    from: (table: string) => {
      if (table === 'error_reports') return { insert: insertSpy }
      throw new Error(`unexpected table ${table}`)
    },
  } as any)
  return { app, insertSpy }
}

describe('POST /support/error-reports — screenshot_path validation', () => {
  it('accepts a path inside the reporting tenant\'s own feedback folder', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: `${TENANT_ID}/feedback/123-abc.png` },
    })

    expect(res.statusCode).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ screenshot_path: `${TENANT_ID}/feedback/123-abc.png` }))
  })

  it('rejects a path pointing at a DIFFERENT tenant\'s feedback folder', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: 'some-other-tenant/feedback/123-abc.png' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects a path outside any feedback folder entirely', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: `${TENANT_ID}/payroll-exports/payslip.pdf` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects a path traversal attempt even if it happens to start with the right prefix', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: `${TENANT_ID}/feedback/../other-tenant/secret.png` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects an empty filename (bare prefix, nothing after it)', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: `${TENANT_ID}/feedback/` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects a backslash-separated traversal attempt', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: `${TENANT_ID}/feedback/..\\..\\secret.png` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects a percent-encoded traversal sequence', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: `${TENANT_ID}/feedback/%2e%2e%2fsecret.png` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects an unrelated storage object outside the flat feedback-upload shape', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback', screenshot_path: `${TENANT_ID}/feedback/sub/dir/secret.png` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('a report with no screenshot at all is unaffected', async () => {
    const { app, insertSpy } = buildApp()
    await app.register(supportRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST', url: '/support/error-reports',
      payload: { message: 'it broke', severity: 'feedback' },
    })

    expect(res.statusCode).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ screenshot_path: null }))
  })
})
