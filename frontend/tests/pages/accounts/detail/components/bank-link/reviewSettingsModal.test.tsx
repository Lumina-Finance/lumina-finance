/**
 * Covers the Review settings dialogue as it opens: on the preset the saved choices amount to, with
 * Custom's rows for a mix, the explanations of what each choice does, and Save beside Cancel
 *
 * These tests catch a newly linked account opening on anything but Review all, a saved mix shown as
 * a preset or without the row that differs, a row losing its description, the explanations of what
 * reviewing and auto-approving do or the merchant and category note missing or reworded, Save or a
 * preset live before the choices load or while a save is in flight, and a failed read showing choices
 * it never read. Choosing a preset, unfolding Custom, saving and cancelling run in the browser
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewPreferences } from '@/api/bank-sync'
import { ReviewSettingsModal } from '@/pages/accounts/detail/components/bank-link/ReviewSettingsModal'

const read = vi.hoisted(() => ({
  saved: undefined as ReviewPreferences | undefined,
  error: null as Error | null,
  saving: false,
}))

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/modal/Shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/modal/Shell')>()),
  ModalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useReviewPreferences: () => ({ data: read.saved, error: read.error }),
  useUpdateReviewPreferences: () => ({ isPending: read.saving, mutate: () => {} }),
}))

const INTRO =
  'Reviewed changes wait above the transaction list. Auto-approved ones are applied as they arrive, which can change ledger values without a review step.'
const NOTE =
  'New transactions need a merchant and category before they can be added, so they wait for review whichever you choose.'
const ROWS = [
  ['New transactions', 'Still need a merchant and category before they are added'],
  ['Corrections', 'The bank changes the date, amount or description'],
  ['Removals', 'The bank reports a transaction as removed'],
]

// Static rendering marks where one text node meets the next, and text is matched without those marks
function renderDialog(): string {
  return renderToStaticMarkup(<ReviewSettingsModal open accountId="account-1" onClose={() => {}} />).replaceAll(
    '<!-- -->',
    '',
  )
}

function getTablist(markup: string, label: string): string {
  return (
    markup.match(
      new RegExp(`<div[^>]*role="tablist"[^>]*aria-label="${label}"[^>]*>(?:(?!role="tablist").)*`, 's'),
    )?.[0] ?? ''
  )
}

// The opening tag of each tab in the tablist
function getTabs(tablist: string): string[] {
  return [...tablist.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(([tab]) => tab)
}

// The text of each tab marked selected
function getSelected(tablist: string): string[] {
  return [...tablist.matchAll(/<button[^>]*aria-selected="true"[^>]*>(.*?)<\/button>/gs)].map(([, content]) =>
    content.replace(/<[^>]+>/g, ''),
  )
}

function getButton(markup: string, label: string): string {
  return markup.match(new RegExp(`<button(?:(?!</button>).)*>${label}</button>`, 's'))?.[0] ?? ''
}

beforeEach(() => {
  read.saved = { new_transactions: 'review', corrections: 'review', removals: 'review' }
  read.error = null
  read.saving = false
})

describe('ReviewSettingsModal', () => {
  it('opens a newly linked account on Review all, with Custom folded away', () => {
    const markup = renderDialog()
    expect(markup).toContain('Bank sync')
    expect(markup).toContain('Review settings')
    expect(getSelected(getTablist(markup, 'Review preset'))).toEqual(['Review all'])
    expect(markup).not.toContain(ROWS[0][1])
  })

  it('opens choices that all auto-approve on Auto-approve all', () => {
    read.saved = { new_transactions: 'trust', corrections: 'trust', removals: 'trust' }
    expect(getSelected(getTablist(renderDialog(), 'Review preset'))).toEqual(['Auto-approve all'])
  })

  it('opens a saved mix on Custom, each row described and set as saved', () => {
    read.saved = { new_transactions: 'review', corrections: 'trust', removals: 'review' }
    const markup = renderDialog()
    expect(getSelected(getTablist(markup, 'Review preset'))).toEqual(['Custom'])
    for (const [label, description] of ROWS) {
      expect(markup).toContain(`>${label}</p>`)
      expect(markup).toContain(description)
    }
    expect(getSelected(getTablist(markup, 'New transactions'))).toEqual(['Review'])
    expect(getSelected(getTablist(markup, 'Corrections'))).toEqual(['Auto-approve'])
    expect(getSelected(getTablist(markup, 'Removals'))).toEqual(['Review'])
  })

  it('says what reviewing and auto-approving do, and that new transactions wait whichever is chosen', () => {
    const markup = renderDialog()
    expect(markup).toContain(INTRO)
    expect(markup).toContain(NOTE)
  })

  it('puts Save after Cancel, and holds Save and the presets until the choices load', () => {
    read.saved = undefined
    const markup = renderDialog()
    expect(markup).toMatch(/>Cancel<\/button>.*>Save<\/button>/s)
    expect(getButton(markup, 'Save')).toContain('disabled=""')
    const presets = getTabs(getTablist(markup, 'Review preset'))
    expect(presets).toHaveLength(3)
    expect(presets.filter((tab) => !tab.includes('disabled=""'))).toEqual([])
    expect(getSelected(getTablist(markup, 'Review preset'))).toEqual([])
  })

  it('holds every choice and Cancel while the save is in flight', () => {
    read.saved = { new_transactions: 'review', corrections: 'trust', removals: 'review' }
    read.saving = true
    const markup = renderDialog()
    expect(getButton(markup, 'Cancel')).toContain('disabled=""')
    expect(markup).toContain('aria-busy="true"')
    for (const label of ['Review preset', 'New transactions', 'Corrections', 'Removals']) {
      const tabs = getTabs(getTablist(markup, label))
      expect(tabs).not.toEqual([])
      expect(tabs.filter((tab) => !tab.includes('disabled=""'))).toEqual([])
    }
  })

  it('says the choices could not load rather than showing any', () => {
    read.saved = undefined
    read.error = new Error('Failed to fetch')
    const markup = renderDialog()
    expect(markup).toContain('Review settings could not load')
    expect(markup).not.toContain('role="tablist"')
    expect(getButton(markup, 'Save')).toContain('disabled=""')
  })
})
