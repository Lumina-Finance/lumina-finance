/**
 * Covers how a failed download is worded for every export, since a message that never says the file
 * wasn't saved leaves a person waiting for a download that will not come, and a reason one export
 * gives for a status must not leak into another
 */
import { describe, expect, it } from 'vitest'
import { ApiError, buildApiError } from '@/api/auth'
import { DOWNLOAD_FAILED_MESSAGE, getDownloadFailureMessage } from '@/utils/downloadFailure'

describe('getDownloadFailureMessage', () => {
  it('says nothing was downloaded for a server fault instead of its status text', () => {
    const message = getDownloadFailureMessage(new ApiError('Internal Server Error', 500))

    expect(message).toBe(DOWNLOAD_FAILED_MESSAGE)
    expect(message).toContain('nothing was downloaded')
  })

  it('says nothing was downloaded when no answer came at all', () => {
    expect(getDownloadFailureMessage(new TypeError('Failed to fetch'))).toBe(DOWNLOAD_FAILED_MESSAGE)
  })

  it.each([
    [
      'a session that expired',
      new ApiError('Session expired', 401),
      'Nothing was downloaded: your session has expired. Please sign in again.',
    ],
    [
      'a token the server called inactive',
      buildApiError(401, { detail: 'Token is not active' }),
      'Nothing was downloaded: your session has expired. Please sign in again.',
    ],
    [
      'a restricted session the server explained',
      buildApiError(403, { detail: 'Set up two-factor authentication again before you continue' }),
      'Nothing was downloaded: set up two-factor authentication again before you continue',
    ],
    [
      'a gateway answering 403 with an empty body',
      buildApiError(403, null),
      "Nothing was downloaded: you don't have permission to export.",
    ],
    [
      'a 408 with an empty body',
      buildApiError(408, null),
      'Nothing was downloaded: the request took too long. Please try again.',
    ],
    [
      'a 400 with an empty body',
      buildApiError(400, null),
      'Nothing was downloaded: the request was refused. Please refresh the page and try again.',
    ],
    [
      'a 4xx from a proxy with an HTML page',
      buildApiError(431, '<html>Request Header Or Cookie Too Large</html>'),
      'Nothing was downloaded: the request was refused. Please refresh the page and try again.',
    ],
    [
      'a refusal naming one filter field',
      buildApiError(422, { detail: [{ loc: ['query', 'min_amount'], msg: 'bad' }] }),
      "Nothing was downloaded: the min amount wasn't accepted. Please check it and try again.",
    ],
    [
      'a refusal the server worded as a sentence',
      buildApiError(422, { detail: 'Start date must be before end date' }),
      'Nothing was downloaded: start date must be before end date',
    ],
    [
      'a refusal whose sentence opens with an acronym',
      buildApiError(422, { detail: 'CSV export needs a date range' }),
      'Nothing was downloaded: CSV export needs a date range',
    ],
    [
      'a 429 with an empty body',
      buildApiError(429, null),
      'Nothing was downloaded: too many requests were sent. Please wait a moment and try again.',
    ],
  ])('gives the reason for %s after saying nothing was downloaded', (_name, error, expected) => {
    expect(getDownloadFailureMessage(error)).toBe(expected)
  })

  it.each([
    ['a 404', 404],
    ['a 413', 413],
  ])('refuses %s with no explanation in general words unless the download names its own reason', (_name, status) => {
    const error = buildApiError(status, null)

    expect(getDownloadFailureMessage(error)).toBe(
      'Nothing was downloaded: the request was refused. Please refresh the page and try again.',
    )
    expect(getDownloadFailureMessage(error, { [status]: 'this download has its own reason.' })).toBe(
      'Nothing was downloaded: this download has its own reason.',
    )
  })

  it('gives the server its say before a reason the download supplies', () => {
    const error = buildApiError(404, { detail: 'Profile not found' })

    expect(getDownloadFailureMessage(error, { 404: 'this download has its own reason.' })).toBe(
      'Nothing was downloaded: profile not found',
    )
  })

  it.each([
    ['a server fault with an empty body', buildApiError(500, null)],
    ['a bad gateway', buildApiError(502, null)],
    ['a server fault that carries a detail', buildApiError(500, { detail: 'upstream connect error' })],
    ['a service unavailable that carries a detail', buildApiError(503, { detail: 'upstream connect error' })],
  ])('gives the plain failure message, never joined to the prefix, for %s', (_name, error) => {
    expect(getDownloadFailureMessage(error)).toBe(DOWNLOAD_FAILED_MESSAGE)
  })
})
