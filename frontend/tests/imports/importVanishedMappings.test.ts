/**
 * Tests that a mapping pointing at a record the user has since deleted is dropped rather than sent,
 * and that the answers which are not record ids survive the same pass
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { dropVanishedAccountMappings, dropVanishedCategoryMappings } from '@/pages/imports/utils'

const chequing = { id: 'chequing', name: 'Chequing' } as AccountsOverview
const archivedSavings = { id: 'savings', name: 'Old Savings', is_archived: true } as AccountsOverview
const groceries = { id: 'groceries', name: 'Groceries' } as Category

const accountById = new Map([[chequing.id, chequing], [archivedSavings.id, archivedSavings]])
const categoryById = new Map([[groceries.id, groceries]])

describe('dropping an account mapping whose account has gone', () => {
  it('keeps a mapping to an account that still exists', () => {
    const result = dropVanishedAccountMappings({ 'TD Chequing': 'chequing' }, accountById)

    expect(result.mappings).toEqual({ 'TD Chequing': 'chequing' })
    expect(result.clearedSources.size).toBe(0)
  })

  it('drops a mapping to an account that no longer exists and reports the source', () => {
    const result = dropVanishedAccountMappings({ 'TD Chequing': 'deleted-account' }, accountById)

    expect(result.mappings).toEqual({})
    expect([...result.clearedSources]).toEqual(['TD Chequing'])
  })

  // Both are answers rather than account ids, so judging them against the account list would clear
  // a row the moment it was answered and no row could ever be set to create an account
  it('keeps the create and outside answers, which are not account ids', () => {
    const answers = { 'TD Chequing': CREATE_ACCOUNT_VALUE, Mum: OUTSIDE_ACCOUNT_VALUE, Blank: '' }

    const result = dropVanishedAccountMappings(answers, accountById)

    expect(result.mappings).toEqual(answers)
    expect(result.clearedSources.size).toBe(0)
  })

  // The account list the dropdown offers leaves archived accounts out, so judging against it would
  // clear the archived account a counterparty row is deliberately allowed to keep
  it('keeps a mapping to an archived account', () => {
    const result = dropVanishedAccountMappings({ Mum: 'savings' }, accountById)

    expect(result.mappings).toEqual({ Mum: 'savings' })
    expect(result.clearedSources.size).toBe(0)
  })

  it('leaves the answered sources alone while clearing the one that lost its account', () => {
    const answers = { 'TD Chequing': 'chequing', 'Old Card': 'deleted-account', Mum: OUTSIDE_ACCOUNT_VALUE }

    const result = dropVanishedAccountMappings(answers, accountById)

    expect(result.mappings).toEqual({ 'TD Chequing': 'chequing', Mum: OUTSIDE_ACCOUNT_VALUE })
    expect([...result.clearedSources]).toEqual(['Old Card'])
  })
})

describe('dropping a category match whose category has gone', () => {
  it('keeps a match to a category that still exists', () => {
    const result = dropVanishedCategoryMappings({ FOOD: 'groceries' }, categoryById)

    expect(result.mappings).toEqual({ FOOD: 'groceries' })
    expect(result.clearedSources.size).toBe(0)
  })

  it('drops a match to a category that no longer exists and reports the name', () => {
    const result = dropVanishedCategoryMappings({ FOOD: 'deleted-category' }, categoryById)

    expect(result.mappings).toEqual({})
    expect([...result.clearedSources]).toEqual(['FOOD'])
  })

  it('keeps the create answer, which is not a category id', () => {
    const answers = { FOOD: CREATE_CATEGORY_VALUE, RENT: '' }

    const result = dropVanishedCategoryMappings(answers, categoryById)

    expect(result.mappings).toEqual(answers)
    expect(result.clearedSources.size).toBe(0)
  })
})
