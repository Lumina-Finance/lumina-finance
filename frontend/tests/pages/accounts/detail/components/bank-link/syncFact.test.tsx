/**
 * Guards the bank sync fact on the identity card. It sits in the facts' description list as one div
 * holding its term and value, with no wrapper around it, and fades in and out only where the card
 * asks for it
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BankSyncLabel } from '@/pages/accounts/detail/components/bank-link/status'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'

const SYNC: BankSyncLabel = { tone: 'ok', label: 'Synced just now', pulse: false, details: [] }

describe('the bank sync fact', () => {
  it('is one div holding its term and value, so the description list has no extra wrapper', () => {
    const markup = renderToStaticMarkup(<SyncFact name="Bank sync" sync={SYNC} fades />)

    expect(markup).toMatch(/^<div class="col-span-2 min-w-0"[^>]*><dt\b/)
  })

  it('starts hidden to fade in where the card asks, and is drawn plainly elsewhere', () => {
    expect(renderToStaticMarkup(<SyncFact name="Bank sync" sync={SYNC} fades />)).toMatch(
      /^<div class="col-span-2 min-w-0" style="opacity:0">/,
    )
    expect(renderToStaticMarkup(<SyncFact name="Status" sync={SYNC} />)).toMatch(/^<div class="col-span-2 min-w-0">/)
  })
})
