import type { Page } from '@playwright/test'

import { API_BASE_URL } from './target'

/** Where a bank-imported transaction came from, as the app reads it alongside the transaction */
export type BankSource = {
  provider: 'simplefin'
  provider_name: string
  bank_values: {
    date: string

    /** Signed minor units, money out negative */
    amount: number | null
    raw_amount: string | null
    description: string
    merchant_name: string | null
    category_hint: string | null
  }
  edited_fields: ('date' | 'amount')[]
  review_item_id: string | null
}

/** A SimpleFIN transaction whose ledger values are still the bank's own */
export const BANK_SOURCE: BankSource = {
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  bank_values: {
    date: '2026-01-15',
    amount: -4250,
    raw_amount: null,
    description: 'GROCER 123',
    merchant_name: null,
    category_hint: null,
  },
  edited_fields: [],
  review_item_id: null,
}

/**
 * Answers the app's reads of these transactions as imported from the bank, each with its source,
 * since nothing links an account on the server for a sync to import one
 */
export async function answerAsBankImported(page: Page, sources: Record<string, BankSource>): Promise<void> {
  const isTransactionRead = (url: URL) => url.href.startsWith(`${API_BASE_URL}/transactions?`)
    || Object.keys(sources).some((id) => url.href === `${API_BASE_URL}/transactions/${id}`)
  await page.route(isTransactionRead, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()

    // Retried, since the instance now and then drops a reused connection, which the browser would retry
    const response = await route.fetch({ maxRetries: 2 })
    const body = await response.json() as { id: string } | { id: string }[]
    const markImported = (transaction: { id: string }) =>
      Object.hasOwn(sources, transaction.id) ? { ...transaction, bank_source: sources[transaction.id] } : transaction
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(markImported) : markImported(body) })
  })
}
