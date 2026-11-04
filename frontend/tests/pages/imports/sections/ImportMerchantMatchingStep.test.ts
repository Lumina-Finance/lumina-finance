/**
 * Tests that the merchant matching step glows a row it filled in for the user to check, and not on a
 * finished import's record, where nothing is left to check and the glow shows as a stray bronze outline
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildApiError } from '@/api/auth'
import { explainRequestFailure } from '@/api/server'
import { MERCHANT_MATCHES_LOAD_FAILURE_EXPLANATION } from '@/pages/imports/constants'
import { ImportMerchantMatchingStep } from '@/pages/imports/sections/ImportMerchantMatchingStep'

type ImportResult = Parameters<typeof ImportMerchantMatchingStep>[0]['importResult']

/** Renders the step for one merchant name the user has not answered, finished or not */
function render(importResult: ImportResult, failure?: unknown) {
  return renderToStaticMarkup(
    createElement(ImportMerchantMatchingStep, {
      importedMerchants: ['Market'],
      merchantMappings: {},
      merchantCreateNames: {},
      setMerchantMappings: () => undefined,
      setMerchantCreateNames: () => undefined,
      matchedMerchantByKey: new Map(),
      merchantOptions: [],
      rememberPickedMerchant: () => undefined,
      merchantSearch: '',
      setMerchantSearch: () => undefined,
      merchantSearchLoading: false,
      hasMoreMerchantResults: false,
      loadMoreMerchantResults: () => undefined,
      matchesLoading: false,
      matchesFailed: failure !== undefined,
      matchesError: failure ?? null,
      refetchMatches: () => undefined,
      importResult,
    } as unknown as Parameters<typeof ImportMerchantMatchingStep>[0]),
  )
}

describe('the glow on a merchant row filled in for the user', () => {
  it('shows on an unanswered row of an import still being set up', () => {
    expect(render(null)).toContain('import-auto-fill-field')
  })

  it('stays off on the record of a finished import', () => {
    const finished = { created_merchant_ids: [] } as unknown as NonNullable<ImportResult>

    expect(render(finished)).not.toContain('import-auto-fill-field')
  })
})

describe('the failure shown when the merchants could not be checked', () => {
  // Markup escapes the apostrophe the request layer's sentences carry
  const escaped = (text: string) => text.replaceAll("'", '&#x27;')

  const failures: [string, unknown, string][] = [
    [
      "a refusal with the server's reason",
      buildApiError(403, { detail: 'Two-factor re-enrolment required' }),
      'Two-factor re-enrolment required.',
    ],
    [
      'a validation refusal',
      buildApiError(422, { detail: [{ loc: ['body', 'names'], msg: 'List should have at most 1000 items' }] }),
      "The merchant names couldn't be sent.",
    ],
    ['a server fault', buildApiError(500, null), 'Something went wrong.'],
    [
      'a timeout',
      new DOMException('Oops, the server took too long to answer. Please try again.', 'TimeoutError'),
      'The server took too long to answer.',
    ],
    ['a lost connection', explainRequestFailure(new TypeError('Failed to fetch')), "Couldn't reach the server."],
  ]

  it.each(failures)('says why for %s, in one paragraph with what the failure means', (_kind, failure, reason) => {
    const markup = render(null, failure)

    expect(markup).toContain('Your merchants could not be checked')
    expect(markup).toContain(`>${escaped(reason)} ${escaped(MERCHANT_MATCHES_LOAD_FAILURE_EXPLANATION)}</p>`)
    expect(markup).not.toContain('Oops')
    expect(markup).not.toContain('Please try again')
  })
})
