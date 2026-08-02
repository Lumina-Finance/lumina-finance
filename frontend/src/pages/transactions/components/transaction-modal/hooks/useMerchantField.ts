import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { NO_DEFAULT_CATEGORY_VALUE } from '@/components/reference-modals/createMerchantConstants'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { ApiError } from '@/api/auth'
import type { Category } from '@/api/categories'
import { useInfiniteMerchants, useMerchant, useUpdateMerchant, type Merchant } from '@/api/merchants'
import {
  MERCHANT_DROPDOWN_PAGE_SIZE,
  MERCHANT_FETCHING_MORE_TEXT_MIN_MS,
  MERCHANT_SEARCH_DEBOUNCE_MS,
  MERCHANT_SEARCH_LOADING_TEXT_MIN_MS,
} from '@/pages/transactions/components/transaction-modal/constants'
import { buildCategoryOptions } from '@/pages/transactions/components/transaction-modal/utils/categories'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordOtherAccount } from '@/utils/transfers'
import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'
import { useDebouncedReferenceSearch } from './useDebouncedReferenceSearch'
import { usePagedReferenceDropdown } from './usePagedReferenceDropdown'

interface UseMerchantFieldOptions {
  open: boolean
  categoryById: Map<string, Category>
  categoryOptions: ReturnType<typeof buildCategoryOptions>
  selectedCategory: Category | undefined
  form: TransactionFormValues
  setForm: Dispatch<SetStateAction<TransactionFormValues>>
  applyKindChange: (nextKind: TransactionModalKind, fields?: Partial<TransactionFormValues>) => void
  clearError: (field: keyof TransactionFormFieldErrors) => void
  readOnly: boolean
  setSubmitError: Dispatch<SetStateAction<string>>
  setSubmitErrorTitle: Dispatch<SetStateAction<string>>
  closeModal: () => void
}

interface MerchantFieldState {
  merchantOptions: { value: string; label: string }[]
  selectedMerchant: Merchant | undefined
  selectedMerchantOption: { value: string; label: string } | undefined
  merchantDefaultCategoryOptions: DropdownOption[]
  showMerchantDefaultCategoryAction: boolean
  merchantDefaultCategoryActionLabel: string
  merchantDefaultCategoryPending: boolean
  search: string
  setSearch: (value: string) => void
  setActiveSearch: (value: string) => void
  showLoading: boolean
  loadingText: string
  showInitialLoading: boolean
  hasMore: boolean
  loadMore: () => void
  handleMerchantChange: (merchantId: string) => void
  handleMerchantCreated: (merchant: Merchant) => void
  handleMakeMerchantDefaultCategory: () => void
}

/**
 * Owns merchant search, pagination, selection, the merchant-driven default category patch, and
 * inline merchant creation, including the "make this the default category" action on the
 * selected merchant
 */
export function useMerchantField({
  open,
  categoryById,
  categoryOptions,
  selectedCategory,
  form,
  setForm,
  applyKindChange,
  clearError,
  readOnly,
  setSubmitError,
  setSubmitErrorTitle,
  closeModal,
}: UseMerchantFieldOptions): MerchantFieldState {
  const [createdMerchant, setCreatedMerchant] = useState<Merchant | null>(null)
  const updateMerchantMutation = useUpdateMerchant()

  const merchantReferenceSearch = useDebouncedReferenceSearch(MERCHANT_SEARCH_DEBOUNCE_MS)
  const merchantQuery = useInfiniteMerchants(
    { q: merchantReferenceSearch.activeSearchText || undefined },
    MERCHANT_DROPDOWN_PAGE_SIZE,
    open,
  )
  const merchantReference = usePagedReferenceDropdown({
    query: merchantQuery,
    activeSearchText: merchantReferenceSearch.activeSearchText,
    searchLoadingMinMs: MERCHANT_SEARCH_LOADING_TEXT_MIN_MS,
    fetchingMoreMinMs: MERCHANT_FETCHING_MORE_TEXT_MIN_MS,
    idleLoadingText: 'Loading merchants...',
  })
  const selectedMerchantId = form.merchant_id || null
  const { data: fetchedSelectedMerchant } = useMerchant(selectedMerchantId, open && !!selectedMerchantId)

  const merchantCandidates = useMemo(() => {
    const map = new Map<string, Merchant>()
    merchantReference.visibleItems.forEach((merchant) => map.set(merchant.id, merchant))
    if (createdMerchant) map.set(createdMerchant.id, createdMerchant)
    return [...map.values()]
  }, [createdMerchant, merchantReference.visibleItems])

  // The backend already ranks merchants by recent usage then name, so preserve that order
  // here instead of re-sorting and place any just-created merchant at the end
  const merchantOptions = useMemo(
    () => merchantCandidates.map((m) => ({ value: m.id, label: m.name })),
    [merchantCandidates],
  )

  const selectedMerchant = createdMerchant?.id === selectedMerchantId ? createdMerchant : fetchedSelectedMerchant
  const selectedMerchantOption = selectedMerchant
    ? { value: selectedMerchant.id, label: selectedMerchant.name }
    : undefined

  const merchantDefaultCategoryOptions = useMemo(
    () => [
      { value: NO_DEFAULT_CATEGORY_VALUE, label: 'No default category', group: 'Default' },
      ...categoryOptions,
    ],
    [categoryOptions],
  )

  // A system merchant is shared by everyone, and its default category would be too, so it is not
  // offered one rather than letting one person's choice change what auto-fills for the rest
  const showMerchantDefaultCategoryAction = !!(
    selectedMerchant &&
    !selectedMerchant.is_system &&
    selectedCategory &&
    selectedMerchant.default_category_id !== selectedCategory.id
  )
  const merchantDefaultCategoryActionLabel = showMerchantDefaultCategoryAction
    ? `Make "${selectedCategory.name}" the default category`
    : ''

  // Shared by direct selection and inline creation, both of which apply the merchant's default
  // category. A merchant without one only patches merchant_id, omitting kind and direction from
  // the change entirely rather than routing them through applyKindChange as a same-value no-op
  const applyMerchantSelection = (merchant: Merchant | undefined, merchantId: string) => {
    const defaultCategoryId = merchant?.default_category_id
    if (!defaultCategoryId) {
      setForm((f) => ({ ...f, merchant_id: merchantId }))
      clearError('merchant_id')
      return
    }

    const defaultCategory = categoryById.get(defaultCategoryId)
    const nextKind = (defaultCategory?.kind as TransactionModalKind | undefined) ?? form.kind
    const nextIsBalanceAdjustment = !!(
      defaultCategory?.is_system && defaultCategory.name === BALANCE_ADJUSTMENT_CATEGORY_NAME
    )
    // Balance Adjustment has no other side, so a pending other-account answer or a symmetric pair
    // set up under a real transfer category no longer applies once the default category lands on it
    applyKindChange(nextKind, {
      merchant_id: merchantId,
      category_id: defaultCategoryId,
      ...(doesTransferRecordOtherAccount(nextKind, nextIsBalanceAdjustment)
        ? {}
        : { other_account_id: '', symmetric_transfer: false }),
    })
    clearError('merchant_id')
    clearError('category_id')
  }

  const handleMerchantChange = (merchantId: string) => {
    const merchant = merchantCandidates.find((m) => m.id === merchantId)
    applyMerchantSelection(merchant, merchantId)
  }

  const handleMerchantCreated = (merchant: Merchant) => {
    setCreatedMerchant(merchant)
    applyMerchantSelection(merchant, merchant.id)
    closeModal()
  }

  const handleMakeMerchantDefaultCategory = () => {
    if (readOnly || !selectedMerchant || !selectedCategory || updateMerchantMutation.isPending) return

    setSubmitError('')
    setSubmitErrorTitle('')
    updateMerchantMutation.mutate(
      {
        merchantId: selectedMerchant.id,
        payload: { default_category_id: selectedCategory.id },
      },
      {
        onSuccess: (merchant) => {
          if (createdMerchant?.id === merchant.id) setCreatedMerchant(merchant)
        },
        onError: (err) => {
          setSubmitError(err instanceof ApiError ? err.message : 'Could not update merchant default category.')
        },
      },
    )
  }

  return {
    merchantOptions,
    selectedMerchant,
    selectedMerchantOption,
    merchantDefaultCategoryOptions,
    showMerchantDefaultCategoryAction,
    merchantDefaultCategoryActionLabel,
    merchantDefaultCategoryPending: updateMerchantMutation.isPending,
    search: merchantReferenceSearch.search,
    setSearch: merchantReferenceSearch.setSearch,
    setActiveSearch: merchantReferenceSearch.setActiveSearch,
    showLoading: merchantReference.showLoading,
    loadingText: merchantReference.loadingText,
    showInitialLoading: merchantReference.showInitialLoading,
    hasMore: !!merchantQuery.hasNextPage,
    loadMore: merchantReference.loadMore,
    handleMerchantChange,
    handleMerchantCreated,
    handleMakeMerchantDefaultCategory,
  }
}
