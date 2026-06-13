import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NO_DEFAULT_CATEGORY_VALUE } from '@/components/CreateMerchantModal'
import { useAccounts } from '@/api/accounts'
import { useCategories, type Category } from '@/api/categories'
import { useInfiniteMerchants, useMerchant, useUpdateMerchant, type Merchant } from '@/api/merchants'
import { useInfiniteTags, type Tag } from '@/api/tags'
import { useCurrencies } from '@/api/currency'
import { invalidateTransactionAccountData } from '@/api/cache/updates/transactions'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from '@/api/transactions'
import { ApiError } from '@/api/auth'
import { sanitizeMoneyInput } from '@/utils/moneyInput'
import {
  INITIAL_TRANSACTION_FORM,
  KIND_LABELS,
  MERCHANT_DROPDOWN_PAGE_SIZE,
  MERCHANT_FETCHING_MORE_TEXT_MIN_MS,
  MERCHANT_SEARCH_DEBOUNCE_MS,
  MERCHANT_SEARCH_LOADING_TEXT_MIN_MS,
  MIN_ADD_TRANSACTION_LOADING_MS,
  MIN_BATCH_ADD_TRANSACTION_LOADING_MS,
  MIN_DELETE_TRANSACTION_LOADING_MS,
  TAG_DROPDOWN_PAGE_SIZE,
  TAG_FETCHING_MORE_TEXT_MIN_MS,
  TAG_SEARCH_DEBOUNCE_MS,
  TAG_SEARCH_LOADING_TEXT_MIN_MS,
} from '@/transactions/components/TransactionModal/transactionModalConstants'
import {
  buildCategoryOptions,
  getDefaultDirectionForKind,
} from '@/transactions/components/TransactionModal/transactionModalCategories'
import { buildInitialTransactionForm } from '@/transactions/components/TransactionModal/transactionModalInitialForm'
import { getDirectionFromAmountInputSign } from '@/transactions/components/TransactionModal/transactionModalMoney'
import {
  buildCreateTransactionPayload,
  buildUpdateTransactionPatch,
} from '@/transactions/components/TransactionModal/transactionModalPayloads'
import type {
  CreateTransactionModalProps,
  TransactionFormFieldErrors,
  TransactionFormValues,
  TransactionModalKind,
} from '@/transactions/components/TransactionModal/transactionModalTypes'
import { validateTransactionForm } from '@/transactions/components/TransactionModal/transactionModalValidation'
import TransactionDetailsSection from '@/transactions/components/TransactionModal/TransactionDetailsSection'
import TransactionModalFooter from '@/transactions/components/TransactionModal/TransactionModalFooter'
import TransactionModalShell from '@/transactions/components/TransactionModal/TransactionModalShell'
import TransactionModalSubmitError from '@/transactions/components/TransactionModal/TransactionModalSubmitError'
import TransactionReferenceCreationModals from '@/transactions/components/TransactionModal/TransactionReferenceCreationModals'
import TransactionReferencesSection from '@/transactions/components/TransactionModal/TransactionReferencesSection'
import TransactionTypeDirectionSection from '@/transactions/components/TransactionModal/TransactionTypeDirectionSection'
import { useDebouncedReferenceSearch } from '@/transactions/components/TransactionModal/hooks/useDebouncedReferenceSearch'
import { usePagedReferenceDropdown } from '@/transactions/components/TransactionModal/hooks/usePagedReferenceDropdown'
import { useTransactionModalEnvironment } from '@/transactions/components/TransactionModal/hooks/useTransactionModalEnvironment'

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export default function CreateTransactionModal({
  open,
  onClose,
  transaction,
  defaultAccountId,
  defaultCurrency,
}: CreateTransactionModalProps) {
  const editing = !!transaction
  const queryClient = useQueryClient()
  const createMutation = useCreateTransaction({ deferAccountInvalidation: true })
  const updateMutation = useUpdateTransaction()
  const updateMerchantMutation = useUpdateMerchant()
  const deleteMutation = useDeleteTransaction({ minimumPendingMs: MIN_DELETE_TRANSACTION_LOADING_MS })
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const { data: currencies = [] } = useCurrencies()
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => !account.is_archived),
    [accounts],
  )

  // Build the initial form from the existing transaction (edit) or sensible defaults (create).
  const initialForm = useMemo<TransactionFormValues>(() => {
    return buildInitialTransactionForm({
      transaction,
      categories,
      currencies,
      selectableAccounts,
      defaultAccountId,
      defaultCurrency,
    })
  }, [transaction, categories, currencies, defaultAccountId, defaultCurrency, selectableAccounts])

  const [form, setForm] = useState(initialForm)
  const [fieldErrors, setFieldErrors] = useState<TransactionFormFieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitError, setSubmitError] = useState('')
  const [categoryModalName, setCategoryModalName] = useState('')
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [categoryModalKey, setCategoryModalKey] = useState(0)
  const [merchantModalName, setMerchantModalName] = useState('')
  const [createdMerchant, setCreatedMerchant] = useState<Merchant | null>(null)
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const [tagModalName, setTagModalName] = useState('')
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagModalKey, setTagModalKey] = useState(0)
  const [showMerchantModal, setShowMerchantModal] = useState(false)
  const [merchantModalKey, setMerchantModalKey] = useState(0)
  const [keepOpenAfterCreate, setKeepOpenAfterCreate] = useState(false)
  const [sessionAccountDeltas, setSessionAccountDeltas] = useState<Record<string, number>>({})
  const [createDelayPending, setCreateDelayPending] = useState(false)
  const [directionHighlightKey, setDirectionHighlightKey] = useState(0)
  const merchantReferenceSearch = useDebouncedReferenceSearch(MERCHANT_SEARCH_DEBOUNCE_MS)
  const tagReferenceSearch = useDebouncedReferenceSearch(TAG_SEARCH_DEBOUNCE_MS)
  const createdAccountIdsRef = useRef<Set<string>>(new Set())
  const openRef = useRef(open)

  const flushDeferredAccountInvalidation = useCallback(() => {
    const accountIds = [...createdAccountIdsRef.current]
    if (accountIds.length === 0) return

    createdAccountIdsRef.current.clear()
    invalidateTransactionAccountData(queryClient, accountIds, { refetchAccountList: true })
  }, [queryClient])

  const handleClose = useCallback(() => {
    onClose()
    window.setTimeout(flushDeferredAccountInvalidation, 0)
  }, [flushDeferredAccountInvalidation, onClose])

  useEffect(() => {
    openRef.current = open
    if (open) return
    flushDeferredAccountInvalidation()
  }, [flushDeferredAccountInvalidation, open])

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === form.account_id),
    [accounts, form.account_id],
  )
  const merchantQuery = useInfiniteMerchants(
    { q: merchantReferenceSearch.activeSearchText || undefined },
    MERCHANT_DROPDOWN_PAGE_SIZE,
    open,
  )
  const tagQuery = useInfiniteTags(
    {
      group_id: selectedAccount?.group_id ?? undefined,
      q: tagReferenceSearch.activeSearchText || undefined,
    },
    TAG_DROPDOWN_PAGE_SIZE,
    open && !!form.account_id,
  )
  const merchantReference = usePagedReferenceDropdown({
    query: merchantQuery,
    activeSearchText: merchantReferenceSearch.activeSearchText,
    searchLoadingMinMs: MERCHANT_SEARCH_LOADING_TEXT_MIN_MS,
    fetchingMoreMinMs: MERCHANT_FETCHING_MORE_TEXT_MIN_MS,
    idleLoadingText: 'Loading merchants...',
  })
  const tagReference = usePagedReferenceDropdown({
    query: tagQuery,
    activeSearchText: tagReferenceSearch.activeSearchText,
    searchLoadingMinMs: TAG_SEARCH_LOADING_TEXT_MIN_MS,
    fetchingMoreMinMs: TAG_FETCHING_MORE_TEXT_MIN_MS,
    idleLoadingText: 'Loading tags...',
  })
  const selectedMerchantId = form.merchant_id || null
  const { data: fetchedSelectedMerchant } = useMerchant(selectedMerchantId, open && !!selectedMerchantId)
  const selectedMerchant = createdMerchant?.id === selectedMerchantId ? createdMerchant : fetchedSelectedMerchant
  const deleteLoading = deleteMutation.isPending

  const createLoading = createMutation.isPending || createDelayPending
  const submitLoading = editing ? updateMutation.isPending : createLoading
  const isPending = createLoading || updateMutation.isPending || deleteLoading

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>()
    categories.forEach((c) => map.set(c.id, c))
    return map
  }, [categories])

  const accountOptions = useMemo(
    () => selectableAccounts.map((account) => ({ value: account.id, label: account.name })),
    [selectableAccounts],
  )
  const selectedArchivedAccountOption = editing && selectedAccount?.is_archived
    ? { value: selectedAccount.id, label: selectedAccount.name }
    : undefined
  const categoryOptions = useMemo(
    () => buildCategoryOptions(categories, form.kind),
    [categories, form.kind],
  )
  const merchantDefaultCategoryOptions = useMemo(
    () => [
      { value: NO_DEFAULT_CATEGORY_VALUE, label: 'No default category', group: 'Default' },
      ...categoryOptions,
    ],
    [categoryOptions],
  )
  const merchantCandidates = useMemo(() => {
    const map = new Map<string, Merchant>()
    merchantReference.visibleItems.forEach((merchant) => map.set(merchant.id, merchant))
    if (createdMerchant) map.set(createdMerchant.id, createdMerchant)
    return [...map.values()]
  }, [createdMerchant, merchantReference.visibleItems])
  const merchantOptions = useMemo(
    () => merchantCandidates
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ value: m.id, label: m.name })),
    [merchantCandidates],
  )
  const selectedTagMap = useMemo(() => {
    const map = new Map<string, Pick<Tag, 'id' | 'group_id' | 'name'>>()
    transaction?.tags?.forEach((tag) => map.set(tag.id, tag))
    tagReference.fetchedItems.forEach((tag) => map.set(tag.id, tag))
    tagReference.visibleItems.forEach((tag) => map.set(tag.id, tag))
    createdTags.forEach((tag) => map.set(tag.id, tag))
    return map
  }, [createdTags, tagReference.fetchedItems, tagReference.visibleItems, transaction?.tags])
  const selectedTagIds = form.tag_ids
  const tagCandidates = useMemo(() => {
    const map = new Map<string, Tag>()
    tagReference.visibleItems.forEach((tag) => map.set(tag.id, tag))
    createdTags.forEach((tag) => map.set(tag.id, tag))
    return [...map.values()]
  }, [createdTags, tagReference.visibleItems])
  const tagOptions = useMemo(
    () => tagCandidates
      .filter((tag) => !selectedTagIds.includes(tag.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => ({ value: tag.id, label: tag.name })),
    [selectedTagIds, tagCandidates],
  )
  const selectedTags = useMemo(
    () => selectedTagIds
      .map((tagId) => selectedTagMap.get(tagId))
      .filter((tag): tag is Pick<Tag, 'id' | 'group_id' | 'name'> => !!tag),
    [selectedTagIds, selectedTagMap],
  )
  const selectedMerchantOption = selectedMerchant
    ? { value: selectedMerchant.id, label: selectedMerchant.name }
    : undefined
  const selectedCategory = form.category_id ? categoryById.get(form.category_id) : undefined
  const showMerchantDefaultCategoryAction = !!(
    selectedMerchant &&
    selectedCategory &&
    selectedMerchant.default_category_id !== selectedCategory.id
  )
  const merchantDefaultCategoryActionLabel = showMerchantDefaultCategoryAction
    ? `Make "${selectedCategory.name}" the default category`
    : ''
  const currencyOptions = useMemo(
    () => {
      const options = currencies.map((c) => ({ value: c.id, label: c.id }))
      if (form.currency && !options.some((option) => option.value === form.currency)) {
        return [{ value: form.currency, label: form.currency }, ...options]
      }
      return options
    },
    [currencies, form.currency],
  )

  const selectedCurrency = currencies.find((c) => c.id === form.currency)
  const selectedCurrencySymbol = selectedCurrency?.symbol ?? ''
  const selectedCurrencyExponent = selectedCurrency?.minor_unit_exponent ?? 2
  const selectedAccountSessionDelta = selectedAccount ? (sessionAccountDeltas[selectedAccount.id] ?? 0) : 0
  const showRunningBalance = !editing && keepOpenAfterCreate && !!selectedAccount
  const runningBalance = selectedAccount
    ? selectedAccount.current_balance + selectedAccountSessionDelta
    : 0

  useTransactionModalEnvironment({ open, onClose: handleClose })

  const clearError = (field: keyof TransactionFormFieldErrors) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
    setSubmitError('')
  }

  const handleKindChange = (kind: TransactionModalKind) => {
    const kindChanged = kind !== form.kind
    setForm((f) => ({
      ...f,
      kind,
      direction: kind === f.kind ? f.direction : getDefaultDirectionForKind(kind),
    }))
    if (kindChanged) setDirectionHighlightKey((key) => key + 1)
  }

  const handleCategoryChange = (categoryId: string) => {
    const category = categoryById.get(categoryId)
    const nextKind = (category?.kind as TransactionModalKind | undefined) ?? form.kind
    const kindChanged = nextKind !== form.kind
    setForm((f) => ({
      ...f,
      category_id: categoryId,
      // Auto-switch the kind toggle to match the chosen category
      kind: nextKind,
      direction: nextKind === f.kind ? f.direction : getDefaultDirectionForKind(nextKind),
    }))
    if (kindChanged) setDirectionHighlightKey((key) => key + 1)
    clearError('category_id')
  }

  const handleCreateCategory = (name: string) => {
    setCategoryModalName(name)
    setCategoryModalKey((key) => key + 1)
    setShowCategoryModal(true)
  }

  const handleCategoryCreated = (category: Category) => {
    const nextKind = category.kind as TransactionModalKind
    const kindChanged = nextKind !== form.kind
    setForm((f) => ({
      ...f,
      category_id: category.id,
      kind: nextKind,
      direction: nextKind === f.kind ? f.direction : getDefaultDirectionForKind(nextKind),
    }))
    if (kindChanged) setDirectionHighlightKey((key) => key + 1)
    clearError('category_id')
    setShowCategoryModal(false)
  }

  const handleMakeMerchantDefaultCategory = () => {
    if (!selectedMerchant || !selectedCategory || updateMerchantMutation.isPending) return

    setSubmitError('')
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

  const handleMerchantChange = (merchantId: string) => {
    const merchant = merchantCandidates.find((m) => m.id === merchantId)
    const defaultCategoryId = merchant?.default_category_id
    const defaultCategory = defaultCategoryId ? categoryById.get(defaultCategoryId) : undefined
    const nextKind = (defaultCategory?.kind as TransactionModalKind | undefined) ?? form.kind
    const kindChanged = !!defaultCategoryId && nextKind !== form.kind
    setForm((f) => ({
      ...f,
      merchant_id: merchantId,
      ...(defaultCategoryId
        ? {
            category_id: defaultCategoryId,
            kind: nextKind,
            direction: nextKind === f.kind ? f.direction : getDefaultDirectionForKind(nextKind),
          }
        : {}),
    }))
    if (kindChanged) setDirectionHighlightKey((key) => key + 1)
    clearError('merchant_id')
    if (defaultCategoryId) clearError('category_id')
  }

  const handleCreateMerchant = (name: string) => {
    setMerchantModalName(name)
    setMerchantModalKey((key) => key + 1)
    setShowMerchantModal(true)
  }

  const handleMerchantCreated = (merchant: Merchant) => {
    setCreatedMerchant(merchant)
    const defaultCategoryId = merchant.default_category_id
    const defaultCategory = defaultCategoryId ? categoryById.get(defaultCategoryId) : undefined
    const nextKind = (defaultCategory?.kind as TransactionModalKind | undefined) ?? form.kind
    const kindChanged = !!defaultCategoryId && nextKind !== form.kind
    setForm((f) => ({
      ...f,
      merchant_id: merchant.id,
      ...(defaultCategoryId
        ? {
            category_id: defaultCategoryId,
            kind: nextKind,
            direction: nextKind === f.kind ? f.direction : getDefaultDirectionForKind(nextKind),
          }
        : {}),
    }))
    if (kindChanged) setDirectionHighlightKey((key) => key + 1)
    clearError('merchant_id')
    if (defaultCategoryId) clearError('category_id')
    setShowMerchantModal(false)
  }

  const handleTagChange = (tagId: string) => {
    setForm((f) => {
      if (f.tag_ids.includes(tagId)) return f
      return { ...f, tag_ids: [...f.tag_ids, tagId] }
    })
  }

  const handleRemoveTag = (tagId: string) => {
    setForm((f) => ({ ...f, tag_ids: f.tag_ids.filter((id) => id !== tagId) }))
  }

  const handleCreateTag = (name: string) => {
    setTagModalName(name)
    setTagModalKey((key) => key + 1)
    setShowTagModal(true)
  }

  const handleTagCreated = (tag: Tag) => {
    setCreatedTags((tags) => [...tags.filter((item) => item.id !== tag.id), tag])
    setForm((f) => (
      f.tag_ids.includes(tag.id) ? f : { ...f, tag_ids: [...f.tag_ids, tag.id] }
    ))
    tagReferenceSearch.clearSearch()
    setShowTagModal(false)
  }

  const handleAccountChange = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId)
    const accountGroupId = account?.group_id ?? null
    setForm((f) => ({
      ...f,
      account_id: accountId,
      currency: account?.currency || '',
      tag_ids: f.tag_ids.filter((tagId) => {
        const tag = selectedTagMap.get(tagId)
        return !tag || tag.group_id === null || tag.group_id === accountGroupId
      }),
    }))
    clearError('account_id')
    clearError('currency')
  }

  const handleField = <K extends keyof TransactionFormValues>(field: K, value: TransactionFormValues[K]) => {
    setForm((f) => ({ ...f, [field]: value }))
    if (field in fieldErrors) clearError(field as keyof TransactionFormFieldErrors)
  }

  const handleAmountChange = (value: string) => {
    const signDirection = getDirectionFromAmountInputSign(value)
    setForm((f) => ({
      ...f,
      amount: sanitizeMoneyInput(value),
      direction: signDirection ?? f.direction,
    }))
    if (signDirection && signDirection !== form.direction) setDirectionHighlightKey((key) => key + 1)
    if ('amount' in fieldErrors) clearError('amount')
  }

  const handleBlur = (field: keyof TransactionFormFieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }))
    const errors = validateTransactionForm(form)
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    const errors = validateTransactionForm(form)
    setFieldErrors(errors)
    setTouched({ account_id: true, category_id: true, merchant_id: true, amount: true, currency: true, date: true })
    if (Object.keys(errors).length > 0) return

    if (editing && transaction) {
      const patch = buildUpdateTransactionPatch(form, transaction, selectedCurrencyExponent)

      if (!patch) {
        handleClose()
        return
      }

      updateMutation.mutate(
        { id: transaction.id, patch },
        {
          onSuccess: () => handleClose(),
          onError: (err) => {
            setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
          },
        },
      )
      return
    }

    const payload = buildCreateTransactionPayload(form, selectedCurrencyExponent)

    setSubmitError('')
    setCreateDelayPending(true)
    const minimumLoading = delay(
      keepOpenAfterCreate ? MIN_BATCH_ADD_TRANSACTION_LOADING_MS : MIN_ADD_TRANSACTION_LOADING_MS,
    )

    try {
      const createdTransaction = await createMutation.mutateAsync(payload)
      createdAccountIdsRef.current.add(createdTransaction.account_id)
      setSessionAccountDeltas((deltas) => ({
        ...deltas,
        [createdTransaction.account_id]: (deltas[createdTransaction.account_id] ?? 0) + createdTransaction.amount,
      }))
      if (!openRef.current) {
        flushDeferredAccountInvalidation()
        return
      }
      await minimumLoading

      if (!keepOpenAfterCreate) {
        handleClose()
        return
      }

      setForm({
        ...INITIAL_TRANSACTION_FORM,
        kind: form.kind,
        direction: form.direction,
        account_id: form.account_id,
        category_id: form.category_id,
        merchant_id: form.merchant_id,
        currency: form.currency,
        date: form.date,
      })
      setFieldErrors({})
      setTouched({})
      setSubmitError('')
    } catch (err) {
      await minimumLoading
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setCreateDelayPending(false)
    }
  }

  const handleDelete = async () => {
    if (!transaction) return false

    setSubmitError('')

    try {
      await deleteMutation.mutateAsync(transaction.id)
      handleClose()
      return true
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not delete transaction.')
      return false
    }
  }

  const showError = (field: keyof TransactionFormFieldErrors) => touched[field] && fieldErrors[field]

  return (
    <>
      <TransactionModalShell
        open={open}
        editing={editing}
        transactionKindLabel={KIND_LABELS[form.kind]}
        onClose={handleClose}
        onSubmit={handleSubmit}
        footer={(
          <TransactionModalFooter
            editing={editing}
            isPending={isPending}
            submitLoading={submitLoading}
            deleteLoading={deleteLoading}
            keepOpenAfterCreate={keepOpenAfterCreate}
            onKeepOpenAfterCreateChange={setKeepOpenAfterCreate}
            onCancel={handleClose}
            onDelete={handleDelete}
          />
        )}
      >
        <div className="space-y-5">
          <TransactionTypeDirectionSection
            kind={form.kind}
            direction={form.direction}
            editing={editing}
            directionHighlightKey={directionHighlightKey}
            onKindChange={handleKindChange}
            onDirectionChange={(value) => handleField('direction', value)}
          />

          <TransactionReferencesSection
            accountOptions={accountOptions}
            selectedArchivedAccountOption={selectedArchivedAccountOption}
            accountValue={form.account_id}
            accountError={showError('account_id')}
            accountPlaceholder={accounts.length === 0 ? 'No accounts yet' : 'Select account...'}
            runningBalance={showRunningBalance && selectedAccount
              ? { amount: runningBalance, currency: selectedAccount.currency }
              : undefined}
            merchantOptions={merchantOptions}
            selectedMerchantOption={selectedMerchantOption}
            merchantValue={form.merchant_id}
            merchantError={showError('merchant_id')}
            merchantSearch={merchantReferenceSearch.search}
            merchantLoading={merchantReference.showLoading}
            merchantLoadingText={merchantReference.loadingText}
            merchantHideOptionsWhileLoading={merchantReference.showInitialLoading}
            merchantHasMore={!!merchantQuery.hasNextPage}
            categoryOptions={categoryOptions}
            categoryValue={form.category_id}
            categoryError={showError('category_id')}
            showMerchantDefaultCategoryAction={showMerchantDefaultCategoryAction}
            merchantDefaultCategoryActionLabel={merchantDefaultCategoryActionLabel}
            merchantDefaultCategoryPending={updateMerchantMutation.isPending}
            tagOptions={tagOptions}
            tagsDisabled={!form.account_id}
            tagSearch={tagReferenceSearch.search}
            tagLoading={tagReference.showLoading}
            tagLoadingText={tagReference.loadingText}
            tagHideOptionsWhileLoading={tagReference.showInitialLoading}
            tagHasMore={!!tagQuery.hasNextPage}
            selectedTags={selectedTags}
            onAccountChange={handleAccountChange}
            onMerchantChange={handleMerchantChange}
            onMerchantSearchChange={merchantReferenceSearch.setSearch}
            onMerchantSearchCommit={merchantReferenceSearch.setActiveSearch}
            onMerchantLoadMore={merchantReference.loadMore}
            onCreateMerchant={handleCreateMerchant}
            onMakeMerchantDefaultCategory={handleMakeMerchantDefaultCategory}
            onCategoryChange={handleCategoryChange}
            onCreateCategory={handleCreateCategory}
            onTagChange={handleTagChange}
            onTagSearchChange={tagReferenceSearch.setSearch}
            onTagSearchCommit={tagReferenceSearch.setActiveSearch}
            onTagLoadMore={tagReference.loadMore}
            onCreateTag={handleCreateTag}
            onRemoveTag={handleRemoveTag}
          />

          <TransactionDetailsSection
            date={form.date}
            dateError={showError('date')}
            currencyOptions={currencyOptions}
            currencyValue={form.currency}
            currencyPlaceholder={currencies.length === 0 ? 'Loading...' : 'Select...'}
            selectedCurrencySymbol={selectedCurrencySymbol}
            amount={form.amount}
            amountError={showError('amount')}
            notes={form.notes}
            onDateChange={(value) => handleField('date', value)}
            onDateBlur={() => handleBlur('date')}
            onAmountChange={handleAmountChange}
            onAmountBlur={() => handleBlur('amount')}
            onNotesChange={(value) => handleField('notes', value)}
          />

          <TransactionModalSubmitError error={submitError} />
        </div>
      </TransactionModalShell>
      <TransactionReferenceCreationModals
        parentOpen={open}
        merchantModalKey={merchantModalKey}
        merchantOpen={showMerchantModal}
        merchantInitialName={merchantModalName}
        merchantCategoryOptions={merchantDefaultCategoryOptions}
        onCloseMerchant={() => setShowMerchantModal(false)}
        onMerchantCreated={handleMerchantCreated}
        categoryModalKey={categoryModalKey}
        categoryOpen={showCategoryModal}
        categoryInitialName={categoryModalName}
        categoryInitialKind={form.kind}
        onCloseCategory={() => setShowCategoryModal(false)}
        onCategoryCreated={handleCategoryCreated}
        tagModalKey={tagModalKey}
        tagOpen={showTagModal}
        tagInitialName={tagModalName}
        tagGroupId={selectedAccount?.group_id ?? null}
        onCloseTag={() => setShowTagModal(false)}
        onTagCreated={handleTagCreated}
      />
    </>
  )
}
