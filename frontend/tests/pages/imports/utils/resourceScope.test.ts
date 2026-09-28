/**
 * Tests that a provider import offers and matches only the user's own accounts and
 * categories, never a group's
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { buildImportCategoryMatchOptions } from '@/pages/imports/utils'
import { getPersonalAccounts, getPersonalCategoryOptions, resolveProviderAccountMappings } from '@/pages/imports/utils/resourceScope'

function account(id: string, name: string, groupId: string | null = null) {
  return { id, name, currency: 'CAD', can_write: true, is_archived: false, group_id: groupId } as AccountsOverview
}

const CHEQUING = account('chequing', 'Chequing')
const FAMILY_CHEQUING = account('family-chequing', 'Chequing', 'family')
const FAMILY_SAVINGS = account('family-savings', 'Savings', 'family')
const SOURCES = [
  { id: 'chequing-source', label: 'Chequing', matchText: 'Chequing', isCounterpartyOnly: false },
  { id: 'savings-source', label: 'Savings', matchText: 'Savings', isCounterpartyOnly: false },
]

describe('Provider import scope', () => {
  it('links only to the user\'s own accounts', () => {
    const accounts = [CHEQUING, FAMILY_CHEQUING, FAMILY_SAVINGS]

    expect(getPersonalAccounts(accounts)).toEqual([CHEQUING])
    expect(resolveProviderAccountMappings(SOURCES, {}, accounts, true)).toEqual({
      'chequing-source': CHEQUING.id,
      'savings-source': CREATE_ACCOUNT_VALUE,
    })
  })

  it('leaves group categories out of the choices', () => {
    const groceries = { id: 'groceries', name: 'Groceries', kind: 'expense', group_id: null } as Category
    const familyGroceries = { id: 'family-groceries', name: 'Groceries', kind: 'expense', group_id: 'family' } as Category
    const categories = [groceries, familyGroceries]
    const options = getPersonalCategoryOptions(buildImportCategoryMatchOptions(categories), new Map(categories.map((entry) => [entry.id, entry])))

    expect(options.map((option) => option.value)).toEqual([CREATE_CATEGORY_VALUE, groceries.id])
  })
})
