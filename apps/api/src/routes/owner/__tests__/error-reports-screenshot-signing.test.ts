/**
 * GET /owner/error-reports/:id/screenshot — independent path validation
 * before signing (SYSTEM_AUDIT_2026-10-14 item 3 follow-up finding).
 *
 * This endpoint uses the service-role client specifically to bypass the
 * tenant-scoped storage RLS a platform-admin session wouldn't otherwise
 * satisfy — which means it is also the one place in the codebase that CAN
 * sign a URL for ANY path in the bucket, regardless of which tenant it
 * actually belongs to. It must never trust error_reports.screenshot_path
 * blindly, including for an older row written before the write-side
 * validation (POST /support/error-reports) existed.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import ownerErrorReportRoutes from '../error-reports.js'

function buildApp(report: { screenshot_path: string | null; tenant_id: string } | null) {
  const app = Fastify()
  const createSignedUrlSpy = vi.fn(() => Promise.resolve({ data: { signedUrl: 'https://signed.example/x' }, error: null }))
  app.decorate('authenticateOwner', async () => {})
  app.decorate('supabase', {
    from: (table: string) => {
      if (table === 'error_reports') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: report, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
    storage: { from: () => ({ createSignedUrl: createSignedUrlSpy }) },
  } as any)
  return { app, createSignedUrlSpy }
}

describe('GET /owner/error-reports/:id/screenshot — independent path validation', () => {
  it('signs a URL for a path that correctly lives inside its own tenant\'s feedback folder', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'tenant-abc/feedback/123.png', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(200)
    expect(createSignedUrlSpy).toHaveBeenCalledWith('tenant-abc/feedback/123.png', 300)
  })

  it('REFUSES to sign — even for a row already in the table — when the stored path belongs to a DIFFERENT tenant than the report itself', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'some-other-tenant/feedback/leaked.png', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })

  it('REFUSES an older/invalid record whose path was never under any feedback folder at all', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'tenant-abc/payroll-exports/payslip.pdf', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('INVALID_SCREENSHOT_PATH')
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })

  it('REFUSES a traversal-crafted path even if its prefix looks correct', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'tenant-abc/feedback/../tenant-xyz/secret.png', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(422)
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })

  it('REFUSES a backslash-separated traversal attempt stored in an older record', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'tenant-abc/feedback/..\\..\\secret.png', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(422)
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })

  it('REFUSES a percent-encoded traversal sequence stored in an older record', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'tenant-abc/feedback/%2e%2e%2fsecret.png', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(422)
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })

  it('REFUSES an empty filename (bare prefix, nothing after it)', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'tenant-abc/feedback/', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(422)
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })

  it('REFUSES an unrelated storage object nested under a sub-directory, not the flat upload shape', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: 'tenant-abc/feedback/sub/dir/secret.png', tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(422)
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })

  it('a report with no screenshot_path returns 404, not a signing attempt', async () => {
    const { app, createSignedUrlSpy } = buildApp({ screenshot_path: null, tenant_id: 'tenant-abc' })
    await app.register(ownerErrorReportRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/owner/error-reports/report-1/screenshot' })

    expect(res.statusCode).toBe(404)
    expect(createSignedUrlSpy).not.toHaveBeenCalled()
  })
})
