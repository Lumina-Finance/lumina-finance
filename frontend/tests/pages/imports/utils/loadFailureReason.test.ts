/**
 * Tests the first sentence of a failed lookup's panel on the import page, one case for each way such
 * a request fails, so it never repeats the panel's title or its Try again button
 */
import { describe, expect, it } from 'vitest'
import { buildApiError } from '@/api/auth'
import { explainRequestFailure } from '@/api/server'
import { getLoadFailureReason } from '@/pages/imports/utils'

const REFUSED = "The names couldn't be sent."

describe('the reason a lookup on the import page failed', () => {
  it("is the server's own reason, with a full stop, when it refused the request with one", () => {
    const error = buildApiError(403, { detail: 'Two-factor re-enrolment required' })

    expect(getLoadFailureReason(error, REFUSED)).toBe('Two-factor re-enrolment required.')
  })

  it.each(['Try later?', 'Not allowed!', 'Already ended.'])('leaves the punctuation of "%s" as it is', (detail) => {
    expect(getLoadFailureReason(buildApiError(403, { detail }), REFUSED)).toBe(detail)
  })

  it("is the page's sentence when the server rejected what was sent", () => {
    const error = buildApiError(422, {
      detail: [{ loc: ['body', 'mode'], msg: 'Input should be a valid string' }],
    })

    expect(getLoadFailureReason(error, REFUSED)).toBe(REFUSED)
  })

  it('is short when the server failed without saying why', () => {
    expect(getLoadFailureReason(buildApiError(500, null), REFUSED)).toBe('Something went wrong.')
  })

  it('says the server took too long when the request timed out', () => {
    const timeout = new DOMException('Oops, the server took too long to answer. Please try again.', 'TimeoutError')

    expect(getLoadFailureReason(timeout, REFUSED)).toBe('The server took too long to answer.')
  })

  it('says the server could not be reached when the connection was lost', () => {
    const lost = explainRequestFailure(new TypeError('Failed to fetch'))

    expect(getLoadFailureReason(lost, REFUSED)).toBe("Couldn't reach the server.")
  })

  it('is short for a failure the browser worded, such as an unreadable answer', () => {
    expect(getLoadFailureReason(new SyntaxError('Unexpected token < in JSON at position 0'), REFUSED)).toBe(
      'Something went wrong.',
    )
    expect(getLoadFailureReason(null, REFUSED)).toBe('Something went wrong.')
  })
})
