import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Tag } from 'lucide-react'
import { useCreateCategory, type Category } from '@/api/categories'
import Dropdown from '@/components/dropdown/Dropdown'
import CategoryIconSelector from '@/components/category-icon-selector/Selector'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import CreateReferenceModalShell, {
  type CreateReferenceModalVariant,
} from '@/components/create-modal/ReferenceModalShell'
import { waitForMilliseconds } from '@/utils/timing'

type CategoryKind = Category['kind']
type CreateCategoryField = 'icon' | 'name'
type CreateCategoryFieldErrors = Partial<Record<CreateCategoryField, string>>
type CreateCategoryModalVariant = CreateReferenceModalVariant

interface CreateCategoryModalProps {
  open: boolean
  initialKind?: CategoryKind
  initialName?: string
  variant?: CreateCategoryModalVariant
  onClose: () => void
  onCreated: (category: Category) => void
}

const CREATE_CATEGORY_MIN_LOADING_MS = 800

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']
const KIND_OPTIONS = KIND_ORDER.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))

export default function CreateCategoryModal({
  open,
  initialKind = 'expense',
  initialName = '',
  variant = 'primary',
  onClose,
  onCreated,
}: CreateCategoryModalProps) {
  const createCategory = useCreateCategory()
  const [form, setForm] = useState({
    name: initialName,
    kind: initialKind,
    icon: '',
  })
  const [fieldErrors, setFieldErrors] = useState<CreateCategoryFieldErrors>({})
  const [touched, setTouched] = useState<Record<CreateCategoryField, boolean>>({
    icon: false,
    name: false,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isCreating = createCategory.isPending || createInProgress
  const isSecondary = variant === 'secondary'

  const showError = (field: CreateCategoryField) => touched[field] && fieldErrors[field]
  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'icon' || field === 'name') {
      setTouched((current) => ({ ...current, [field]: true }))
      setFieldErrors((current) => ({ ...current, [field]: undefined }))
    }
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating) return

    const name = form.name.trim()
    const nextErrors: CreateCategoryFieldErrors = {}
    if (!form.icon) nextErrors.icon = 'Required'
    if (!name) nextErrors.name = 'Name is required'
    if (Object.keys(nextErrors).length > 0) {
      setTouched({ icon: true, name: true })
      setFieldErrors(nextErrors)
      return
    }

    setCreateInProgress(true)
    const minimumLoading = waitForMilliseconds(CREATE_CATEGORY_MIN_LOADING_MS)

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
  const title = isSecondary ? 'Add Category' : 'Create Category'
  const submitLabel = isSecondary ? 'Create' : 'Create Category'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-40'

  return (
    <CreateReferenceModalShell
      open={open}
      variant={variant}
      modalTitleId="create-category-title"
      eyebrow={eyebrow}
      title={title}
      railLabel={railLabel}
      RailIcon={Tag}
      submitDisabled={isCreating}
      submitLabel={submitLabel}
      submitWidthClassName={submitWidth}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        <CreateModalSectionFrame step="01">
          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

            <div className="grid gap-4 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
              <div>
                <div className="mb-1.5 flex items-start justify-between gap-3">
                  <span className="app-label block shrink-0 text-[0.9375rem] leading-5">Icon</span>
                  <AnimatePresence initial={false}>
                    {showError('icon') && (
                      <motion.p
                        key="icon-error"
                        className="text-right text-xs font-medium leading-5"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {fieldErrors.icon}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                <CategoryIconSelector
                  categoryName={form.name || 'New category'}
                  value={form.icon}
                  onChange={(icon) => setField('icon', icon)}
                  buttonClassName={`app-input flex h-10 w-10 items-center justify-center p-0 text-xl leading-none ${showError('icon') ? 'app-input-error' : ''}`}
                  hasError={!!showError('icon')}
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-start justify-between gap-3">
                  <span className="app-label block shrink-0 text-[0.9375rem] leading-5">Category name</span>
                  <AnimatePresence initial={false}>
                    {showError('name') && (
                      <motion.p
                        key="name-error"
                        className="text-right text-xs font-medium leading-5"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
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
              <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Category type</span>
              <Dropdown
                options={KIND_OPTIONS}
                value={form.kind}
                onChange={(value) => setField('kind', value as CategoryKind)}
              />
            </div>
          </div>
        </CreateModalSectionFrame>

        <AnimatePresence>
          {formError && (
            <motion.p
              className="text-sm font-medium"
              style={{ color: 'var(--app-negative)' }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {formError}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </CreateReferenceModalShell>
  )
}
