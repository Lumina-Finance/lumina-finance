/**
 * Tests what a failed create of an account or transaction shows, above all that a timeout never
 * reads as a plain failure, since the server may have saved the record after the browser gave up
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import { getCreateFailureMessage, getCreateFailuresMessage } from '@/utils/createFailure'

const timeout = () => new DOMException('The request timed out', 'TimeoutError')

describe('reading a message off several failed creates', () => {
  const timedOut = 'The server took too long to answer. It may have been saved, so check your transactions before trying again.'

  it('shows the timeout message when either create timed out, whichever failed first', () => {
    expect(getCreateFailuresMessage([new ApiError('Refused', 422), timeout()], 'transaction')).toBe(timedOut)
    expect(getCreateFailuresMessage([timeout(), new ApiError('Refused', 422)], 'transaction')).toBe(timedOut)
  })

  it('shows the first message when none timed out', () => {
    expect(getCreateFailuresMessage([new ApiError('Refused', 422), new Error('Failed to fetch')], 'transaction')).toBe('Refused')
  })
})

describe('reading a message off a failed create', () => {
  it('tells the user to check their accounts after a timed-out account create', () => {
    expect(getCreateFailureMessage(timeout(), 'account')).toBe(
      'The server took too long to answer. It may have been saved, so check your accounts before trying again.',
    )
  })

  it('tells the user to check their transactions after a timed-out transaction create', () => {
    expect(getCreateFailureMessage(timeout(), 'transaction')).toBe(
      'The server took too long to answer. It may have been saved, so check your transactions before trying again.',
    )
  })

  it('shows the message of a request the server refused', () => {
    expect(getCreateFailureMessage(new ApiError('Name is already used', 409), 'account')).toBe('Name is already used')
  })

  it('falls back to the generic sentence for anything else', () => {
    expect(getCreateFailureMessage(new Error('Failed to fetch'), 'transaction')).toBe('Something went wrong. Please try again.')
  })
})
