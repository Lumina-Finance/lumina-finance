import { useState, type FormEvent } from 'react'
import { Tag } from 'lucide-react'
import { useCreateCategory, type Category } from '@/api/categories'
import Dropdown from '@/components/dropdown/Dropdown'
import CategoryIconSelector from '@/components/category-icon-selector/Selector'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { FormError } from '@/components/forms/FormError'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import {
  CREATE_CATEGORY_FIELD_IDS,
  CREATE_CATEGORY_FIELDS,
  CREATE_CATEGORY_ICON_REQUIRED_MESSAGE,
  CREATE_CATEGORY_NAME_REQUIRED_MESSAGE,
} from '@/components/reference-modals/createCategoryConstants'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'

type CategoryKind = Category['kind']

interface CreateCategoryModalProps {
  open: boolean
  initialKind?: CategoryKind
  initialName?: string
  /** Set to stacked where this opens from inside another modal's picker */
  level?: ModalLevel
  onClose: () => void
  onCreated: (category: Category) => void
}

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']
const KIND_OPTIONS = KIND_ORDER.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))

/**
 * Modal for creating a new category, collecting its icon, name, and kind before handing the created
 * category back through `onCreated`
 *
 * At the stacked level it renders as the compact inline form used when creating a category from inside
 * another reference picker, and at the page level as the standalone modal. Submission enforces a
 * minimum loading duration so the success state does not flash by unnoticed on fast responses
 */
export default function CreateCategoryModal({
  open,
  initialKind = 'expense',
  initialName = '',
  level = 'page',
  onClose,
  onCreated,
}: CreateCategoryModalProps) {
  const createCategory = useCreateCategory()
  const [form, setForm] = useState({
    name: initialName,
    kind: initialKind,
    icon: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isCreating = createCategory.isPending || createInProgress
  const isSecondary = level === 'stacked'
  const name = form.name.trim()
  const refusal = useRefusedSubmit(
    {
      icon: form.icon ? undefined : CREATE_CATEGORY_ICON_REQUIRED_MESSAGE,
      name: name ? undefined : CREATE_CATEGORY_NAME_REQUIRED_MESSAGE,
    },
    CREATE_CATEGORY_FIELDS,
    CREATE_CATEGORY_FIELD_IDS,
  )

  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating || !refusal.guard()) return

    setCreateInProgress(true)
    const minimumLoading = waitForMilliseconds(LOADING_ANIMATION_MIN_MS)

    void createCategory.mutateAsync(
      {
        name,
        kind: form.kind,
        icon: form.icon,
        group_id: null,
      },
    ).then(async (category) => {
      await minimumLoading
      onCreated(category)
    }).catch(async (error) => {
      await minimumLoading
      setFormError(error instanceof Error ? error.message : 'Failed to create category.')
      setCreateInProgress(false)
    })
  }

  const railLabel = isSecondary ? 'Linked' : 'Category'
  const eyebrow = isSecondary ? 'Transaction setup' : `${KIND_LABELS[form.kind]} category`
  const title = isSecondary ? 'Add category' : 'Create category'
  const submitLabel = isSecondary ? 'Create' : 'Create category'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-40'

  return (
    <ModalTitledPanel
      open={open}
      level={level}
      titleId="create-category-title"
      eyebrow={eyebrow}
      title={title}
      railLabel={railLabel}
      RailIcon={Tag}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <ModalFormFooter
          submitLabel={submitLabel}
          submitDisabled={isCreating}
          submitBlockedReason={refusal.blockedReason}
          submitWidthClassName={submitWidth}
          level={level}
          onCancel={onClose}
        />
      }
    >
      <div className="space-y-5">
        <CreateModalSectionFrame step="01">
          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-4">
              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_CATEGORY_FIELD_IDS.icon}
                  label="Icon"
                />
                <CategoryIconSelector
                  id={CREATE_CATEGORY_FIELD_IDS.icon}
                  categoryName={form.name || 'New category'}
                  value={form.icon}
                  onChange={(icon) => setField('icon', icon)}
                  buttonClassName={`app-input flex h-10 w-10 items-center justify-center p-0 text-xl leading-none ${refusal.errors.icon ? 'app-input-error' : ''}`}
                  hasError={!!refusal.errors.icon}
                  errorId={CREATE_CATEGORY_FIELD_IDS.iconError}
                  modalFieldTabStop
                />
                {/* The icon box is too narrow for visible text, so its error colour shows the problem and this carries the message to screen readers */}
                {refusal.errors.icon && (
                  <p id={CREATE_CATEGORY_FIELD_IDS.iconError} role="alert" className="sr-only">{refusal.errors.icon}</p>
                )}
              </div>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_CATEGORY_FIELD_IDS.name}
                  label="Category name"
                  error={refusal.errors.name}
                  errorId={CREATE_CATEGORY_FIELD_IDS.nameError}
                />
                <input
                  id={CREATE_CATEGORY_FIELD_IDS.name}
                  className={`app-input ${refusal.errors.name ? 'app-input-error' : ''}`}
                  aria-invalid={refusal.errors.name ? true : undefined}
                  aria-describedby={refusal.errors.name ? CREATE_CATEGORY_FIELD_IDS.nameError : undefined}
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  onBlur={() => refusal.touch('name')}
                  placeholder="Groceries"
                  maxLength={256}
                  required
                />
              </div>
            </div>
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02">
          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Classification</p>
            <div>
              <label htmlFor={CREATE_CATEGORY_FIELD_IDS.kind} className="app-label mb-1.5 block text-[0.9375rem] leading-5">Category type</label>
              <Dropdown
                id={CREATE_CATEGORY_FIELD_IDS.kind}
                options={KIND_OPTIONS}
                value={form.kind}
                onChange={(value) => setField('kind', value as CategoryKind)}
              />
            </div>
          </div>
        </CreateModalSectionFrame>

        <FormError message={formError} />
      </div>
    </ModalTitledPanel>
  )
}
