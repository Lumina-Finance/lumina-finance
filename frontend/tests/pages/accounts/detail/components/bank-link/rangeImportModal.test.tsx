/**
 * Covers the dialogue importing a date range into a linked account: its From and To, the choice to
 * bring back dismissed items and the warning that choice needs, and the reason Import is held back
 *
 * These tests catch the choice ticked from the start, the warning missing once it is ticked, worded
 * unlike the issue or shown before it is, the warning outside a live region a screen reader announces,
 * and Import left live or without its reason while the review pause holds the account. Ticking the
 * choice, typing the dates and importing run in the browser
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankLink } from '@/api/bank-sync'
import { RESTORE_DISMISSED_WARNING } from '@/components/bank-link-flow/constants'
import { RangeImportModal, RestoreDismissedOption } from '@/pages/accounts/detail/components/bank-link/RangeImportModal'
import { createAccount, createConnection, createLink, createSync } from './fixtures'

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/modal/Shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/modal/Shell')>()),
  ModalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/date-field/DateField', () => ({
  default: ({ id }: { id?: string }) => <input id={id} />,
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useImportBankRange: () => ({ isPending: false, mutate: () => {} }),
  useImportRange: () => ({
    data: {
      earliest_allowed: '2025-10-01',
      latest_allowed: '2026-10-05',
      ledger_floor: null,
      provider_limit_date: '2025-10-01',
      provider_history_months: 12,
    },
    error: null,
  }),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: () => {} }) }))

/** Static rendering escapes apostrophes and marks where one text node meets the next */
function clean(markup: string): string {
  return markup.replaceAll('<!-- -->', '').replaceAll('&#x27;', "'")
}

function renderDialog(link: BankLink = createLink()): string {
  return clean(
    renderToStaticMarkup(
      <RangeImportModal
        open
        account={createAccount()}
        link={link}
        connection={createConnection()}
        providers={undefined}
        onClose={() => {}}
        onExitComplete={() => {}}
      />,
    ),
  )
}

describe('RangeImportModal', () => {
  it('asks for From and To and offers bringing back dismissed items, unticked, with no warning yet', () => {
    const markup = renderDialog()

    expect(markup).toContain('Import a date range')
    expect(markup).toContain('id="bank-range-import-from"')
    expect(markup).toContain('id="bank-range-import-to"')
    expect(markup).toMatch(/role="checkbox" aria-checked="false" aria-label="Bring back dismissed items"/)
    expect(markup).not.toContain(RESTORE_DISMISSED_WARNING)
    expect(markup).toContain('Any days from Oct 1, 2025 to today')
  })

  it('holds Import back with the review pause as its reason, printed in the dialogue', () => {
    const markup = renderDialog(
      createLink({ sync: createSync({ state: 'paused', paused: true, waiting_new_count: 120 }) }),
    )

    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Import<\/button>/)
    expect(markup).toContain('Paused until 50 or fewer items wait for review')
  })
})

describe('RestoreDismissedOption', () => {
  it('shows the warning in a live region once ticked', () => {
    const markup = clean(renderToStaticMarkup(<RestoreDismissedOption checked disabled={false} onToggle={() => {}} />))

    expect(markup).toMatch(/role="checkbox" aria-checked="true"/)
    expect(markup).toMatch(new RegExp(`<div role="status">.*${RESTORE_DISMISSED_WARNING.replaceAll('.', '\\.')}`, 's'))
    expect(RESTORE_DISMISSED_WARNING).toBe(
      "Items you bring back may already be counted in a balance adjustment. Please check the account's balance after approving them.",
    )
  })

  it('keeps the live region on the page with nothing in it while unticked', () => {
    const markup = clean(
      renderToStaticMarkup(<RestoreDismissedOption checked={false} disabled={false} onToggle={() => {}} />),
    )

    expect(markup).toContain('<div role="status"></div>')
  })
})
