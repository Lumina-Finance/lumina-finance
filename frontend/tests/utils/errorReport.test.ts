/**
 * Tests the report a user copies off an error screen, so a pasted bug report carries what is needed
 * to place the error and nothing that depends on the page still being there
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import { buildErrorReport } from '@/utils/errorReport'

const OCCURRED_AT = new Date('2026-07-28T12:34:56.000Z')
const USER_AGENT = 'Mozilla/5.0 (Macintosh) TestBrowser/1.0'

describe('buildErrorReport', () => {
  it('carries the error, where it happened and both stacks', () => {
    const error = new TypeError('Cannot read properties of undefined')
    error.stack = 'TypeError: Cannot read properties of undefined\n    at Dashboard'

    const report = buildErrorReport({
      componentStack: '\n    at Dashboard\n    at Boundary',
      error,
      occurredAt: OCCURRED_AT,
      path: '/accounts?tab=all',
      userAgent: USER_AGENT,
    })

    expect(report).toContain('Time: 2026-07-28T12:34:56.000Z')
    expect(report).toContain('Page: /accounts?tab=all')
    expect(report).toContain('Error: TypeError: Cannot read properties of undefined')
    expect(report).toContain(`Browser: ${USER_AGENT}`)
    expect(report).toContain('Stack:\nTypeError: Cannot read properties of undefined\n    at Dashboard')
    expect(report).toContain('Components:\nat Dashboard\n    at Boundary')
  })

  it('carries the status and the backend sentence a refused request came with', () => {
    const report = buildErrorReport({
      componentStack: null,
      error: new ApiError('Category is still applied to transactions', 409, {
        detail: 'Category is still applied to transactions',
      }),
      occurredAt: OCCURRED_AT,
      path: '/settings',
      userAgent: USER_AGENT,
    })

    expect(report).toContain('Error: ApiError: Category is still applied to transactions')
    expect(report).toContain('Status: 409')
    expect(report).toContain('Server said: Category is still applied to transactions')
  })

  it('carries the status of a failed request the backend gave no sentence for', () => {
    const report = buildErrorReport({
      componentStack: null,
      error: new ApiError('Request failed (500)', 500),
      occurredAt: OCCURRED_AT,
      path: '/',
      userAgent: USER_AGENT,
    })

    expect(report).toContain('Error: ApiError: Request failed (500)')
    expect(report).toContain('Status: 500')
    expect(report).not.toContain('Server said:')
  })

  it('describes a thrown value that is not an error and leaves the stack out', () => {
    const report = buildErrorReport({
      componentStack: null,
      error: 'boom',
      occurredAt: OCCURRED_AT,
      path: '/',
      userAgent: USER_AGENT,
    })

    expect(report).toContain('Error: boom')
    expect(report).not.toContain('Stack:')
    expect(report).not.toContain('Components:')
  })
})
