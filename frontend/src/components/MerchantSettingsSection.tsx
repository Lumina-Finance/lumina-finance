import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useCategories, type Category } from '@/api/categories'
import {
  useCreateMerchant,
  useDeleteMerchant,
  useMerchants,
  useUpdateMerchant,
  type Merchant,
} from '@/api/merchants'
import { merchantKeys } from '@/api/queryKeys'
import Dropdown, { type DropdownOption } from '@/components/Dropdown'

const DELETE_SPINNER_MS = 1000
const NO_CATEGORY_VALUE = '__none__'
const CATEGORY_KIND_LABELS: Record<Category['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}
const CATEGORY_KIND_ORDER: Category['kind'][] = ['expense', 'income', 'transfer']
type CreateMerchantField = 'name'
type CreateMerchantFieldErrors = Partial<Record<CreateMerchantField, string>>

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function SectionHeader({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2
        className="font-serif font-medium tracking-tight"
        style={{ fontSize: 'clamp(1.5rem, 2.2vw, 2rem)', lineHeight: 1.1 }}
      >
        {title}
      </h2>
      <div className="mt-1 text-base" style={{ color: 'var(--app-text-muted)' }}>
        <p>{description}</p>
      </div>
    </div>
  )
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5 sm:p-6"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="block space-y-1.5">
      <span className="app-label block">{label}</span>
      {children}
    </div>
  )
}

function categoryOptions(categories: Category[]): DropdownOption[] {
  return [
    { value: NO_CATEGORY_VALUE, label: 'No default category', group: 'Default' },
    ...CATEGORY_KIND_ORDER.flatMap((kind) =>
      categories
        .filter((category) => category.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((category) => ({
          value: category.id,
          label: category.name,
          group: CATEGORY_KIND_LABELS[kind],
          icon: category.icon,
        })),
    ),
  ]
}

function categoryName(categoryById: Map<string, Category>, categoryId: string | null) {
  if (!categoryId) return 'No default category'
  return categoryById.get(categoryId)?.name ?? 'Unknown category'
}

function scopeLabel(merchant: Merchant) {
  return merchant.group_id ? 'Group merchant' : 'Personal merchant'
}

export default function MerchantSettingsSection() {
  const queryClient = useQueryClient()
  const { data: merchants = [], isLoading } = useMerchants()
  const { data: categories = [] } = useCategories()
  const deleteMerchant = useDeleteMerchant()
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingMerchantId, setEditingMerchantId] = useState<string | null>(null)
  const [confirmingDeleteMerchantId, setConfirmingDeleteMerchantId] = useState<string | null>(null)
  const [deletingMerchantId, setDeletingMerchantId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const options = useMemo(() => categoryOptions(categories), [categories])
  const filteredMerchants = useMemo(() => {
    const query = search.trim().toLowerCase()
    return merchants
      .filter((merchant) =>
        !query ||
        merchant.name.toLowerCase().includes(query) ||
        categoryName(categoryById, merchant.default_category_id).toLowerCase().includes(query),
      )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [categoryById, merchants, search])

  const handleDelete = async (merchant: Merchant) => {
    setDeleteError(null)
    setDeletingMerchantId(merchant.id)

    const deleteResult = await Promise.allSettled([
      deleteMerchant.mutateAsync(merchant.id),
      delay(DELETE_SPINNER_MS),
    ])

    if (deleteResult[0].status === 'fulfilled') {
      queryClient.setQueryData<Merchant[]>(merchantKeys.list(), (currentMerchants) =>
        currentMerchants?.filter((currentMerchant) => currentMerchant.id !== merchant.id) ?? currentMerchants,
      )
      setConfirmingDeleteMerchantId(null)
    } else {
      const error = deleteResult[0].reason
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete merchant.')
    }

    setDeletingMerchantId(null)
  }

  return (
    <section id="merchants" className="scroll-mt-8">
      <SectionHeader
        title="Merchants"
        description="Manage merchant names and their default categories."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
              <input
                className="app-input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search merchants..."
                disabled={merchants.length === 0}
              />
            </div>
            <button
              type="button"
              className="app-primary-button shrink-0"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={16} aria-hidden />
              Create merchant
            </button>
          </div>

          {deleteError && (
            <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {deleteError}
            </p>
          )}

          {isLoading ? (
            <div className="h-24 rounded-lg bg-gray-300" />
          ) : merchants.length === 0 ? (
            <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              No merchants yet.
            </p>
          ) : filteredMerchants.length === 0 ? (
            <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              No merchants match your search.
            </p>
          ) : (
            <div>
              {filteredMerchants.map((merchant, index) => (
                <MerchantRow
                  key={merchant.id}
                  categoryById={categoryById}
                  categoryOptions={options}
                  confirmingDelete={confirmingDeleteMerchantId === merchant.id}
                  deleting={deletingMerchantId === merchant.id}
                  isEditing={editingMerchantId === merchant.id}
                  isLast={index === filteredMerchants.length - 1}
                  merchant={merchant}
                  onDeleteCancel={() => setConfirmingDeleteMerchantId(null)}
                  onDeleteConfirm={handleDelete}
                  onDeleteRequest={(nextMerchant) => {
                    setDeleteError(null)
                    setEditingMerchantId(null)
                    setConfirmingDeleteMerchantId(nextMerchant.id)
                  }}
                  onEdit={(nextMerchant) => setEditingMerchantId(nextMerchant.id)}
                  onEditCancel={() => setEditingMerchantId(null)}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsCard>

      {showCreateModal && (
        <CreateMerchantModal
          categoryOptions={options}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => setShowCreateModal(false)}
        />
      )}
    </section>
  )
}

function CreateMerchantModal({
  categoryOptions,
  onClose,
  onCreated,
}: {
  categoryOptions: DropdownOption[]
  onClose: () => void
  onCreated: () => void
}) {
  const createMerchant = useCreateMerchant()
  const [form, setForm] = useState({
    name: '',
    default_category_id: NO_CATEGORY_VALUE,
  })
  const [fieldErrors, setFieldErrors] = useState<CreateMerchantFieldErrors>({})
  const [touched, setTouched] = useState<Record<CreateMerchantField, boolean>>({
    name: false,
  })
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const showError = (field: CreateMerchantField) => touched[field] && fieldErrors[field]
  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'name') {
      setTouched((current) => ({ ...current, name: true }))
      setFieldErrors((current) => ({ ...current, name: undefined }))
    }
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createMerchant.isPending) return

    const name = form.name.trim()
    if (!name) {
      setTouched({ name: true })
      setFieldErrors({ name: 'Name is required' })
      return
    }

    createMerchant.mutate(
      {
        name,
        default_category_id: form.default_category_id === NO_CATEGORY_VALUE ? null : form.default_category_id,
        group_id: null,
      },
      {
        onSuccess: onCreated,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to create merchant.')
        },
      },
    )
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
        aria-hidden
      />

      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-merchant-title"
          className="w-full max-w-lg rounded-2xl p-6 sm:p-8"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="create-merchant-title" className="font-serif text-2xl font-light tracking-tight">
                  Create merchant
                </h3>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Add a merchant and choose its default category.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="app-icon-button shrink-0"
                aria-label="Close"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="grid gap-4">
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="app-label block">Merchant name</span>
                  <AnimatePresence>
                    {showError('name') && (
                      <motion.p
                        key="name-error"
                        className="whitespace-nowrap text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.2 }}
                      >
                        {fieldErrors.name}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                <input
                  className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                  placeholder="Costco"
                  maxLength={256}
                  required
                />
              </div>
              <Field label="Default category">
                <Dropdown
                  options={categoryOptions}
                  value={form.default_category_id}
                  onChange={(value) => setField('default_category_id', value)}
                  searchable
                  searchPlaceholder="Search categories..."
                />
              </Field>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              {formError && (
                <p className="text-sm sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                  {formError}
                </p>
              )}
              <button type="button" className="app-secondary-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="app-primary-button inline-flex items-center justify-center gap-2"
                disabled={createMerchant.isPending}
              >
                {createMerchant.isPending ? <div className="app-spinner" aria-label="Creating" /> : <Plus size={16} aria-hidden />}
                Create merchant
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

function MerchantRow({
  categoryById,
  categoryOptions,
  confirmingDelete,
  deleting,
  isEditing,
  isLast,
  merchant,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  categoryById: Map<string, Category>
  categoryOptions: DropdownOption[]
  confirmingDelete: boolean
  deleting: boolean
  isEditing: boolean
  isLast: boolean
  merchant: Merchant
  onDeleteCancel: () => void
  onDeleteConfirm: (merchant: Merchant) => void
  onDeleteRequest: (merchant: Merchant) => void
  onEdit: (merchant: Merchant) => void
  onEditCancel: () => void
}) {
  if (isEditing) {
    return (
      <InlineMerchantEdit
        categoryOptions={categoryOptions}
        merchant={merchant}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <div
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{merchant.name}</p>
        <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {scopeLabel(merchant)} · {categoryName(categoryById, merchant.default_category_id)}
        </p>
      </div>
      <div className="flex justify-end gap-1.5">
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className="app-icon-button"
              disabled={deleting}
              onClick={onDeleteCancel}
              aria-label={`Cancel deleting ${merchant.name}`}
              title="Cancel"
            >
              <X size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="app-icon-button"
              disabled={deleting}
              onClick={() => onDeleteConfirm(merchant)}
              aria-label={`Confirm delete ${merchant.name}`}
              title="Confirm delete"
            >
              {deleting ? <div className="app-spinner" aria-label="Deleting" /> : <Check size={16} aria-hidden />}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="app-icon-button"
              onClick={() => onEdit(merchant)}
              aria-label={`Edit ${merchant.name}`}
              title="Edit merchant"
            >
              <Pencil size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="app-icon-button"
              onClick={() => onDeleteRequest(merchant)}
              aria-label={`Delete ${merchant.name}`}
              title="Delete merchant"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function InlineMerchantEdit({
  categoryOptions,
  isLast,
  merchant,
  onCancel,
}: {
  categoryOptions: DropdownOption[]
  isLast: boolean
  merchant: Merchant
  onCancel: () => void
}) {
  const updateMerchant = useUpdateMerchant()
  const [form, setForm] = useState({
    name: merchant.name,
    default_category_id: merchant.default_category_id ?? NO_CATEGORY_VALUE,
  })
  const [formError, setFormError] = useState<string | null>(null)

  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateMerchant.isPending) return

    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }

    const defaultCategoryId = form.default_category_id === NO_CATEGORY_VALUE ? null : form.default_category_id
    if (name === merchant.name && defaultCategoryId === merchant.default_category_id) {
      onCancel()
      return
    }

    updateMerchant.mutate(
      {
        merchantId: merchant.id,
        payload: {
          name,
          default_category_id: defaultCategoryId,
        },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update merchant.')
        },
      },
    )
  }

  return (
    <form
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,16rem)]">
        <div className="min-w-0">
          <div
            className="group flex h-9 min-w-0 items-center gap-1.5 rounded-md border px-2 transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-within:border-[var(--app-accent-border)]"
            style={{
              background: 'var(--app-input-bg)',
              borderColor: 'var(--app-input-border)',
            }}
          >
            <input
              className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              maxLength={256}
              aria-label={`${merchant.name} name`}
              required
              style={{ color: 'var(--app-text)' }}
            />
            <Pencil
              size={13}
              className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
              style={{ color: 'var(--app-text-subtle)' }}
              aria-hidden
            />
          </div>
          {formError && (
            <p className="mt-1 text-sm" style={{ color: 'var(--app-negative)' }}>
              {formError}
            </p>
          )}
        </div>
        <Dropdown
          className="h-9 w-full rounded-md border border-[var(--app-input-border)] bg-[var(--app-input-bg)] px-2 py-0 outline-none transition-colors duration-150 hover:border-[var(--app-border-strong)] focus:border-[var(--app-accent-border)]"
          options={categoryOptions}
          value={form.default_category_id}
          onChange={(value) => setField('default_category_id', value)}
          searchable
          searchPlaceholder="Search categories..."
        />
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="submit"
          className="app-icon-button"
          disabled={updateMerchant.isPending}
          aria-label={`Save ${merchant.name}`}
          title="Save"
        >
          {updateMerchant.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
        </button>
        <button
          type="button"
          className="app-icon-button"
          onClick={onCancel}
          disabled={updateMerchant.isPending}
          aria-label={`Cancel editing ${merchant.name}`}
          title="Cancel"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </form>
  )
}
