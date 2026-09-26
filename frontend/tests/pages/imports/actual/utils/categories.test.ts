/**
 * Tests the category answers the Actual Budget import fills in and the choices a transfer row gets
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { buildImportCategoryMatchOptions } from '@/pages/imports/utils'
import { getActualTransferCategoryOptions, inferActualCategoryMappings } from '@/pages/imports/actual/utils/categories'
import { normaliseActualFixture } from './fixtures'

function category(id: string, name: string, kind: Category['kind'], isSystem = false): Category {
  return { id, name, kind, is_system: isSystem, group_id: null, owner_id: null, icon: null, created_at: '' }
}

const MISCELLANEOUS = category('misc', 'Miscellaneous', 'expense', true)
const TRANSFER = category('transfer', 'Transfer', 'transfer', true)
const BALANCE_ADJUSTMENT = category('balance', 'Balance Adjustment', 'transfer', true)
const GROCERIES = category('groceries', 'groceries', 'expense')
const CAR_INCOME = category('car-income', 'Car', 'income')
const CAR_TRANSFERS = category('car-transfers', 'Car Transfers', 'transfer')
const CATEGORIES = [MISCELLANEOUS, TRANSFER, BALANCE_ADJUSTMENT, GROCERIES, CAR_INCOME, CAR_TRANSFERS]

describe('Actual Budget category defaults', () => {
  it('matches names of the same kind, files rows without a category under Miscellaneous and creates the rest', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const mappings = inferActualCategoryMappings(journal.categories, {}, CATEGORIES)
    const byLabel = Object.fromEntries(journal.categories.map((source) => [source.label, mappings[source.id]]))

    expect(byLabel).toEqual({
      'Car': CREATE_CATEGORY_VALUE,
      'Groceries': GROCERIES.id,
      'Gym': CREATE_CATEGORY_VALUE,
      'Income': CREATE_CATEGORY_VALUE,
      'Travel (Away)': CREATE_CATEGORY_VALUE,
      'Travel (Home)': CREATE_CATEGORY_VALUE,
      'Car · transfers to and from off-budget accounts': CAR_TRANSFERS.id,
      'No category': MISCELLANEOUS.id,
      'No category · Car Loan': MISCELLANEOUS.id,
    })
  })

  it('keeps an answer the user gave', async () => {
    const { journal } = await normaliseActualFixture('edges')
    const groceries = journal.categories.find((source) => source.label === 'Groceries')!

    expect(inferActualCategoryMappings(journal.categories, { [groceries.id]: MISCELLANEOUS.id }, CATEGORIES)[groceries.id]).toBe(MISCELLANEOUS.id)
  })

  it('offers a transfer row only categories that record the other account', () => {
    const options = buildImportCategoryMatchOptions(CATEGORIES)
    const categoryById = new Map(CATEGORIES.map((entry) => [entry.id, entry]))

    expect(getActualTransferCategoryOptions(options, categoryById).map((option) => option.value))
      .toEqual([CREATE_CATEGORY_VALUE, CAR_TRANSFERS.id, TRANSFER.id])
  })
})
