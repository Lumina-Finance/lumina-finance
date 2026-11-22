/**
 * Covers what each delete dialogue of Merchants, Categories and Tags says, by the reason the server gave for
 * refusing the delete: transactions in the way keep the dialogue's wording, and an import rule in the way
 * names the rule and stops talking about moving transactions
 *
 * These tests catch a refusal for transactions that takes the import rule's wording, one for an import rule
 * that keeps saying the transactions will move, and a dialogue that stops passing the reason on
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ accessToken: null, user: null }) }))

// The real panel renders into a portal, and markup rendered to a string can't hold one
vi.mock('@/components/modal/TitledPanel', () => ({
  ModalTitledPanel: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {children}
    </div>
  ),
}))

import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { Tag } from '@/api/tags'
import MergeDeleteCategoryModal from '@/pages/settings/components/category-settings-section/modals/MergeDeleteModal'
import MergeDeleteMerchantModal from '@/pages/settings/components/merchant-settings-section/modals/MergeDeleteModal'
import MergeDeleteTagModal from '@/pages/settings/components/tag-settings-section/modals/MergeDeleteModal'

const MERCHANT: Merchant = {
  id: 'm1',
  owner_id: 'u1',
  group_id: null,
  name: 'Corner Market',
  is_system: false,
  default_category_id: null,
  created_at: '2026-01-01T00:00:00Z',
}
const CATEGORY: Category = {
  id: 'c1',
  owner_id: 'u1',
  group_id: null,
  name: 'Groceries',
  kind: 'expense',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}
const TAG: Tag = { id: 't1', owner_id: 'u1', group_id: null, name: 'food', created_at: '2026-01-01T00:00:00Z' }

const TRANSACTIONS_TITLE = 'Move transactions first'
const RULE_TITLE = 'Choose a replacement first'

const noop = () => {}
const handlers = { open: true, isPending: false, onClose: noop, onExitComplete: noop, onMerge: async () => {} }

const DIALOGUES = [
  {
    noun: 'merchant',
    name: 'Corner Market',
    render: (reason: string | null) => <MergeDeleteMerchantModal {...handlers} merchant={MERCHANT} reason={reason} />,
  },
  {
    noun: 'category',
    name: 'Groceries',
    render: (reason: string | null) => (
      <MergeDeleteCategoryModal {...handlers} category={CATEGORY} categories={[CATEGORY]} reason={reason} />
    ),
  },
  {
    noun: 'tag',
    name: 'food',
    render: (reason: string | null) => <MergeDeleteTagModal {...handlers} tag={TAG} reason={reason} />,
  },
]

function render(element: ReactNode): string {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>)
}

describe.each(DIALOGUES)('the $noun delete dialogue', ({ noun, name, render: dialogue }) => {
  const transactionsSentence = `${name} is used by existing transactions. Choose another ${noun} for those transactions, then it can be deleted.`

  it.each([
    ['no reason', null],
    ['a reason that is about transactions', `${noun[0].toUpperCase()}${noun.slice(1)} is used by 3 transactions`],
  ])('keeps its wording about moving transactions for %s', (_label, reason) => {
    const markup = render(dialogue(reason))

    expect(markup).toContain(`<h2>${TRANSACTIONS_TITLE}</h2>`)
    expect(markup).toContain(transactionsSentence)
    expect(markup).not.toContain('import rule')
  })

  it('names the import rule in the way and asks for a replacement when a rule uses it', () => {
    const reason = `${noun[0].toUpperCase()}${noun.slice(1)} is used by the import rule "Market"`
    const markup = render(dialogue(reason))

    expect(markup).toContain(`<h2>${RULE_TITLE}</h2>`)
    // Markup writes the rule's quotation marks as entities
    const sentence = `${reason}. Please choose another ${noun} to take its place, then you can delete it.`
    expect(markup).toContain(sentence.replaceAll('"', '&quot;'))
    expect(markup).not.toContain('existing transactions')
    expect(markup).not.toContain(TRANSACTIONS_TITLE)
  })
})
