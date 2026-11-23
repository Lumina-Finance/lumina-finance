/**
 * Covers the import rules API: the requests it sends and how the loaded pages change before the server
 * answers a move. Other changes that make the list read again, and the count of conditions the rules
 * hold, are covered too
 *
 * These tests catch a rule sent to the wrong route or with the wrong body, a move that leaves
 * positions or page sizes wrong in the pages on screen, a refused move that isn't put back, a
 * renamed merchant, category, tag or account leaving a rule's row showing the old name, and a count of
 * conditions that stays old after a rule is created, edited or deleted, and a waiting bank item that
 * keeps showing what a rule filled in after the rule or a name it uses changed
 */
import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import { invalidateAccountAggregateData, invalidateRenamedAccountData } from '@/api/cache/updates/accounts'
import { removeCategoryCaches } from '@/api/cache/updates/categories'
import {
  applyImportRuleMove,
  moveRuleInPages,
  removeImportRuleCaches,
  restoreImportRules,
  settleImportRuleMove,
  updateImportRuleCreateCaches,
  updateImportRuleUpdateCaches,
} from '@/api/cache/updates/importRules'
import { removeMerchantCaches, updateMerchantUpdateCaches } from '@/api/cache/updates/merchants'
import { removeTagCaches, updateTagUpdateCaches } from '@/api/cache/updates/tags'
import { bankSyncKeys, importRuleKeys } from '@/api/cache/queryKeys'
import { invalidateAppData } from '@/api/cache/invalidation'
import {
  countImportRuleConditions,
  createImportRule,
  deleteImportRule,
  fetchImportRuleBudget,
  fetchImportRulesPage,
  moveImportRule,
  moveImportRuleInList,
  numberImportRules,
  updateImportRule,
  type ImportRule,
  type ImportRuleBudget,
} from '@/api/import-rules'
import type { Merchant } from '@/api/merchants'
import type { Tag } from '@/api/tags'

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue({})
})

describe('import rule API functions', () => {
  it('reads a page of rules by size and offset', async () => {
    await fetchImportRulesPage(20, 40)

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/import-rules?limit=20&offset=40', expect.anything())
  })

  it('sends the text searched for as q, and nothing when there is none', async () => {
    await fetchImportRulesPage(20, 0, undefined, 'shell & co')
    await fetchImportRulesPage(20, 0, undefined, undefined)

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/import-rules?limit=20&offset=0&q=shell+%26+co',
      expect.anything(),
    )
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(2, '/import-rules?limit=20&offset=0', expect.anything())
  })

  it('creates a rule with its conditions, amounts as decimal text', async () => {
    const payload = {
      name: 'Market',
      match: 'all' as const,
      conditions: [
        {
          kind: 'condition' as const,
          attribute: 'amount' as const,
          operator: 'at_least' as const,
          value: '12.50',
          currency: 'CAD',
        },
      ],
      merchant_id: 'merchant-1',
      tag_ids: [],
    }

    await createImportRule(payload)

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/import-rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  })

  it('updates only the fields sent, a null merchant clearing it', async () => {
    await updateImportRule({ ruleId: 'rule-1', payload: { name: 'Groceries', merchant_id: null } })

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/import-rules/rule-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Groceries', merchant_id: null }),
    })
  })

  it('moves a rule by its new place, counted from zero', async () => {
    await moveImportRule({ ruleId: 'rule-1', position: 0 })

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/import-rules/rule-1/position', {
      method: 'PUT',
      body: JSON.stringify({ position: 0 }),
    })
  })

  it('deletes a rule by its id', async () => {
    await deleteImportRule('rule-1')

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/import-rules/rule-1', { method: 'DELETE' })
  })
})

function buildRule(id: string, position: number): ImportRule {
  return {
    id,
    name: `Rule ${id}`,
    position,
    match: 'all',
    conditions: [{ kind: 'condition', attribute: 'direction', operator: 'is', value: 'out' }],
    merchant: { id: 'merchant-1', name: 'Corner Cafe' },
    category: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** Two loaded pages of two rules each, a, b, c and d, with a third page still to come */
function buildPages(): InfiniteData<ImportRule[]> {
  return {
    pages: [
      [buildRule('a', 0), buildRule('b', 1)],
      [buildRule('c', 2), buildRule('d', 3)],
    ],
    pageParams: [0, 2],
  }
}

const orderOf = (data: InfiniteData<ImportRule[]> | undefined) => data?.pages.map((page) => page.map((rule) => rule.id))

describe('showing a move before the server answers', () => {
  it.each([
    [
      'up into the first page',
      'c',
      0,
      [
        ['c', 'a'],
        ['b', 'd'],
      ],
    ],
    [
      'down across a page',
      'a',
      2,
      [
        ['b', 'c'],
        ['a', 'd'],
      ],
    ],
    [
      'to the very end of what is loaded',
      'a',
      3,
      [
        ['b', 'c'],
        ['d', 'a'],
      ],
    ],
    [
      'one place up',
      'd',
      2,
      [
        ['a', 'b'],
        ['d', 'c'],
      ],
    ],
  ])('moves a rule %s, keeping each page the size it was', (_name, ruleId, position, expected) => {
    expect(orderOf(moveRuleInPages(buildPages(), ruleId, position))).toEqual(expected)
  })

  it('numbers the rules from zero again, those that only shifted included', () => {
    const moved = moveRuleInPages(buildPages(), 'c', 0)

    expect(moved?.pages.flat().map(({ id, position }) => [id, position])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
      ['d', 3],
    ])
  })

  it.each([
    ['a place past the loaded rows, which the page cannot show yet', 'a', 4],
    ['a negative place', 'a', -1],
    ['its own place', 'b', 1],
    ['a rule that is not loaded', 'z', 0],
  ])('leaves the pages as they are for %s', (_name, ruleId, position) => {
    const pages = buildPages()

    expect(moveRuleInPages(pages, ruleId, position)).toBe(pages)
  })

  it('moves the rows the list shows the same way, numbered from zero, and hands back the same array when nothing moves', () => {
    const rows = buildPages().pages.flat()

    expect(moveImportRuleInList(rows, 'd', 1).map(({ id, position }) => [id, position])).toEqual([
      ['a', 0],
      ['d', 1],
      ['b', 2],
      ['c', 3],
    ])
    expect(moveImportRuleInList(rows, 'b', 1)).toBe(rows)
    expect(numberImportRules(rows)).toEqual(rows)
  })

  it('puts the old order back where the server refuses the move', () => {
    const queryClient = new QueryClient()
    const key = importRuleKeys.infinite(2)
    queryClient.setQueryData(key, buildPages())

    const previous = applyImportRuleMove(queryClient, 'c', 0)
    expect(orderOf(queryClient.getQueryData(key))).toEqual([
      ['c', 'a'],
      ['b', 'd'],
    ])

    restoreImportRules(queryClient, previous)
    expect(orderOf(queryClient.getQueryData(key))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    queryClient.clear()
  })

  it('moves every loaded copy of the list, whatever page size it was read at', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(importRuleKeys.infinite(2), buildPages())
    queryClient.setQueryData(importRuleKeys.infinite(4), {
      pages: [[buildRule('a', 0), buildRule('b', 1), buildRule('c', 2), buildRule('d', 3)]],
      pageParams: [0],
    })

    applyImportRuleMove(queryClient, 'd', 0)

    expect(orderOf(queryClient.getQueryData(importRuleKeys.infinite(4)))).toEqual([['d', 'a', 'b', 'c']])
    queryClient.clear()
  })
})

describe('writes to the rules list', () => {
  it('shows an edited rule in place and reads the list again', () => {
    const queryClient = new QueryClient()
    const key = importRuleKeys.infinite(2)
    queryClient.setQueryData(key, buildPages())

    updateImportRuleUpdateCaches(queryClient, { ...buildRule('c', 2), name: 'Renamed' })

    const pages = queryClient.getQueryData<InfiniteData<ImportRule[]>>(key)
    expect(pages?.pages[1][0].name).toBe('Renamed')
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  it('takes a deleted rule out and closes the gap in the positions below it', () => {
    const queryClient = new QueryClient()
    const key = importRuleKeys.infinite(2)
    queryClient.setQueryData(key, buildPages())

    removeImportRuleCaches(queryClient, 'b')

    const pages = queryClient.getQueryData<InfiniteData<ImportRule[]>>(key)
    expect(pages?.pages.flat().map(({ id, position }) => [id, position])).toEqual([
      ['a', 0],
      ['c', 1],
      ['d', 2],
    ])
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  it('keeps a searched list to its own rules: an edit shows in place, a move is left to the read that follows, and a delete leaves the places the rest hold', () => {
    const queryClient = new QueryClient()
    const key = importRuleKeys.searched(2, 'a')
    queryClient.setQueryData(key, { pages: [[buildRule('b', 1), buildRule('d', 3)]], pageParams: [0] })

    updateImportRuleUpdateCaches(queryClient, { ...buildRule('d', 3), name: 'Renamed' })
    expect(queryClient.getQueryData<InfiniteData<ImportRule[]>>(key)?.pages[0].map((rule) => rule.name)).toEqual([
      'Rule b',
      'Renamed',
    ])

    applyImportRuleMove(queryClient, 'd', 0)
    expect(orderOf(queryClient.getQueryData(key))).toEqual([['b', 'd']])

    removeImportRuleCaches(queryClient, 'b')
    expect(
      queryClient
        .getQueryData<InfiniteData<ImportRule[]>>(key)
        ?.pages.flat()
        .map(({ id, position }) => [id, position]),
    ).toEqual([['d', 3]])
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    queryClient.clear()
  })

  it('reads the list again after a rule is created, which goes last', () => {
    const queryClient = new QueryClient()
    const key = importRuleKeys.infinite(2)
    queryClient.setQueryData(key, buildPages())

    updateImportRuleCreateCaches(queryClient)

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    queryClient.clear()
  })
})

describe('the conditions the rules hold in all', () => {
  const budget: ImportRuleBudget = { limit: 100, used: 4 }

  /** A client holding the budget beside a rules list, as the section holds both */
  function seededClient() {
    const queryClient = new QueryClient()
    queryClient.setQueryData(importRuleKeys.infinite(2), buildPages())
    queryClient.setQueryData(importRuleKeys.budget(), budget)
    return {
      queryClient,
      budgetIsStale: () => queryClient.getQueryState(importRuleKeys.budget())?.isInvalidated === true,
    }
  }

  it('reads the limit and the conditions in use from the server', async () => {
    await fetchImportRuleBudget()

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/import-rules/budget', expect.anything())
  })

  it('counts each condition once, those inside groups included, and a group for nothing', () => {
    const condition = { kind: 'condition', attribute: 'direction', operator: 'is', value: 'out' } as const

    expect(countImportRuleConditions([])).toBe(0)
    expect(
      countImportRuleConditions([condition, { kind: 'group', match: 'all', conditions: [condition, condition] }]),
    ).toBe(3)
  })

  it.each([
    ['a rule is created', (queryClient: QueryClient) => updateImportRuleCreateCaches(queryClient)],
    [
      'a rule is edited',
      (queryClient: QueryClient) => updateImportRuleUpdateCaches(queryClient, { ...buildRule('c', 2), name: 'New' }),
    ],
    ['a rule is deleted', (queryClient: QueryClient) => removeImportRuleCaches(queryClient, 'b')],
    ['a rule is moved and the server has answered', (queryClient: QueryClient) => settleImportRuleMove(queryClient)],
    ['app data is read again as a whole', (queryClient: QueryClient) => invalidateAppData(queryClient)],
  ])('reads the count again after %s, since the conditions in use may have changed', (_name, change) => {
    const { queryClient, budgetIsStale } = seededClient()
    expect(budgetIsStale()).toBe(false)

    change(queryClient)

    expect(budgetIsStale()).toBe(true)
    queryClient.clear()
  })

  it('leaves the count as it was while a move or an edit is shown in the loaded pages', () => {
    const { queryClient } = seededClient()

    applyImportRuleMove(queryClient, 'd', 0)
    updateImportRuleUpdateCaches(queryClient, { ...buildRule('c', 2), name: 'New' })

    expect(queryClient.getQueryData(importRuleKeys.budget())).toEqual(budget)
    queryClient.clear()
  })
})

describe('changes elsewhere that a rule row shows', () => {
  const merchant: Merchant = {
    id: 'merchant-1',
    owner_id: 'user-1',
    group_id: null,
    name: 'Corner Cafe',
    is_system: false,
    default_category_id: null,
    created_at: '2026-01-01T00:00:00Z',
  }
  const tag: Tag = { id: 'tag-1', owner_id: 'user-1', group_id: null, name: 'Work', created_at: '2026-01-01T00:00:00Z' }

  /** A client holding a rules list, for each change below to mark as stale */
  function seededClient() {
    const queryClient = new QueryClient()
    const key = importRuleKeys.infinite(2)
    queryClient.setQueryData(key, buildPages())
    return { queryClient, isStale: () => queryClient.getQueryState(key)?.isInvalidated === true }
  }

  it.each([
    [
      'a merchant is renamed',
      (queryClient: QueryClient) => updateMerchantUpdateCaches(queryClient, merchant, { name: 'Cafe' }),
    ],
    [
      'a merchant is deleted or merged away',
      (queryClient: QueryClient) => removeMerchantCaches(queryClient, 'merchant-1'),
    ],
    [
      'a category is deleted or merged away',
      (queryClient: QueryClient) => removeCategoryCaches(queryClient, 'category-1'),
    ],
    ['a tag is renamed', (queryClient: QueryClient) => updateTagUpdateCaches(queryClient, tag)],
    ['a tag is deleted or merged away', (queryClient: QueryClient) => removeTagCaches(queryClient, 'tag-1')],
    [
      'an account is deleted',
      (queryClient: QueryClient) =>
        invalidateAccountAggregateData(queryClient, 'account-1', undefined, { isDeleted: true }),
    ],
    [
      'an account is archived',
      (queryClient: QueryClient) => invalidateAccountAggregateData(queryClient, 'account-1', undefined),
    ],
    [
      'an account is renamed',
      (queryClient: QueryClient) =>
        invalidateRenamedAccountData(queryClient, { name: 'Chequing' }, { name: 'Everyday' }),
    ],
    ['app data is read again as a whole', (queryClient: QueryClient) => invalidateAppData(queryClient)],
  ])('reads the rules again when %s', (_name, change) => {
    const { queryClient, isStale } = seededClient()
    expect(isStale()).toBe(false)

    change(queryClient)

    expect(isStale()).toBe(true)
    queryClient.clear()
  })

  it('leaves the rules alone when an account is saved under the same name', () => {
    const { queryClient, isStale } = seededClient()

    invalidateRenamedAccountData(queryClient, { name: 'Chequing' }, { name: 'Chequing' })

    expect(isStale()).toBe(false)
    queryClient.clear()
  })
})

describe('the review list the rules fill in', () => {
  const merchant: Merchant = {
    id: 'merchant-1',
    owner_id: 'user-1',
    group_id: null,
    name: 'Corner Cafe',
    is_system: false,
    default_category_id: null,
    created_at: '2026-01-01T00:00:00Z',
  }
  const tag: Tag = { id: 'tag-1', owner_id: 'user-1', group_id: null, name: 'Work', created_at: '2026-01-01T00:00:00Z' }

  it.each([
    ['a rule is created', (queryClient: QueryClient) => updateImportRuleCreateCaches(queryClient)],
    [
      'a rule is edited',
      (queryClient: QueryClient) => updateImportRuleUpdateCaches(queryClient, { ...buildRule('c', 2), name: 'New' }),
    ],
    ['a rule is deleted', (queryClient: QueryClient) => removeImportRuleCaches(queryClient, 'b')],
    ['a rule is moved and the server has answered', (queryClient: QueryClient) => settleImportRuleMove(queryClient)],
    [
      'a merchant is renamed',
      (queryClient: QueryClient) => updateMerchantUpdateCaches(queryClient, merchant, { name: 'Cafe' }),
    ],
    [
      'a category is deleted or merged away',
      (queryClient: QueryClient) => removeCategoryCaches(queryClient, 'category-1'),
    ],
    ['a tag is renamed', (queryClient: QueryClient) => updateTagUpdateCaches(queryClient, tag)],
  ])('reads the waiting items again when %s, since the rule behind each fill may have changed', (_name, change) => {
    const queryClient = new QueryClient()
    const key = bankSyncKeys.reviewItems(undefined)
    queryClient.setQueryData(key, { pages: [], pageParams: [] })
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)

    change(queryClient)

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    queryClient.clear()
  })
})

describe('the answer to what the rules give a file import', () => {
  const merchant: Merchant = {
    id: 'merchant-1',
    owner_id: 'user-1',
    group_id: null,
    name: 'Corner Cafe',
    is_system: false,
    default_category_id: null,
    created_at: '2026-01-01T00:00:00Z',
  }
  const tag: Tag = { id: 'tag-1', owner_id: 'user-1', group_id: null, name: 'Work', created_at: '2026-01-01T00:00:00Z' }

  function seededClient() {
    const queryClient = new QueryClient()
    const key = importRuleKeys.matches('3-abc-def')
    queryClient.setQueryData(key, { rows: [] })
    return { queryClient, isStale: () => queryClient.getQueryState(key)?.isInvalidated === true }
  }

  it.each([
    ['a rule is created', (queryClient: QueryClient) => updateImportRuleCreateCaches(queryClient)],
    [
      'a rule is edited',
      (queryClient: QueryClient) => updateImportRuleUpdateCaches(queryClient, { ...buildRule('c', 2), name: 'New' }),
    ],
    ['a rule is deleted', (queryClient: QueryClient) => removeImportRuleCaches(queryClient, 'b')],
    ['a rule is moved and the server has answered', (queryClient: QueryClient) => settleImportRuleMove(queryClient)],
    [
      'a merchant is renamed',
      (queryClient: QueryClient) => updateMerchantUpdateCaches(queryClient, merchant, { name: 'Cafe' }),
    ],
    [
      'a merchant is deleted or merged away',
      (queryClient: QueryClient) => removeMerchantCaches(queryClient, 'merchant-1'),
    ],
    [
      'a category is deleted or merged away',
      (queryClient: QueryClient) => removeCategoryCaches(queryClient, 'category-1'),
    ],
    ['a tag is renamed', (queryClient: QueryClient) => updateTagUpdateCaches(queryClient, tag)],
    ['a tag is deleted or merged away', (queryClient: QueryClient) => removeTagCaches(queryClient, 'tag-1')],
    [
      'an account is deleted',
      (queryClient: QueryClient) =>
        invalidateAccountAggregateData(queryClient, 'account-1', undefined, { isDeleted: true }),
    ],
    [
      'an account is archived',
      (queryClient: QueryClient) => invalidateAccountAggregateData(queryClient, 'account-1', undefined),
    ],
    [
      'an account is renamed',
      (queryClient: QueryClient) =>
        invalidateRenamedAccountData(queryClient, { name: 'Chequing' }, { name: 'Everyday' }),
    ],
  ])('asks again when %s', (_name, change) => {
    const { queryClient, isStale } = seededClient()
    expect(isStale()).toBe(false)

    change(queryClient)

    expect(isStale()).toBe(true)
    queryClient.clear()
  })

  it('is left alone when app data is read again as a whole, so a sync or another tab never restarts the check', () => {
    const { queryClient, isStale } = seededClient()

    invalidateAppData(queryClient)

    expect(isStale()).toBe(false)
    queryClient.clear()
  })
})
