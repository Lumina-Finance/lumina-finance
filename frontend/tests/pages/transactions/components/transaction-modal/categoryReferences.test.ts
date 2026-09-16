import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCategoryField } from '@/pages/transactions/components/transaction-modal/hooks/useCategoryField'
import { useMerchantField } from '@/pages/transactions/components/transaction-modal/hooks/useMerchantField'
import { buildInitialTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/initialForm'
import { getFormAfterKindChange } from '@/pages/transactions/components/transaction-modal/utils/formTransitions'
import type { TransactionFormValues, TransactionModalKind } from '@/pages/transactions/components/transaction-modal/types'
import { createAccount, createCategory, currencies } from './utils/fixtures'

const merchantState = vi.hoisted(() => ({
  merchant: {
    id: 'merchant',
    name: 'Personal merchant',
    group_id: null,
    owner_id: 'user',
    is_system: false,
    default_category_id: null as string | null,
  },
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

beforeEach(() => {
  merchantState.merchant.default_category_id = null
  merchantState.mutate.mockReset()
})

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

  it('clears transfer references when directly selecting a personal Balance Adjustment', () => {
    const personalAdjustment = createCategory({
      id: 'personal-adjustment', kind: 'transfer', name: 'Balance Adjustment', is_system: false,
    })
    const form = {
      ...buildInitialTransactionForm({
        categories: [personalAdjustment], currencies,
        selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
      }),
      kind: 'transfer' as const,
      category_id: 'regular-transfer',
      counterparty_account_id: 'savings',
      symmetric_transfer: true,
    }
    const applyKindChange = vi.fn()
    const field = useCategoryField({
      categories: [personalAdjustment], form, readOnly: false,
      applyKindChange, clearError: vi.fn(), closeModal: vi.fn(),
    })

    field.handleCategoryChange(personalAdjustment.id)

    expect(applyKindChange).toHaveBeenCalledWith('transfer', {
      category_id: personalAdjustment.id,
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })

  it('clears transfer references when a merchant supplies a personal Balance Adjustment default', () => {
    const personalAdjustment = createCategory({
      id: 'personal-adjustment', kind: 'transfer', name: 'Balance Adjustment', is_system: false,
    })
    merchantState.merchant.default_category_id = personalAdjustment.id
    const form = {
      ...buildInitialTransactionForm({
        categories: [personalAdjustment], currencies,
        selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
      }),
      kind: 'transfer' as const,
      counterparty_account_id: 'savings',
      symmetric_transfer: true,
    }
    const applyKindChange = vi.fn()
    const field = useCategoryField({
      categories: [personalAdjustment], form, readOnly: false,
      applyKindChange: vi.fn(), clearError: vi.fn(), closeModal: vi.fn(),
    })
    const merchant = useMerchantField({
      open: true, categoryById: field.categoryById, categoryOptions: field.categoryOptions,
      selectedCategory: field.selectedCategory, form, readOnly: false,
      setForm: vi.fn(), applyKindChange, clearError: vi.fn(), closeModal: vi.fn(),
      setSubmitError: vi.fn(), setSubmitErrorTitle: vi.fn(),
    })

    merchant.handleMerchantChange(merchantState.merchant.id)

    expect(applyKindChange).toHaveBeenCalledWith('transfer', {
      merchant_id: merchantState.merchant.id,
      category_id: personalAdjustment.id,
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })

  it('clears transfer references when a created merchant supplies a personal Balance Adjustment default', () => {
    const personalAdjustment = createCategory({
      id: 'personal-adjustment', kind: 'transfer', name: 'Balance Adjustment', is_system: false,
    })
    const form = {
      ...buildInitialTransactionForm({
        categories: [personalAdjustment], currencies,
        selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
      }),
      kind: 'transfer' as const,
      counterparty_account_id: 'savings',
      symmetric_transfer: true,
    }
    const applyKindChange = vi.fn()
    const field = useCategoryField({
      categories: [personalAdjustment], form, readOnly: false,
      applyKindChange: vi.fn(), clearError: vi.fn(), closeModal: vi.fn(),
    })
    const merchant = useMerchantField({
      open: true, categoryById: field.categoryById, categoryOptions: field.categoryOptions,
      selectedCategory: field.selectedCategory, form, readOnly: false,
      setForm: vi.fn(), applyKindChange, clearError: vi.fn(), closeModal: vi.fn(),
      setSubmitError: vi.fn(), setSubmitErrorTitle: vi.fn(),
    })
    const createdMerchant = {
      id: 'created-merchant',
      name: 'Created merchant',
      group_id: null,
      owner_id: 'user',
      is_system: false,
      default_category_id: personalAdjustment.id,
      created_at: '2026-09-14T00:00:00Z',
    }

    merchant.handleMerchantCreated(createdMerchant)

    expect(applyKindChange).toHaveBeenCalledWith('transfer', {
      merchant_id: createdMerchant.id,
      category_id: personalAdjustment.id,
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })

  it('changes only the merchant when it has no default category', () => {
    const form = {
      ...buildInitialTransactionForm({
        categories: [personal], currencies,
        selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
      }),
      kind: 'transfer' as const,
      direction: 'credit' as const,
      category_id: 'regular-transfer',
    }
    const setForm = vi.fn()
    const applyKindChange = vi.fn()
    const field = useCategoryField({
      categories: [personal], form, readOnly: false,
      applyKindChange: vi.fn(), clearError: vi.fn(), closeModal: vi.fn(),
    })
    const merchant = useMerchantField({
      open: true, categoryById: field.categoryById, categoryOptions: field.categoryOptions,
      selectedCategory: field.selectedCategory, form, readOnly: false,
      setForm, applyKindChange, clearError: vi.fn(), closeModal: vi.fn(),
      setSubmitError: vi.fn(), setSubmitErrorTitle: vi.fn(),
    })

    merchant.handleMerchantChange(merchantState.merchant.id)

    expect(applyKindChange).not.toHaveBeenCalled()
    const update = setForm.mock.calls[0]?.[0]
    expect(update(form)).toEqual({ ...form, merchant_id: merchantState.merchant.id })
  })

  it('keeps ordinary inline-created Transfer selection free of adjustment cleanup', () => {
    const transfer = createCategory({ id: 'new-transfer', kind: 'transfer', name: 'Account move' })
    const form = {
      ...buildInitialTransactionForm({
        categories: [], currencies,
        selectableAccounts: [createAccount({ id: 'checking' })], timeZone: 'UTC',
      }),
      kind: 'transfer' as const,
      counterparty_account_id: 'savings',
      symmetric_transfer: true,
    }
    const applyKindChange = vi.fn()
    const field = useCategoryField({
      categories: [], form, readOnly: false,
      applyKindChange, clearError: vi.fn(), closeModal: vi.fn(),
    })

    field.handleCategoryCreated(transfer)

    expect(applyKindChange).toHaveBeenCalledWith('transfer', { category_id: transfer.id })
  })
})
