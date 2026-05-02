import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Check, Info, ReceiptText, Tag as TagIcon, Trash2, X } from 'lucide-react'
import CreateCategoryModal from '@/components/CreateCategoryModal'
import CreateMerchantModal, { NO_DEFAULT_CATEGORY_VALUE } from '@/components/CreateMerchantModal'
import CreateTagModal from '@/components/CreateTagModal'
import Dropdown from '@/components/Dropdown'
import { useAccounts } from '@/api/accounts'
import { useCategories, type Category } from '@/api/categories'
import { useInfiniteMerchants, useMerchant, type Merchant } from '@/api/merchants'
import { useInfiniteTags, type Tag } from '@/api/tags'
import { useCurrencies } from '@/api/currency'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
  type CreateTransactionPayload,
  type Transaction,
  type UpdateTransactionPayload,
} from '@/api/transactions'
import { ApiError } from '@/api/auth'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'

/* ── Constants ── */

const EASE = [0.25, 0.1, 0.25, 1] as const
const DEFAULT_CATEGORY_ICON = '🏷️'
const MIN_ADD_TRANSACTION_LOADING_MS = 800
const MIN_BATCH_ADD_TRANSACTION_LOADING_MS = 300
const MERCHANT_DROPDOWN_PAGE_SIZE = 10
const MERCHANT_SEARCH_LOADING_TEXT_MIN_MS = 300
const MERCHANT_SEARCH_DEBOUNCE_MS = 300
const MERCHANT_FETCHING_MORE_TEXT_MIN_MS = 800
const TAG_DROPDOWN_PAGE_SIZE = 10
const TAG_SEARCH_LOADING_TEXT_MIN_MS = 300
const TAG_SEARCH_DEBOUNCE_MS = 300
const TAG_FETCHING_MORE_TEXT_MIN_MS = 800

type Kind = 'expense' | 'income' | 'transfer'

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

// Transfers can go either way on a single account — pulling money out
// (e.g. paying a credit card from checking) or bringing it in (receiving a
// repayment, moving savings back). The sign on `amount` encodes this on the
// backend; the modal tracks it explicitly via `transfer_direction`.
type TransferDirection = 'in' | 'out'

const INITIAL_FORM = {
  kind: 'expense' as Kind,
  transfer_direction: 'out' as TransferDirection,
  account_id: '',
  category_id: '',
  merchant_id: '',
  amount: '',
  currency: '',
  notes: '',
  date: '',
  tag_ids: [] as string[],
}

const conditionalField = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.25, ease: EASE },
}

/* ── Helpers ── */

// date input expects "YYYY-MM-DD" in the user's local timezone.
function todayLocalString(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Convert minor units (signed) to a fixed-decimal positive string for the amount input.
function amountToInputString(amountMinor: number, exponent: number): string {
  return (Math.abs(amountMinor) / Math.pow(10, exponent)).toFixed(exponent)
}

function sanitizeMoneyInput(value: string) {
  let sanitized = value.replace(/[^\d.]/g, '')
  const parts = sanitized.split('.')
  if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`
  if (sanitized.startsWith('.')) sanitized = `0${sanitized}`
  return sanitized
}

function formatMoneyInputLive(value: string) {
  if (!value.trim()) return value
  const [integerPart, decimalPart] = value.split('.', 2)
  const formattedInteger = integerPart
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(integerPart))
    : '0'
  return value.includes('.') ? `${formattedInteger}.${decimalPart ?? ''}` : formattedInteger
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function FieldLabelRow({
  label,
  htmlFor,
  error,
}: {
  label: string
  htmlFor?: string
  error?: string | false
}) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">{label}</label>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            className="text-right text-xs font-medium leading-5"
            style={{ color: 'var(--app-negative)' }}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.15 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

const KIND_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

// Build options for a single kind. Categories are flat, so each kind maps
// to a single section labelled with its kind name.
function buildOptionsForKind(categories: Category[], kind: string) {
  const kindLabel = KIND_LABELS[kind] ?? kind
  return categories
    .filter((c) => c.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name, group: kindLabel, icon: c.icon ?? DEFAULT_CATEGORY_ICON }))
}

// Build the full category options list with the selected kind's options
// on top, followed by the other kinds in their natural order.
function buildCategoryOptions(categories: Category[], selectedKind: string) {
  const order = ['expense', 'income', 'transfer']
  const sorted = [selectedKind, ...order.filter((k) => k !== selectedKind)]
  return sorted.flatMap((kind) => buildOptionsForKind(categories, kind))
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

/* ── Validation ── */

interface FieldErrors {
  account_id?: string
  category_id?: string
  merchant_id?: string
  amount?: string
  currency?: string
  date?: string
}

function validate(form: typeof INITIAL_FORM): FieldErrors {
  const errors: FieldErrors = {}
  if (!form.account_id) errors.account_id = 'Select an account'
  if (!form.category_id) errors.category_id = 'Select a category'
  if (!form.merchant_id) errors.merchant_id = 'Select or create a merchant'
  if (!form.amount) errors.amount = 'Enter an amount'
  else {
    const n = parseFloat(form.amount)
    if (isNaN(n) || n <= 0) errors.amount = 'Amount must be greater than zero'
  }
  if (!form.currency) errors.currency = 'Select a currency'
  if (!form.date) errors.date = 'Select a date'
  return errors
}

/* ── Component ── */

interface CreateTransactionModalProps {
  open: boolean
  onClose: () => void
  /** When set, the modal opens in edit mode for this transaction. */
  transaction?: Transaction
  /** Pre-select this account in create mode (e.g., opened from an account page). */
  defaultAccountId?: string
  /** Pre-select this currency in create mode; typically matches the default account. */
  defaultCurrency?: string
}

export default function CreateTransactionModal({
  open,
  onClose,
  transaction,
  defaultAccountId,
  defaultCurrency,
}: CreateTransactionModalProps) {
  const editing = !!transaction
  const createMutation = useCreateTransaction()
  const updateMutation = useUpdateTransaction()
  const deleteMutation = useDeleteTransaction()
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const { data: currencies = [] } = useCurrencies()

  // Build the initial form from the existing transaction (edit) or sensible defaults (create).
  const initialForm = useMemo(() => {
    if (!transaction) {
      return {
        ...INITIAL_FORM,
        account_id: defaultAccountId ?? INITIAL_FORM.account_id,
        currency: defaultCurrency ?? INITIAL_FORM.currency,
        date: todayLocalString(),
      }
    }
    const category = categories.find((c) => c.id === transaction.category_id)
    const exp = currencies.find((c) => c.id === transaction.currency)?.minor_unit_exponent ?? 2
    return {
      kind: (category?.kind as Kind) ?? 'expense',
      // Recover direction from the stored sign so the toggle reflects reality.
      transfer_direction: (transaction.amount >= 0 ? 'in' : 'out') as TransferDirection,
      account_id: transaction.account_id,
      category_id: transaction.category_id,
      merchant_id: transaction.merchant_id ?? '',
      amount: amountToInputString(transaction.amount, exp),
      currency: transaction.currency,
      notes: transaction.notes ?? '',
      date: transaction.dt,
      tag_ids: transaction.tags?.map((tag) => tag.id) ?? transaction.tag_ids,
    }
  }, [transaction, categories, currencies, defaultAccountId, defaultCurrency])

  const [form, setForm] = useState(initialForm)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitError, setSubmitError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [categoryModalName, setCategoryModalName] = useState('')
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [categoryModalKey, setCategoryModalKey] = useState(0)
  const [merchantModalName, setMerchantModalName] = useState('')
  const [merchantSearch, setMerchantSearch] = useState('')
  const [activeMerchantSearch, setActiveMerchantSearch] = useState('')
  const [visiblePagedMerchants, setVisiblePagedMerchants] = useState<Merchant[]>([])
  const [createdMerchant, setCreatedMerchant] = useState<Merchant | null>(null)
  const [tagSearch, setTagSearch] = useState('')
  const [activeTagSearch, setActiveTagSearch] = useState('')
  const [visiblePagedTags, setVisiblePagedTags] = useState<Tag[]>([])
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const [tagModalName, setTagModalName] = useState('')
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagModalKey, setTagModalKey] = useState(0)
  const [showMerchantModal, setShowMerchantModal] = useState(false)
  const [merchantModalKey, setMerchantModalKey] = useState(0)
  const [keepOpenAfterCreate, setKeepOpenAfterCreate] = useState(false)
  const [createDelayPending, setCreateDelayPending] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const idleLabelRef = useRef<HTMLSpanElement>(null)
  const confirmLabelRef = useRef<HTMLSpanElement>(null)
  const visibleMerchantCountRef = useRef(0)
  const visibleTagCountRef = useRef(0)
  const merchantInitialFetchStartedAtRef = useRef<number | null>(null)
  const merchantFetchMoreStartedAtRef = useRef<number | null>(null)
  const tagInitialFetchStartedAtRef = useRef<number | null>(null)
  const tagFetchMoreStartedAtRef = useRef<number | null>(null)
  const [labelWidths, setLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === form.account_id),
    [accounts, form.account_id],
  )
  const merchantQuery = useInfiniteMerchants(
    { q: activeMerchantSearch.trim() || undefined },
    MERCHANT_DROPDOWN_PAGE_SIZE,
    open,
  )
  const tagQuery = useInfiniteTags(
    {
      group_id: selectedAccount?.group_id ?? undefined,
      q: activeTagSearch.trim() || undefined,
    },
    TAG_DROPDOWN_PAGE_SIZE,
    open && !!form.account_id,
  )
  const showFetchingMoreMerchants = useMinimumVisibleFlag(
    merchantQuery.isFetchingNextPage,
    MERCHANT_FETCHING_MORE_TEXT_MIN_MS,
  )
  const showInitialMerchantLoading = useMinimumVisibleFlag(
    merchantQuery.isLoading,
    MERCHANT_SEARCH_LOADING_TEXT_MIN_MS,
  )
  const showFetchingMoreTags = useMinimumVisibleFlag(
    tagQuery.isFetchingNextPage,
    TAG_FETCHING_MORE_TEXT_MIN_MS,
  )
  const showInitialTagLoading = useMinimumVisibleFlag(
    tagQuery.isLoading,
    TAG_SEARCH_LOADING_TEXT_MIN_MS,
  )
  const showMerchantLoading = showInitialMerchantLoading || showFetchingMoreMerchants
  const showTagLoading = showInitialTagLoading || showFetchingMoreTags
  const activeMerchantSearchText = activeMerchantSearch.trim()
  const activeTagSearchText = activeTagSearch.trim()
  const merchantLoadingText = showFetchingMoreMerchants
    ? 'Fetching more'
    : activeMerchantSearchText
      ? `Searching for ${activeMerchantSearchText}`
      : 'Loading merchants...'
  const tagLoadingText = showFetchingMoreTags
    ? 'Fetching more'
    : activeTagSearchText
      ? `Searching for ${activeTagSearchText}`
      : 'Loading tags...'
  const selectedMerchantId = form.merchant_id || null
  const { data: fetchedSelectedMerchant } = useMerchant(selectedMerchantId, open && !!selectedMerchantId)
  const fetchedMerchants = useMemo(() => merchantQuery.data?.pages.flat() ?? [], [merchantQuery.data])
  const fetchedTags = useMemo(() => tagQuery.data?.pages.flat() ?? [], [tagQuery.data])
  const fetchedMerchantKey = useMemo(
    () => fetchedMerchants.map((merchant) => merchant.id).join('|'),
    [fetchedMerchants],
  )
  const fetchedTagKey = useMemo(
    () => fetchedTags.map((tag) => tag.id).join('|'),
    [fetchedTags],
  )
  const visibleMerchantKey = useMemo(
    () => visiblePagedMerchants.map((merchant) => merchant.id).join('|'),
    [visiblePagedMerchants],
  )
  const visibleTagKey = useMemo(
    () => visiblePagedTags.map((tag) => tag.id).join('|'),
    [visiblePagedTags],
  )
  const selectedMerchant = createdMerchant?.id === selectedMerchantId ? createdMerchant : fetchedSelectedMerchant

  // Measure both label widths once after mount so we can drive a smooth width transition.
  useLayoutEffect(() => {
    if (!editing) return
    if (idleLabelRef.current && confirmLabelRef.current) {
      setLabelWidths({
        idle: idleLabelRef.current.offsetWidth,
        confirm: confirmLabelRef.current.offsetWidth,
      })
    }
  }, [editing])

  // Cancel pending deletion if the user clicks anywhere outside the Delete button.
  useEffect(() => {
    if (!confirmingDelete) return
    const onPointer = (e: PointerEvent) => {
      if (deleteButtonRef.current && !deleteButtonRef.current.contains(e.target as Node)) {
        setConfirmingDelete(false)
      }
    }
    // defer to next tick so the click that armed confirmation doesn't immediately undo it
    const t = setTimeout(() => window.addEventListener('pointerdown', onPointer), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [confirmingDelete])

  useEffect(() => {
    if (!merchantSearch.trim()) {
      setActiveMerchantSearch('')
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setActiveMerchantSearch(merchantSearch)
    }, MERCHANT_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [merchantSearch])

  useEffect(() => {
    if (!tagSearch.trim()) {
      setActiveTagSearch('')
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setActiveTagSearch(tagSearch)
    }, TAG_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [tagSearch])

  useEffect(() => {
    visibleMerchantCountRef.current = visiblePagedMerchants.length
  }, [visiblePagedMerchants.length])

  useEffect(() => {
    visibleTagCountRef.current = visiblePagedTags.length
  }, [visiblePagedTags.length])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!activeMerchantSearchText) {
        merchantInitialFetchStartedAtRef.current = null
        merchantFetchMoreStartedAtRef.current = null
        return
      }

      setVisiblePagedMerchants([])
      visibleMerchantCountRef.current = 0
      merchantInitialFetchStartedAtRef.current = performance.now()
      merchantFetchMoreStartedAtRef.current = null
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeMerchantSearchText])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!activeTagSearchText) {
        tagInitialFetchStartedAtRef.current = null
        tagFetchMoreStartedAtRef.current = null
        return
      }

      setVisiblePagedTags([])
      visibleTagCountRef.current = 0
      tagInitialFetchStartedAtRef.current = performance.now()
      tagFetchMoreStartedAtRef.current = null
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeTagSearchText])

  useLayoutEffect(() => {
    if (activeMerchantSearchText) return
    if (merchantQuery.isFetchingNextPage || merchantFetchMoreStartedAtRef.current !== null) return
    if (fetchedMerchantKey === visibleMerchantKey) return

    setVisiblePagedMerchants(fetchedMerchants)
    visibleMerchantCountRef.current = fetchedMerchants.length
    merchantInitialFetchStartedAtRef.current = null
  }, [
    activeMerchantSearchText,
    fetchedMerchantKey,
    fetchedMerchants,
    merchantQuery.isFetchingNextPage,
    visibleMerchantKey,
  ])

  useLayoutEffect(() => {
    if (activeTagSearchText) return
    if (tagQuery.isFetchingNextPage || tagFetchMoreStartedAtRef.current !== null) return
    if (fetchedTagKey === visibleTagKey) return

    setVisiblePagedTags(fetchedTags)
    visibleTagCountRef.current = fetchedTags.length
    tagInitialFetchStartedAtRef.current = null
  }, [
    activeTagSearchText,
    fetchedTagKey,
    fetchedTags,
    tagQuery.isFetchingNextPage,
    visibleTagKey,
  ])

  useEffect(() => {
    if (merchantQuery.isLoading) {
      merchantInitialFetchStartedAtRef.current = performance.now()
    }
  }, [merchantQuery.isLoading])

  useEffect(() => {
    if (tagQuery.isLoading) {
      tagInitialFetchStartedAtRef.current = performance.now()
    }
  }, [tagQuery.isLoading])

  useEffect(() => {
    if (merchantQuery.isFetchingNextPage) {
      merchantFetchMoreStartedAtRef.current = performance.now()
    }
  }, [merchantQuery.isFetchingNextPage])

  useEffect(() => {
    if (tagQuery.isFetchingNextPage) {
      tagFetchMoreStartedAtRef.current = performance.now()
    }
  }, [tagQuery.isFetchingNextPage])

  useEffect(() => {
    if (fetchedMerchantKey === visibleMerchantKey) return undefined

    const isAppendingPage = fetchedMerchants.length > visibleMerchantCountRef.current && visibleMerchantCountRef.current > 0
    const isInitialPage = fetchedMerchants.length > 0 && visibleMerchantCountRef.current === 0
    const fetchStartedAt = isAppendingPage
      ? merchantFetchMoreStartedAtRef.current
      : merchantInitialFetchStartedAtRef.current
    const minimumVisibleMs = isAppendingPage
      ? MERCHANT_FETCHING_MORE_TEXT_MIN_MS
      : MERCHANT_SEARCH_LOADING_TEXT_MIN_MS
    const elapsed = fetchStartedAt === null ? minimumVisibleMs : performance.now() - fetchStartedAt
    const delayMs = Math.max(minimumVisibleMs - elapsed, 0)
    const timeoutId = window.setTimeout(() => {
      setVisiblePagedMerchants(fetchedMerchants)
      if (isInitialPage) merchantInitialFetchStartedAtRef.current = null
      if (isAppendingPage) merchantFetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [fetchedMerchantKey, fetchedMerchants, visibleMerchantKey])

  useEffect(() => {
    if (fetchedTagKey === visibleTagKey) return undefined

    const isAppendingPage = fetchedTags.length > visibleTagCountRef.current && visibleTagCountRef.current > 0
    const isInitialPage = fetchedTags.length > 0 && visibleTagCountRef.current === 0
    const fetchStartedAt = isAppendingPage
      ? tagFetchMoreStartedAtRef.current
      : tagInitialFetchStartedAtRef.current
    const minimumVisibleMs = isAppendingPage
      ? TAG_FETCHING_MORE_TEXT_MIN_MS
      : TAG_SEARCH_LOADING_TEXT_MIN_MS
    const elapsed = fetchStartedAt === null ? minimumVisibleMs : performance.now() - fetchStartedAt
    const delayMs = Math.max(minimumVisibleMs - elapsed, 0)
    const timeoutId = window.setTimeout(() => {
      setVisiblePagedTags(fetchedTags)
      if (isInitialPage) tagInitialFetchStartedAtRef.current = null
      if (isAppendingPage) tagFetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [fetchedTagKey, fetchedTags, visibleTagKey])

  const createLoading = createMutation.isPending || createDelayPending
  const submitLoading = editing ? updateMutation.isPending : createLoading
  const isPending = createLoading || updateMutation.isPending || deleteMutation.isPending

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>()
    categories.forEach((c) => map.set(c.id, c))
    return map
  }, [categories])

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts],
  )
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
    visiblePagedMerchants.forEach((merchant) => map.set(merchant.id, merchant))
    if (createdMerchant) map.set(createdMerchant.id, createdMerchant)
    return [...map.values()]
  }, [createdMerchant, visiblePagedMerchants])
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
    fetchedTags.forEach((tag) => map.set(tag.id, tag))
    visiblePagedTags.forEach((tag) => map.set(tag.id, tag))
    createdTags.forEach((tag) => map.set(tag.id, tag))
    return map
  }, [createdTags, fetchedTags, transaction?.tags, visiblePagedTags])
  const selectedTagIds = form.tag_ids
  const tagCandidates = useMemo(() => {
    const map = new Map<string, Tag>()
    visiblePagedTags.forEach((tag) => map.set(tag.id, tag))
    createdTags.forEach((tag) => map.set(tag.id, tag))
    return [...map.values()]
  }, [createdTags, visiblePagedTags])
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

  const selectedCurrencySymbol = currencies.find((c) => c.id === form.currency)?.symbol ?? ''

  // Scroll lock + Escape close
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const clearError = (field: keyof FieldErrors) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
    setSubmitError('')
  }

  const handleKindChange = (kind: Kind) => {
    setForm((f) => ({ ...f, kind }))
  }

  const handleCategoryChange = (categoryId: string) => {
    const category = categoryById.get(categoryId)
    setForm((f) => ({
      ...f,
      category_id: categoryId,
      // Auto-switch the kind toggle to match the chosen category
      kind: (category?.kind as Kind) ?? f.kind,
    }))
    clearError('category_id')
  }

  const handleCreateCategory = (name: string) => {
    setCategoryModalName(name)
    setCategoryModalKey((key) => key + 1)
    setShowCategoryModal(true)
  }

  const handleCategoryCreated = (category: Category) => {
    setForm((f) => ({
      ...f,
      category_id: category.id,
      kind: category.kind as Kind,
    }))
    clearError('category_id')
    setShowCategoryModal(false)
  }

  const handleMerchantChange = (merchantId: string) => {
    const merchant = merchantCandidates.find((m) => m.id === merchantId)
    const defaultCategoryId = merchant?.default_category_id
    const defaultCategory = defaultCategoryId ? categoryById.get(defaultCategoryId) : undefined
    setForm((f) => ({
      ...f,
      merchant_id: merchantId,
      ...(defaultCategoryId
        ? {
            category_id: defaultCategoryId,
            kind: (defaultCategory?.kind as Kind) ?? f.kind,
          }
        : {}),
    }))
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
    setForm((f) => ({
      ...f,
      merchant_id: merchant.id,
      ...(defaultCategoryId
        ? {
            category_id: defaultCategoryId,
            kind: (defaultCategory?.kind as Kind) ?? f.kind,
          }
        : {}),
    }))
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
    setTagSearch('')
    setActiveTagSearch('')
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

  const handleField = <K extends keyof typeof INITIAL_FORM>(field: K, value: typeof INITIAL_FORM[K]) => {
    setForm((f) => ({ ...f, [field]: value }))
    if (field in fieldErrors) clearError(field as keyof FieldErrors)
  }

  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }))
    const errors = validate(form)
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    const errors = validate(form)
    setFieldErrors(errors)
    setTouched({ account_id: true, category_id: true, merchant_id: true, amount: true, currency: true, date: true })
    if (Object.keys(errors).length > 0) return

    const selectedCurrency = currencies.find((c) => c.id === form.currency)
    const minorMultiplier = Math.pow(10, selectedCurrency?.minor_unit_exponent ?? 2)
    const magnitude = Math.round(parseFloat(form.amount) * minorMultiplier)
    // Sign comes from kind + (for transfers) direction. Income is always +;
    // expense is always −; transfers depend on which way money moved.
    const isInflow =
      form.kind === 'income' || (form.kind === 'transfer' && form.transfer_direction === 'in')
    const signedAmount = isInflow ? magnitude : -magnitude
    const notes = form.notes.trim() || null

    if (editing && transaction) {
      // Build a minimal patch from fields that actually changed
      const patch: UpdateTransactionPayload = {}
      if (form.account_id !== transaction.account_id) patch.account_id = form.account_id
      if (form.category_id !== transaction.category_id) patch.category_id = form.category_id
      if (form.merchant_id !== (transaction.merchant_id ?? '')) patch.merchant_id = form.merchant_id || null
      if (signedAmount !== transaction.amount) patch.amount = signedAmount
      if (form.date !== initialForm.date) patch.dt = form.date
      if (notes !== (transaction.notes ?? null)) patch.notes = notes
      if (!sameStringSet(form.tag_ids, transaction.tag_ids)) patch.tag_ids = form.tag_ids

      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }

      updateMutation.mutate(
        { id: transaction.id, patch },
        {
          onSuccess: () => onClose(),
          onError: (err) => {
            setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
          },
        },
      )
      return
    }

    const payload: CreateTransactionPayload = {
      account_id: form.account_id,
      dt: form.date,
      category_id: form.category_id,
      merchant_id: form.merchant_id,
      amount: signedAmount,
      currency: form.currency,
      notes,
    }
    if (form.tag_ids.length > 0) payload.tag_ids = form.tag_ids

    setSubmitError('')
    setCreateDelayPending(true)
    const minimumLoading = delay(
      keepOpenAfterCreate ? MIN_BATCH_ADD_TRANSACTION_LOADING_MS : MIN_ADD_TRANSACTION_LOADING_MS,
    )

    try {
      await createMutation.mutateAsync(payload)
      await minimumLoading

      if (!keepOpenAfterCreate) {
        onClose()
        return
      }

      setForm({
        ...INITIAL_FORM,
        kind: form.kind,
        transfer_direction: form.transfer_direction,
        account_id: form.account_id,
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

  const handleDelete = () => {
    if (!transaction) return
    deleteMutation.mutate(transaction.id, {
      onSuccess: () => onClose(),
      onError: (err) => {
        setConfirmingDelete(false)
        setSubmitError(err instanceof ApiError ? err.message : 'Could not delete transaction.')
      },
    })
  }

  const showError = (field: keyof FieldErrors) => touched[field] && fieldErrors[field]

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              {/* Backdrop */}
              <motion.div
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
              />

              {/* Panel */}
              <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={onClose}
              >
                <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-txn-title"
              className="flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(e) => e.stopPropagation()}
                >
                  <div
                className="hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex"
                style={{
                  background: 'var(--app-button-primary-bg)',
                  color: 'var(--app-button-primary-text)',
                }}
                aria-hidden
                  >
                    <ReceiptText size={20} strokeWidth={2} />
                    <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
                      Transaction
                    </span>
                  </div>

                  {/* Form */}
                  <form onSubmit={handleSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                {/* Header */}
                <div
                  className="shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7"
                  style={{ borderBottom: '1px solid var(--app-border)' }}
                >
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p
                        className="mb-2 text-xs font-semibold uppercase"
                        style={{ color: 'var(--app-accent)' }}
                      >
                        {editing ? 'Existing transaction' : `${KIND_LABELS[form.kind]} transaction`}
                      </p>
                      <h2
                        id="create-txn-title"
                        className="font-serif text-3xl font-light"
                      >
                        {editing ? 'Edit Transaction' : 'Add Transaction'}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="app-icon-button shrink-0"
                      aria-label="Close"
                    >
                      <X size={20} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3 pt-4 sm:px-8">
                  <div className="space-y-5">
                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
                      <div className="flex min-h-0 flex-col items-center">
                        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                          01
                        </span>
                        <span
                          className="mt-1 w-px flex-1"
                          style={{ backgroundColor: 'var(--app-border-strong)' }}
                          aria-hidden
                        />
                      </div>

                      <div className="min-w-0 space-y-3">
                        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Type</p>

                        {/* Kind pills — locked in edit mode (kind is derived from the chosen category) */}
                        <div className="app-segmented-control w-full">
                          {KIND_OPTIONS.map((opt) => {
                            const selected = form.kind === opt.value
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => !editing && handleKindChange(opt.value)}
                                disabled={editing}
                                aria-disabled={editing}
                                className={`app-segmented-option flex-1 text-sm ${selected ? 'app-segmented-option-active' : ''} ${editing ? 'cursor-not-allowed' : ''} ${editing && !selected ? 'opacity-40' : ''}`}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>

                        {/* Transfer direction — only meaningful when the transaction
                            is a transfer. Stays editable in edit mode so a mis-signed
                            transfer can be corrected without deleting the row. */}
                        <AnimatePresence initial={false}>
                          {form.kind === 'transfer' && (
                            <motion.div
                              className="overflow-hidden"
                              {...conditionalField}
                            >
                              <div>
                                <label className="app-label mb-1.5 block text-[0.9375rem] leading-5">Direction</label>
                                <div className="app-segmented-control w-full">
                                  {([
                                    { value: 'out', label: 'Money Out' },
                                    { value: 'in', label: 'Money In' },
                                  ] as const).map((opt) => {
                                    const selected = form.transfer_direction === opt.value
                                    return (
                                      <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => handleField('transfer_direction', opt.value)}
                                        className={`app-segmented-option flex-1 text-sm ${selected ? 'app-segmented-option-active' : ''}`}
                                      >
                                        {opt.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Date */}
                        <div>
                          <FieldLabelRow htmlFor="txn-date" label="Date" error={showError('date')} />
                          <input
                            id="txn-date"
                            type="date"
                            className={`app-input ${showError('date') ? 'app-input-error' : ''}`}
                            value={form.date}
                            onChange={(e) => handleField('date', e.target.value)}
                            onBlur={() => handleBlur('date')}
                          />
                        </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
                      <div className="flex min-h-0 flex-col items-center">
                        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                          02
                        </span>
                        <span
                          className="mt-1 w-px flex-1"
                          style={{ backgroundColor: 'var(--app-border-strong)' }}
                          aria-hidden
                        />
                      </div>

                      <div className="min-w-0 space-y-3">
                        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Source/Destination</p>

                        {/* Account */}
                        <div>
                          <FieldLabelRow label="Account" error={showError('account_id')} />
                          <Dropdown
                            options={accountOptions}
                            value={form.account_id}
                            onChange={handleAccountChange}
                            className={`app-input ${showError('account_id') ? 'app-input-error' : ''}`}
                            placeholder={accounts.length === 0 ? 'No accounts yet' : 'Select account...'}
                            searchable
                            searchPlaceholder="Search accounts..."
                          />
                        </div>

                        {/* Merchant */}
                        <div>
                          <FieldLabelRow label="Merchant" error={showError('merchant_id')} />
                          <Dropdown
                            options={merchantOptions}
                            selectedOption={selectedMerchantOption}
                            value={form.merchant_id}
                            onChange={handleMerchantChange}
                            className={`app-input ${showError('merchant_id') ? 'app-input-error' : ''}`}
                            placeholder="Select or type to create..."
                            searchable
                            searchPlaceholder="Search merchants..."
                            searchValue={merchantSearch}
                            onSearchChange={setMerchantSearch}
                            onSearchCommit={setActiveMerchantSearch}
                            filterOptions={false}
                            isLoading={showMerchantLoading}
                            loadingText={merchantLoadingText}
                            loadingMinMs={0}
                            hideOptionsWhileLoading={showInitialMerchantLoading}
                            hasMore={!!merchantQuery.hasNextPage}
                            onLoadMore={() => {
                              if (
                                merchantQuery.hasNextPage &&
                                !merchantQuery.isFetchingNextPage &&
                                !showFetchingMoreMerchants
                              ) {
                                merchantQuery.fetchNextPage()
                              }
                            }}
                            onCreateNew={handleCreateMerchant}
                            createNewLabel={(query) => query ? `Create merchant "${query}"` : 'Create merchant'}
                          />
                        </div>

                        {/* Category */}
                        <div>
                          <FieldLabelRow label="Category" error={showError('category_id')} />
                          <Dropdown
                            options={categoryOptions}
                            value={form.category_id}
                            onChange={handleCategoryChange}
                            className={`app-input ${showError('category_id') ? 'app-input-error' : ''}`}
                            placeholder="Select category..."
                            searchable
                            searchPlaceholder="Search categories..."
                            onCreateNew={handleCreateCategory}
                            createNewLabel={(query) => query ? `Create category "${query}"` : 'Create category'}
                          />
                        </div>

                        {/* Tags */}
                        <div>
                          <FieldLabelRow label="Tags" />
                          <Dropdown
                            options={tagOptions}
                            value=""
                            onChange={handleTagChange}
                            className="app-input"
                            placeholder={form.account_id ? 'Add tags...' : 'Select account first'}
                            searchable
                            searchPlaceholder="Search tags..."
                            searchValue={tagSearch}
                            onSearchChange={setTagSearch}
                            onSearchCommit={setActiveTagSearch}
                            filterOptions={false}
                            isLoading={showTagLoading}
                            loadingText={tagLoadingText}
                            loadingMinMs={0}
                            hideOptionsWhileLoading={showInitialTagLoading}
                            hasMore={!!tagQuery.hasNextPage}
                            onLoadMore={() => {
                              if (
                                tagQuery.hasNextPage &&
                                !tagQuery.isFetchingNextPage &&
                                !showFetchingMoreTags
                              ) {
                                tagQuery.fetchNextPage()
                              }
                            }}
                            onCreateNew={handleCreateTag}
                            createNewLabel={(query) => query ? `Create tag "${query}"` : 'Create tag'}
                            disabled={!form.account_id}
                          />
                          <AnimatePresence initial={false}>
                            {selectedTags.length > 0 && (
                              <motion.div
                                key="selected-tags"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.22, ease: EASE }}
                                style={{ overflow: 'hidden' }}
                              >
                                <motion.div
                                  layout
                                  className="mt-2 flex flex-wrap gap-2"
                                  transition={{ layout: { duration: 0.22, ease: EASE } }}
                                >
                                  <AnimatePresence initial={false} mode="popLayout">
                                    {selectedTags.map((tag) => (
                                      <motion.button
                                        layout
                                        key={tag.id}
                                        type="button"
                                        onClick={() => handleRemoveTag(tag.id)}
                                        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-100 hover:bg-[var(--app-accent-soft)]"
                                        style={{
                                          background: 'var(--app-surface-soft)',
                                          color: 'var(--app-text-muted)',
                                          border: '1px solid var(--app-border)',
                                        }}
                                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.96, y: -4 }}
                                        transition={{ duration: 0.18, ease: EASE }}
                                        aria-label={`Remove ${tag.name}`}
                                      >
                                        <TagIcon size={13} aria-hidden className="shrink-0" />
                                        <span className="min-w-0 truncate">{tag.name}</span>
                                        <X size={13} aria-hidden className="shrink-0" />
                                      </motion.button>
                                    ))}
                                  </AnimatePresence>
                                </motion.div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
                      <div className="flex min-h-0 flex-col items-center">
                        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                          03
                        </span>
                        <span
                          className="mt-1 w-px flex-1"
                          style={{ backgroundColor: 'var(--app-border-strong)' }}
                          aria-hidden
                        />
                      </div>

                      <div className="min-w-0 space-y-3">
                        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Amount</p>

                        {/* Currency + Amount */}
                        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                          <div>
                            <div className="mb-1.5 flex items-center gap-2">
                              <label className="app-label block text-[0.9375rem] leading-5">Currency</label>
                              <div className="group relative inline-flex">
                                <Info
                                  size={17}
                                  strokeWidth={2.5}
                                  aria-label="Transaction currency limitation"
                                  className="cursor-help"
                                  style={{ color: 'var(--app-accent)' }}
                                />
                                <div className="app-tooltip-panel app-hover-tooltip">
                                  Locked to the selected account currency. FX currency transactions will be supported soon.
                                </div>
                              </div>
                            </div>
                            <Dropdown
                              options={currencyOptions}
                              value={form.currency}
                              onChange={() => undefined}
                              placeholder={currencies.length === 0 ? 'Loading...' : 'Select...'}
                              searchable
                              searchPlaceholder="Search currencies..."
                              disabled
                            />
                          </div>
                          <div>
                            <FieldLabelRow htmlFor="txn-amount" label="Amount" error={showError('amount')} />
                            <div className="relative">
                              {selectedCurrencySymbol && (
                                <span
                                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                                  style={{
                                    color: 'var(--app-text-subtle)',
                                    fontSize: '0.9375rem',
                                    lineHeight: 1,
                                  }}
                                  aria-hidden
                                >
                                  {selectedCurrencySymbol}
                                </span>
                              )}
                              <input
                                id="txn-amount"
                                type="text"
                                inputMode="decimal"
                                className={`app-input w-full ${selectedCurrencySymbol ? 'pl-8' : ''} ${showError('amount') ? 'app-input-error' : ''}`}
                                placeholder="0.00"
                                value={formatMoneyInputLive(form.amount)}
                                onChange={(e) => handleField('amount', sanitizeMoneyInput(e.target.value))}
                                onBlur={() => handleBlur('amount')}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <label htmlFor="txn-notes" className="app-label mb-1.5 block text-[0.9375rem] leading-5">Notes</label>
                          <textarea
                            id="txn-notes"
                            className="app-input min-h-[4.5rem] resize-y py-2"
                            placeholder="Optional"
                            value={form.notes}
                            onChange={(e) => handleField('notes', e.target.value)}
                            maxLength={500}
                          />
                        </div>
                      </div>
                    </section>

                    {/* Submit error */}
                    <AnimatePresence>
                      {submitError && (
                        <motion.p
                          className="text-sm font-medium"
                          style={{ color: 'var(--app-negative)' }}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                        >
                          {submitError}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Footer */}
                <div
                  className="flex shrink-0 flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:px-8"
                  style={{ borderTop: '1px solid var(--app-border)' }}
                >
                  {editing ? (
                    <button
                      ref={deleteButtonRef}
                      type="button"
                      onClick={() => {
                        if (isPending) return
                        if (confirmingDelete) handleDelete()
                        else setConfirmingDelete(true)
                      }}
                      disabled={isPending}
                      className={`app-danger-button w-full sm:w-auto ${isPending && confirmingDelete ? 'app-primary-button-loading' : ''}`}
                    >
                      {isPending && confirmingDelete ? (
                        <div className="app-spinner" />
                      ) : (
                        <span
                          className="relative block"
                          style={{
                            width: labelWidths
                              ? `${confirmingDelete ? labelWidths.confirm : labelWidths.idle}px`
                              : 'auto',
                            height: '1.25rem',
                            transition: 'width 220ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                          }}
                        >
                          {/* Hidden refs measure the natural width of each label once on mount */}
                          <span
                            ref={idleLabelRef}
                            className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                            aria-hidden
                          >
                            <Trash2 size={16} aria-hidden />
                            Delete
                          </span>
                          <span
                            ref={confirmLabelRef}
                            className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                            aria-hidden
                          >
                            <Check size={16} aria-hidden />
                            Yes, delete
                          </span>
                          {/* Visible labels stack and crossfade */}
                          <span
                            className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                            style={{ opacity: confirmingDelete ? 0 : 1 }}
                          >
                            <Trash2 size={16} aria-hidden />
                            Delete
                          </span>
                          <span
                            className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                            style={{ opacity: confirmingDelete ? 1 : 0 }}
                          >
                            <Check size={16} aria-hidden />
                            Yes, delete
                          </span>
                        </span>
                      )}
                    </button>
                  ) : (
                    <label
                      htmlFor="txn-keep-open"
                      className="flex cursor-pointer items-center gap-3 rounded-xl px-1 py-1 sm:max-w-xs"
                    >
                      <input
                        id="txn-keep-open"
                        type="checkbox"
                        checked={keepOpenAfterCreate}
                        onChange={(event) => setKeepOpenAfterCreate(event.target.checked)}
                        disabled={isPending}
                        className="h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                        style={{ accentColor: 'var(--app-accent)' }}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                          Keep modal open after adding
                        </span>
                        <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                          Keep type, date, and account
                        </span>
                      </span>
                    </label>
                  )}
                  <div className="flex flex-col-reverse gap-3 sm:ml-auto sm:flex-row sm:items-center">
                    <button
                      type="button"
                      className="app-secondary-button w-full sm:w-auto"
                      onClick={onClose}
                      disabled={isPending}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${submitLoading ? 'app-primary-button-loading' : editing ? 'w-full sm:w-24' : 'w-full sm:w-44'}`}
                    >
                      {submitLoading ? <div className="app-spinner" /> : editing ? 'Save' : 'Add Transaction'}
                    </button>
                  </div>
                </div>
                  </form>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
      <CreateMerchantModal
        key={merchantModalKey}
        open={open && showMerchantModal}
        initialName={merchantModalName}
        variant="secondary"
        categoryOptions={merchantDefaultCategoryOptions}
        onClose={() => setShowMerchantModal(false)}
        onCreated={handleMerchantCreated}
      />
      <CreateCategoryModal
        key={categoryModalKey}
        open={open && showCategoryModal}
        initialName={categoryModalName}
        initialKind={form.kind}
        variant="secondary"
        onClose={() => setShowCategoryModal(false)}
        onCreated={handleCategoryCreated}
      />
      <CreateTagModal
        key={tagModalKey}
        open={open && showTagModal}
        initialName={tagModalName}
        groupId={selectedAccount?.group_id ?? null}
        variant="secondary"
        onClose={() => setShowTagModal(false)}
        onCreated={handleTagCreated}
      />
    </>
  )
}
