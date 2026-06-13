import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Tag, X } from 'lucide-react'
import { useCreateCategory, type Category } from '@/api/categories'
import Dropdown from '@/components/Dropdown'
import CategoryIconSelector from '@/components/category-icon-selector/CategoryIconSelector'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

type CategoryKind = Category['kind']
type CreateCategoryField = 'icon' | 'name'
type CreateCategoryFieldErrors = Partial<Record<CreateCategoryField, string>>
type CreateCategoryModalVariant = 'primary' | 'secondary'

interface CreateCategoryModalProps {
  open: boolean
  initialKind?: CategoryKind
  initialName?: string
  variant?: CreateCategoryModalVariant
  onClose: () => void
  onCreated: (category: Category) => void
}

const EASE = [0.25, 0.1, 0.25, 1] as const
const CREATE_CATEGORY_MIN_LOADING_MS = 800

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']
const KIND_OPTIONS = KIND_ORDER.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

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

  useBodyScrollLock(open && !isSecondary)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

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
    const minimumLoading = delay(CREATE_CATEGORY_MIN_LOADING_MS)

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

  const backdropClassName = isSecondary ? 'fixed inset-0 z-[100]' : 'fixed inset-0 z-50'
  const backdropStyle = isSecondary
    ? { background: 'rgba(0, 0, 0, 0.22)', backdropFilter: 'blur(6px)' }
    : { background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }
  const panelClassName = isSecondary
    ? 'fixed inset-0 z-[100] flex items-center justify-center p-4'
    : 'fixed inset-0 z-50 flex items-center justify-center p-4'
  const panelInitial = isSecondary ? { opacity: 0, scale: 0.94, y: 16 } : { opacity: 0, scale: 0.96, y: 12 }
  const panelTransition = isSecondary ? { duration: 0.22, ease: EASE } : { duration: 0.25, ease: EASE }
  const modalClassName = isSecondary
    ? 'app-modal-panel flex max-h-[84vh] w-full max-w-xl rounded-2xl'
    : 'app-modal-panel flex max-h-[86vh] w-full max-w-2xl rounded-2xl'
  const railClassName = isSecondary
    ? 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between rounded-l-2xl py-5 sm:flex'
    : 'hidden w-16 shrink-0 flex-col items-center justify-between rounded-l-2xl py-6 sm:flex'
  const railStyle = isSecondary
    ? {
        background: 'var(--app-surface-soft)',
        borderRight: '1px solid var(--app-border)',
        color: 'var(--app-accent)',
      }
    : {
        background: 'var(--app-button-primary-bg)',
        color: 'var(--app-button-primary-text)',
      }
  const railLabel = isSecondary ? 'Linked' : 'Category'
  const headerPadding = isSecondary ? 'shrink-0 pb-5 pl-4 pr-5 pt-6 min-[1050px]:px-7' : 'shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8'
  const bodyPadding = isSecondary ? 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-7' : 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8'
  const footerPadding = isSecondary ? 'grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-7 min-[1050px]:py-5' : 'grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-8 min-[1050px]:py-5'
  const eyebrow = isSecondary ? 'Transaction setup' : `${KIND_LABELS[form.kind]} category`
  const title = isSecondary ? 'Add Category' : 'Create Category'
  const submitLabel = isSecondary ? 'Create' : 'Create Category'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-40'

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={backdropClassName}
            style={backdropStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: isSecondary ? 0.15 : 0.2 }}
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            className={panelClassName}
            initial={panelInitial}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={panelInitial}
            transition={panelTransition}
            onClick={onClose}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-category-title"
              className={modalClassName}
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={railClassName} style={railStyle} aria-hidden>
                <Tag size={isSecondary ? 18 : 20} strokeWidth={2} />
                <span className={`${isSecondary ? 'text-[0.6875rem]' : 'text-xs'} rotate-180 font-semibold uppercase`} style={{ writingMode: 'vertical-rl' }}>
                  {railLabel}
                </span>
              </div>

              <form onSubmit={handleSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                <div className={headerPadding} style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        {eyebrow}
                      </p>
                      <h3 id="create-category-title" className="font-serif text-3xl font-light">
                        {title}
                      </h3>
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

                <div className={bodyPadding}>
                  <div className="space-y-5">
                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
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
                    </section>

                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
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
                    </section>

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
                </div>

                <div className={footerPadding} style={{ borderTop: '1px solid var(--app-border)' }}>
                  <button type="button" className="app-secondary-button w-full sm:w-auto" onClick={onClose} disabled={isCreating}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isCreating ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : submitWidth}`}
                    disabled={isCreating}
                  >
                    {isCreating ? <div className="app-spinner" aria-label="Creating" /> : submitLabel}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
