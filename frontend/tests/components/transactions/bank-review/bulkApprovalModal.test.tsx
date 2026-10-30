/**
 * Covers what the bulk approval modal shows once it has worked out what would change: each group's
 * heading and net effect, the new items left waiting, and Approve with the count it applies, then
 * what it shows while working that out, with nothing to apply and when the preview can't load
 *
 * These tests catch a group's count or net effect worded wrongly, a currency left out of a net effect
 * or drawn in a colour other than its sign's,
 * the new items left waiting uncounted, Approve offering a count other than the items listed, a count
 * before it is known, or an approval with nothing to apply, a preview cached from an earlier opening
 * showing before the new one has been read, and a preview that failed to load shown as it last was.
 * Opening a group, approving, the toasts and the block and ledger updating run in the browser, since
 * they need clicks
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BulkApprovalPreview } from '@/api/bank-sync/types'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import { createReviewItem, MINUS, TEST_CURRENCIES } from './fixtures'

type PreviewRead = { data?: BulkApprovalPreview; error: unknown; isFetchedAfterMount: boolean }

const read = vi.hoisted(() => ({ preview: { error: null, isFetchedAfterMount: true } as PreviewRead }))

vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useBulkApprovalPreview: () => read.preview,
  useApplyBulkApproval: () => ({ isPending: false, isSuccess: false, mutate: () => {} }),
}))
vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: TEST_CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, TEST_CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, TEST_CURRENCIES),
  }),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: () => {} }) }))

// The real panel renders into a portal, which markup rendered to a string can't hold
vi.mock('@/components/modal/TitledPanel', () => ({
  ModalTitledPanel: ({ footer, children }: { footer: ReactNode; children: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

import { BulkApprovalModal } from '@/components/transactions/bank-review/BulkApprovalModal'

const EXCLUDED_NOTE = 'since each needs a merchant and category before it is added.'

/** Everyday's two corrections, one of -42.10 to -45.10 and one of the date, and a removal of -18.00, beside four new items */
const EVERYDAY: BulkApprovalPreview = {
  groups: [
    {
      kind: 'correction',
      count: 2,
      net_effect: [{ currency: 'USD', amount: -300 }],
      items: [
        createReviewItem('countdown', 'correction', 'everyday'),
        createReviewItem('uber', 'correction', 'everyday'),
      ],
    },
    {
      kind: 'removal',
      count: 1,
      net_effect: [{ currency: 'USD', amount: 1800 }],
      items: [createReviewItem('freshco', 'removal', 'everyday')],
    },
  ],
  excluded_count: 4,
}

function render(preview: PreviewRead): string {
  read.preview = preview
  return renderToStaticMarkup(
    <BulkApprovalModal
      open
      scope={undefined}
      accountFor={() => ({ name: 'Everyday', currency: 'USD' })}
      today="2026-10-05"
      onClose={() => {}}
    />,
  )
}

function renderPreview(data: BulkApprovalPreview): string {
  return render({ data, error: null, isFetchedAfterMount: true })
}

/** The text lines of each group's heading: its count, then its net effect */
function groupsOf(markup: string): string[][] {
  return [...markup.matchAll(/<button[^>]*aria-expanded="[^"]*"[^>]*>(.*?)<\/button>/g)].map(([, content]) =>
    content
      .split('<span class="block')
      .slice(1)
      .map((line) => line.replace(/^[^>]*>/, '').replace(/<[^>]+>/g, '')),
  )
}

/** The colour a net effect's figure is drawn in */
function toneOf(markup: string, figure: string): string | undefined {
  return new RegExp(`color:var\\(--app-([a-z-]+)\\)">${figure.replace(/[$+]/g, '\\$&')}<`).exec(markup)?.[1]
}

/** Approve's label, and whether it can be pressed */
function approveOf(markup: string): { label: string; enabled: boolean } {
  // The button stacks every label it can show, and the one on view is the one at full opacity
  const [, attributes = '', body = ''] =
    /<button([^>]*app-primary-button[^>]*--fit-width[^>]*)>(.*?)<\/button>/s.exec(markup) ?? []
  const label = /opacity:1[^>]*>(Approve[^<]*)</.exec(body)?.[1] ?? ''
  return { label, enabled: !/\sdisabled=""/.test(attributes) }
}

describe('a preview with items to apply', () => {
  it('heads each group with its count and net effect, counts the new items left waiting, and offers to approve every item listed', () => {
    const markup = renderPreview(EVERYDAY)

    expect(groupsOf(markup)).toEqual([
      ['2 corrections to apply', `Net effect: ${MINUS}$3.00`],
      ['1 transaction to remove', 'Net effect: +$18.00'],
    ])
    expect(markup).toContain(`4 new items stay in review, ${EXCLUDED_NOTE}`)
    expect(approveOf(markup)).toEqual({ label: 'Approve 3', enabled: true })

    // Each group lists its items once opened
    expect(markup).not.toContain('GROCER countdown')
  })

  it('gives a net effect in each currency the group moves, toned by its sign, and says when it moves no balance', () => {
    const markup = renderPreview({
      groups: [
        { kind: 'correction', count: 1, net_effect: [], items: [createReviewItem('uber', 'correction', 'everyday')] },
        {
          kind: 'removal',
          count: 2,
          net_effect: [
            { currency: 'JPY', amount: 500 },
            { currency: 'USD', amount: -1250 },
          ],
          items: [createReviewItem('tokyo', 'removal', 'yen'), createReviewItem('refund', 'removal', 'everyday')],
        },
      ],
      excluded_count: 1,
    })

    expect(groupsOf(markup)).toEqual([
      ['1 correction to apply', 'No balance change'],
      ['2 transactions to remove', `Net effect: +¥500, ${MINUS}$12.50`],
    ])
    expect([toneOf(markup, '+¥500'), toneOf(markup, `${MINUS}$12.50`)]).toEqual(['positive', 'negative'])
    expect(markup).toContain(`1 new item stays in review, ${EXCLUDED_NOTE}`)
  })
})

describe('a preview with nothing to apply', () => {
  it('says so, and offers no approval', () => {
    const markup = renderPreview({ groups: [], excluded_count: 4 })

    expect(markup).toContain('Nothing here can be approved in bulk right now.')
    expect(markup).toContain(`4 new items stay in review, ${EXCLUDED_NOTE}`)
    expect(approveOf(markup)).toEqual({ label: 'Approve 0', enabled: false })
  })
})

describe('a preview not read since the modal opened', () => {
  it('shows nothing cached from before while it works out what would change, and no count to approve', () => {
    const markup = render({ data: EVERYDAY, error: null, isFetchedAfterMount: false })

    expect(groupsOf(markup)).toEqual([])
    expect(markup).not.toContain('Nothing here can be approved')
    expect(approveOf(markup)).toEqual({ label: 'Approve', enabled: false })
  })

  it('says it could not load in place of what it last read, and offers no approval', () => {
    const markup = render({ data: EVERYDAY, error: new Error('offline'), isFetchedAfterMount: true })

    expect(markup).toMatch(/Bulk approval[^<]* could not load/)
    expect(groupsOf(markup)).toEqual([])
    expect(markup).not.toContain('Nothing here can be approved')
    expect(approveOf(markup)).toEqual({ label: 'Approve', enabled: false })
  })
})
