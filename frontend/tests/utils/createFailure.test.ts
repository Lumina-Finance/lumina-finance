/**
 * Tests what a failed create of an account or transaction shows, above all that a timeout never
 * reads as a plain failure, since the server may have saved the record after the browser gave up
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import { getCreateFailureMessage, getTransferFailureNotice } from '@/utils/createFailure'

const timeout = () => new DOMException('The request timed out', 'TimeoutError')

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

describe('reading a notice off a transfer pair that failed', () => {
  const timedOut = 'The server took too long to answer. It may have been saved, so check your transactions before trying again.'
  const refused = { description: 'an expense transfer in Chequing', reason: new ApiError('Refused', 422) }
  const timedOutLeg = { description: 'an income transfer in Savings', reason: timeout() }

  it('shows the timeout message when either leg of two failed timed out, whichever failed first', () => {
    expect(getTransferFailureNotice([refused, timedOutLeg], 2)).toEqual({ title: '', message: timedOut })
    expect(getTransferFailureNotice([timedOutLeg, refused], 2)).toEqual({ title: '', message: timedOut })
  })

  it('shows the first message when both legs failed and none timed out', () => {
    expect(getTransferFailureNotice([refused, { ...refused, reason: new Error('Failed to fetch') }], 2)).toEqual({
      title: '',
      message: 'Refused',
    })
  })

  it('sends the user to check rather than add the leg when the only failed leg timed out', () => {
    expect(getTransferFailureNotice([timedOutLeg], 2)).toEqual({ title: '', message: timedOut })
  })

  it('asks for the leg to be added by hand when the only failed leg was refused', () => {
    expect(getTransferFailureNotice([refused], 2)).toEqual({
      title: 'One of the pair of transactions failed.',
      message: 'There was a problem creating an expense transfer in Chequing. Please add that leg manually.',
    })
  })
})
