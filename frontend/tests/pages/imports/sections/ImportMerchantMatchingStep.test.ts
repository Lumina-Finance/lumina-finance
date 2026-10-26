/**
 * Tests that the merchant matching step glows a row it filled in for the user to check, and not on a
 * finished import's record, where nothing is left to check and the glow shows as a stray bronze outline
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportMerchantMatchingStep } from '@/pages/imports/sections/ImportMerchantMatchingStep'

type ImportResult = Parameters<typeof ImportMerchantMatchingStep>[0]['importResult']

/** Renders the step for one merchant name the user has not answered, finished or not */
function render(importResult: ImportResult) {
  return renderToStaticMarkup(createElement(ImportMerchantMatchingStep, {
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
    matchesFailed: false,
    refetchMatches: () => undefined,
    importResult,
  } as unknown as Parameters<typeof ImportMerchantMatchingStep>[0]))
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
