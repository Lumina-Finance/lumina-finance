/**
 * Guards the bank marker on a transaction row: a bank-imported row names its provider and adds the
 * edited note and the Needs review marker only when they apply, a manual row carries no marker, the
 * marker's controls are never nested inside the row's own button, nor open the row when pressed, and
 * the row's button is its title, so a screen reader does not read the row and its provider twice,
 * described by the amount and date that tabbing from row to row would otherwise not say
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BankMarker } from '@/components/transactions/BankMarker'
import { TransactionRowView, type TransactionRowMetadata } from '@/components/transactions/Row'

// The row renders a layout for each breakpoint and shows only one, so each marker appears this often
const LAYOUTS = 2

const TRANSACTION: TransactionRowMetadata = {
  id: 'transaction-1',
  dt: '2026-10-04',
  merchant_name: 'Corner Grocer',
  notes: null,
  tags: [],
  counterparty_account_scope: null,
}

function renderRow(bankMarker?: Parameters<typeof BankMarker>[0]) {
  return renderToStaticMarkup(
    <TransactionRowView
      category={undefined}
      transaction={TRANSACTION}
      amountPresentation={{ text: '+CA$42.50', sign: 1 }}
      bankMarker={bankMarker}
      onOpen={() => {}}
    />,
  )
}

/** The text of the element carrying the given id. The element holds no markup of its own */
function textOf(markup: string, id: string): string | undefined {
  return markup.split(`id="${id}"`)[1]?.match(/^[^>]*>([^<]*)</)?.[1]
}

/** Whether any button opens before the button around it has closed */
function hasNestedButton(markup: string): boolean {
  let depth = 0
  for (const [tag] of markup.matchAll(/<\/?button\b/g)) {
    depth += tag.startsWith('</') ? -1 : 1
    if (depth > 1) return true
  }
  return false
}

describe('bank marker', () => {
  it("names the provider in each of the row's two layouts and nothing more while it is untouched", () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: false, needsReview: false })

    expect(markup.split('aria-label="From SimpleFIN"')).toHaveLength(LAYOUTS + 1)
    expect(markup).not.toContain('You edited a value from the bank')
    expect(markup).not.toContain('Needs review')
  })

  it('adds the edited note and the Needs review marker when they apply, outside the row button', () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: true, needsReview: true, onShowReview: () => {} })

    expect(markup.split('You edited a value from the bank')).toHaveLength(LAYOUTS + 1)
    expect(markup).toContain('aria-label="Needs review. Show the waiting item"')
    expect(hasNestedButton(markup)).toBe(false)
  })

  it("says the value was edited in the marker's own name, since its closed panel is not read", () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: true, needsReview: false })

    expect(markup.split('aria-label="From SimpleFIN, edited"')).toHaveLength(LAYOUTS + 1)
  })

  it("makes the title the row's button, so the row is read once with the provider named once", () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: false, needsReview: true, onShowReview: () => {} })

    expect(markup.match(/<button [^>]*><span [^>]*>Corner Grocer<\/span><\/button>/g)).toHaveLength(LAYOUTS)
    expect(markup).not.toContain('aria-labelledby')
    expect(
      markup.match(/aria-hidden="true"[^>]*><span class="app-tooltip-panel[^>]*><span [^>]*>From SimpleFIN</g),
    ).toHaveLength(LAYOUTS)
  })

  it('describes each title by the category and the amount in its own layout and by the heading that names its day', () => {
    const markup = renderToStaticMarkup(
      <>
        <p id="day-heading">October 4, 2026</p>
        <TransactionRowView
          category={undefined}
          transaction={TRANSACTION}
          amountPresentation={{ text: '+CA$42.50', sign: 1 }}
          dateHeadingId="day-heading"
          onOpen={() => {}}
        />
      </>,
    )
    const descriptions = [
      ...markup.matchAll(/<button [^>]*aria-describedby="([^"]+)"[^>]*><span [^>]*>Corner Grocer</g),
    ].map(([, ids]) => ids.split(' ').map((id) => textOf(markup, id)))

    // The wide layout shows the category before the amount and the phone layout after it
    expect(descriptions).toEqual([
      ['Uncategorized', '+CA$42.50', 'October 4, 2026'],
      ['+CA$42.50', 'Uncategorized', 'October 4, 2026'],
    ])
    expect(new Set([...markup.matchAll(/aria-describedby="([^" ]+) /g)].map(([, id]) => id)).size).toBe(LAYOUTS)

    // The date is the heading's alone, so a search for it finds the heading rather than a copy in each row
    expect(markup.split('October 4, 2026')).toHaveLength(2)
  })

  it('keeps a press on the marker from reaching the row', () => {
    const marker = BankMarker({ providerName: 'SimpleFIN', isEdited: false, needsReview: true })
    const stopPropagation = vi.fn()

    marker.props.onClick({ stopPropagation })

    expect(stopPropagation).toHaveBeenCalledOnce()
  })

  it('lays the Needs review hover tint as a fading layer, since a background image cannot ease', () => {
    const markup = renderToStaticMarkup(BankMarker({ providerName: 'SimpleFIN', isEdited: false, needsReview: true }))
    const tag = markup.match(/<button[^>]*aria-label="Needs review[^>]*>/)?.[0]

    expect(tag).not.toContain('bg-[image:')
    expect(tag).toContain('after:opacity-0')
    expect(tag).toContain('hover:after:opacity-100')
    expect(tag).toContain('after:transition-opacity')
    expect(tag).toContain('transition-control')
  })

  it('leaves a manual row without any marker', () => {
    const markup = renderRow()

    expect(markup).toContain('Corner Grocer')
    expect(markup).not.toContain('From SimpleFIN')
  })
})
