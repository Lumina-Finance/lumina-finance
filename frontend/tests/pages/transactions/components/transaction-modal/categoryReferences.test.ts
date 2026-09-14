import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCategoryField } from '@/pages/transactions/components/transaction-modal/hooks/useCategoryField'
import { useMerchantField } from '@/pages/transactions/components/transaction-modal/hooks/useMerchantField'
import { buildInitialTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/initialForm'
import { getFormAfterKindChange } from '@/pages/transactions/components/transaction-modal/utils/formTransitions'
import type { TransactionFormValues, TransactionModalKind } from '@/pages/transactions/components/transaction-modal/types'
import { createAccount, createCategory, currencies } from './utils/fixtures'

const merchantState = vi.hoisted(() => ({
  merchant: { id: 'merchant', name: 'Personal merchant', group_id: null, owner_id: 'user', is_system: false, default_category_id: null },
  mutate: vi.fn(),
}))

// Only hook mechanics/reference loading are replaced; category and merchant action policies are real
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: <T>(compute: () => T) => compute(),
  useState: <T>(initial: T) => [initial, vi.fn()],
}))
vi.mock('@/api/merchants', () => ({
  useInfiniteMerchants: () => ({ hasNextPage: false }),
  useMerchant: () => ({ data: merchantState.merchant }),
  useUpdateMerchant: () => ({ isPending: false, mutate: merchantState.mutate }),
}))
vi.mock('@/pages/transactions/components/transaction-modal/hooks/useDebouncedReferenceSearch', () => ({
  useDebouncedReferenceSearch: () => ({ search: '', activeSearchText: '', setSearch: vi.fn(), setActiveSearch: vi.fn() }),
}))
vi.mock('@/pages/transactions/components/transaction-modal/hooks/usePagedReferenceDropdown', () => ({
  usePagedReferenceDropdown: () => ({ visibleItems: [merchantState.merchant], loadMore: vi.fn() }),
}))

const personal = createCategory({ id: 'personal', name: 'Personal expense', owner_id: 'user' })
const system = createCategory({ id: 'system', name: 'System income', kind: 'income', is_system: true })

beforeEach(() => merchantState.mutate.mockReset())

describe('transaction category and merchant selection', () => {
  it.each(['expense', 'income', 'transfer'] as const)('offers every category with %s first', (kind) => {
    const transfer = createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer' })
    const categories = [personal, system, transfer]
    const form = { ...buildInitialTransactionForm({
      categories, currencies,
      selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
    }), kind }
    const field = useCategoryField({
      categories, form, readOnly: false,
      applyKindChange: vi.fn(), clearError: vi.fn(), closeModal: vi.fn(),
    })
    const first = categories.find((category) => category.kind === kind)!

    expect(field.categoryOptions.map((option) => option.value)).toEqual([
      first.id, ...categories.filter((category) => category.kind !== kind).map((category) => category.id),
    ])
  })

  it.each([
    ['expense', 'income', 'credit'],
    ['income', 'expense', 'debit'],
    ['income', 'transfer', 'debit'],
  ] as const)('selecting a category changes %s to %s and its direction', (fromKind, nextKind, direction) => {
    const transfer = createCategory({ id: 'transfer', name: 'Transfer', kind: 'transfer' })
    const categories = [personal, system, transfer]
    const initial = {
      ...buildInitialTransactionForm({
        categories, currencies,
        selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
      }),
      kind: fromKind, direction: fromKind === 'income' ? 'credit' as const : 'debit' as const,
      amount: '12.34', notes: 'Keep these details',
    }
    let form: TransactionFormValues = initial
    const selected = categories.find((category) => category.kind === nextKind)!
    const applyKindChange = (kind: TransactionModalKind, fields?: Partial<TransactionFormValues>) => {
      form = getFormAfterKindChange(form, kind, fields)
    }
    const field = useCategoryField({
      categories, form, readOnly: false, applyKindChange,
      clearError: vi.fn(), closeModal: vi.fn(),
    })

    expect(field.categoryOptions.some((option) => option.value === selected.id)).toBe(true)
    field.handleCategoryChange(selected.id)

    expect(form).toMatchObject({
      kind: nextKind, direction, category_id: selected.id,
      amount: initial.amount, notes: initial.notes, date: initial.date, account_id: initial.account_id,
    })
    const updatedField = useCategoryField({
      categories, form, readOnly: false, applyKindChange,
      clearError: vi.fn(), closeModal: vi.fn(),
    })
    expect(updatedField.categoryOptions[0]?.value).toBe(selected.id)
  })

  it('keeps all category kinds available for an inline merchant default', () => {
    const form = buildInitialTransactionForm({
      categories: [personal, system], currencies,
      selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
    })
    const field = useCategoryField({
      categories: [personal, system], form, readOnly: false,
      applyKindChange: vi.fn(), clearError: vi.fn(), closeModal: vi.fn(),
    })
    const merchant = useMerchantField({
      open: true, categoryById: field.categoryById, categoryOptions: field.categoryOptions,
      selectedCategory: field.selectedCategory, form, readOnly: false,
      setForm: vi.fn(), applyKindChange: vi.fn(), clearError: vi.fn(), closeModal: vi.fn(),
      setSubmitError: vi.fn(), setSubmitErrorTitle: vi.fn(),
    })

    expect(merchant.merchantDefaultCategoryOptions.map((option) => option.value)).toEqual([
      '__none__', personal.id, system.id,
    ])
  })
})
