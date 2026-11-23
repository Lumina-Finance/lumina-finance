/**
 * Guards the reason Sync now is held back for, shared by the section's button and the identity card's
 * icon. A read-only account takes nothing from its bank, so its reason comes before any other, and an
 * account that takes writes keeps the reason its link gives
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankConnection } from '@/api/bank-sync'
import { ToastContext, type ToastValue } from '@/contexts/ToastContext'
import { useSyncNow } from '@/pages/accounts/detail/components/bank-link/useSyncNow'
import { createConnection, createLink, createProviders } from './fixtures'

const TOAST: ToastValue = { showToast: vi.fn(), dismissToast: vi.fn() }
const REASON = 'Records in USD are read-only. They can be archived or deleted'

// Every request spent until 3 hours from the tests' clock, so the link holds Sync now back on its own
const SPENT = createConnection({
  request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T19:00:00Z', held_by_provider: false },
})

function Probe({ connection, readOnlyReason }: { connection: BankConnection; readOnlyReason?: string | null }) {
  const { block } = useSyncNow(createLink(), connection, createProviders(), readOnlyReason)
  return <output>{block ?? 'open'}</output>
}

function blockFor(connection: BankConnection, readOnlyReason?: string | null): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ToastContext.Provider value={TOAST}>
        <Probe connection={connection} readOnlyReason={readOnlyReason} />
      </ToastContext.Provider>
    </QueryClientProvider>,
  )
    .replace(/^<output>|<\/output>$/g, '')
    .replaceAll('&#x27;', "'")
}

beforeEach(() => {
  // Noon in Toronto, the clock the link fixtures are set against
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T16:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('why Sync now is held back', () => {
  it("gives a read-only account's reason, before the link's own", () => {
    expect(blockFor(SPENT, REASON)).toBe(REASON)
    expect(blockFor(createConnection(), REASON)).toBe(REASON)
  })

  it("keeps the link's own reason, or none, on an account that takes writes", () => {
    expect(blockFor(SPENT, null)).toContain('has used its 20 SimpleFIN requests')
    expect(blockFor(createConnection())).toBe('open')
  })
})
