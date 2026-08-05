/**
 * api-errors tests — verifies the contract of the shared error framework.
 *
 * What we lock in:
 *   · Every helper returns the flat { error, message } shape.
 *   · HTTP status codes match the helper name.
 *   · serverError() calls req.log.error exactly once with full context.
 *   · serverError() never leaks the raw error message to the client.
 *   · 4xx helpers never call req.log.error (client errors are not bugs).
 *   · Default codes are correct when no code is supplied.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  serverError,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  conflictError,
  ErrorCode,
} from '../api-errors.js'

// ── Test doubles ──────────────────────────────────────────────────────────────

function mockReq(overrides: Partial<Record<string, any>> = {}) {
  return {
    id:            'req-abc',
    correlationId: 'corr-xyz',
    tenantId:      'tenant-123',
    userId:        'user-456',
    url:           '/test/endpoint',
    method:        'GET',
    routeOptions:  { url: '/test/:id' },
    log:           { error: vi.fn(), warn: vi.fn() },
    ...overrides,
  }
}

function mockReply() {
  const r: any = { _status: 200, _body: undefined }
  r.code  = (n: number)  => { r._status = n; return r }
  r.send  = (body: any)  => { r._body = body; return r }
  return r
}

// ── serverError ───────────────────────────────────────────────────────────────

describe('serverError', () => {
  it('returns HTTP 500', () => {
    const req   = mockReq()
    const reply = mockReply()
    serverError(req, reply, new Error('db down'), 'QUERY_FAILED', 'Failed to load data')
    expect(reply._status).toBe(500)
  })

  it('returns flat { error, message } shape', () => {
    const req   = mockReq()
    const reply = mockReply()
    serverError(req, reply, new Error('boom'), 'QUERY_FAILED', 'Failed to load data')
    // requestId is intentionally always present on serverError's body (gate4
    // observability — lets callers report a failure to support, and its
    // presence signals the error-sanitizer this message is already safe).
    expect(reply._body).toEqual({ error: 'QUERY_FAILED', message: 'Failed to load data', requestId: 'req-abc' })
  })

  it('never leaks the raw error message or stack to the client', () => {
    const req   = mockReq()
    const reply = mockReply()
    const rawMsg = 'relation "employees" does not exist'
    serverError(req, reply, new Error(rawMsg), 'QUERY_FAILED', 'Failed to load data')
    expect(JSON.stringify(reply._body)).not.toContain(rawMsg)
  })

  it('calls req.log.error exactly once', () => {
    const req   = mockReq()
    const reply = mockReply()
    serverError(req, reply, new Error('oops'), 'INTERNAL_ERROR', 'Unexpected error')
    expect(req.log.error).toHaveBeenCalledTimes(1)
  })

  it('logs the err object (preserving stack)', () => {
    const req   = mockReq()
    const reply = mockReply()
    const err   = new Error('original error')
    serverError(req, reply, err, 'INTERNAL_ERROR', 'msg')
    const [loggedCtx] = req.log.error.mock.calls[0] as [any, string]
    expect(loggedCtx.err).toBe(err)
  })

  it('logs full correlation context', () => {
    const req   = mockReq()
    const reply = mockReply()
    serverError(req, reply, new Error(), 'INTERNAL_ERROR', 'msg')
    const [loggedCtx] = req.log.error.mock.calls[0] as [any, string]
    expect(loggedCtx.requestId).toBe('req-abc')
    expect(loggedCtx.correlationId).toBe('corr-xyz')
    expect(loggedCtx.tenantId).toBe('tenant-123')
    expect(loggedCtx.userId).toBe('user-456')
    expect(loggedCtx.route).toBe('/test/:id')
    expect(loggedCtx.method).toBe('GET')
    expect(loggedCtx.error_code).toBe('INTERNAL_ERROR')
  })

  it('uses INTERNAL_ERROR and safe default message when called with no code/message', () => {
    const req   = mockReq()
    const reply = mockReply()
    serverError(req, reply, new Error())
    expect(reply._body.error).toBe(ErrorCode.INTERNAL_ERROR)
    expect(typeof reply._body.message).toBe('string')
    expect(reply._body.message.length).toBeGreaterThan(0)
  })

  it('handles non-Error thrown values (strings, nulls)', () => {
    const req   = mockReq()
    const reply = mockReply()
    expect(() => serverError(req, reply, 'string error', 'INTERNAL_ERROR', 'msg')).not.toThrow()
    expect(() => serverError(req, reply, null, 'INTERNAL_ERROR', 'msg')).not.toThrow()
    expect(() => serverError(req, reply, undefined, 'INTERNAL_ERROR', 'msg')).not.toThrow()
  })

  it('works when req is missing optional fields (unauthenticated context)', () => {
    const req = { id: 'r1', url: '/pub', method: 'GET', log: { error: vi.fn() } }
    const reply = mockReply()
    expect(() => serverError(req, reply, new Error(), 'INTERNAL_ERROR', 'msg')).not.toThrow()
    const [loggedCtx] = req.log.error.mock.calls[0] as [any, string]
    expect(loggedCtx.correlationId).toBeNull()
    expect(loggedCtx.tenantId).toBeNull()
    expect(loggedCtx.userId).toBeNull()
  })
})

// ── 4xx helpers ───────────────────────────────────────────────────────────────

describe('validationError', () => {
  it('returns HTTP 400 with flat shape', () => {
    const reply = mockReply()
    validationError(reply, 'INVALID_MONTH', 'Month must be YYYY-MM')
    expect(reply._status).toBe(400)
    expect(reply._body).toEqual({ error: 'INVALID_MONTH', message: 'Month must be YYYY-MM' })
  })
  it('uses defaults when called with no args', () => {
    const reply = mockReply()
    validationError(reply)
    expect(reply._status).toBe(400)
    expect(reply._body.error).toBe(ErrorCode.VALIDATION_ERROR)
  })
})

describe('unauthorized', () => {
  it('returns HTTP 401', () => {
    const reply = mockReply()
    unauthorized(reply, 'TOKEN_EXPIRED', 'Your session has expired')
    expect(reply._status).toBe(401)
    expect(reply._body).toEqual({ error: 'TOKEN_EXPIRED', message: 'Your session has expired' })
  })
  it('uses defaults when called with no args', () => {
    const reply = mockReply()
    unauthorized(reply)
    expect(reply._status).toBe(401)
    expect(reply._body.error).toBe(ErrorCode.UNAUTHORIZED)
  })
})

describe('forbidden', () => {
  it('returns HTTP 403', () => {
    const reply = mockReply()
    forbidden(reply, 'APPROVAL_FORBIDDEN', 'You cannot approve your own request')
    expect(reply._status).toBe(403)
    expect(reply._body).toEqual({ error: 'APPROVAL_FORBIDDEN', message: 'You cannot approve your own request' })
  })
})

describe('notFound', () => {
  it('returns HTTP 404', () => {
    const reply = mockReply()
    notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    expect(reply._status).toBe(404)
    expect(reply._body).toEqual({ error: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found' })
  })
})

describe('conflictError', () => {
  it('returns HTTP 409', () => {
    const reply = mockReply()
    conflictError(reply, 'DUPLICATE_ENTRY', 'Employee code already exists')
    expect(reply._status).toBe(409)
    expect(reply._body).toEqual({ error: 'DUPLICATE_ENTRY', message: 'Employee code already exists' })
  })
})

// ── ErrorCode registry ────────────────────────────────────────────────────────

describe('ErrorCode registry', () => {
  it('every code is a non-empty SCREAMING_SNAKE_CASE string', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
      expect(value).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(key).toBe(value)  // key and value should match
    }
  })

  it('has no duplicate values', () => {
    const values = Object.values(ErrorCode)
    expect(new Set(values).size).toBe(values.length)
  })
})
