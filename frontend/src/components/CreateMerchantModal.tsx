import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Store, X } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCreateMerchant, type Merchant } from '@/api/merchants'
import Dropdown, { type DropdownOption } from '@/components/Dropdown'

const EASE = [0.25, 0.1, 0.25, 1] as const
const CREATE_MERCHANT_MIN_LOADING_MS = 800

export const NO_DEFAULT_CATEGORY_VALUE = '__none__'

type CreateMerchantField = 'name'
type CreateMerchantFieldErrors = Partial<Record<CreateMerchantField, string>>
type CreateMerchantModalVariant = 'primary' | 'secondary'

interface CreateMerchantModalProps {
  open: boolean
  categoryOptions: DropdownOption[]
  initialName?: string
  defaultCategoryValue?: string
  variant?: CreateMerchantModalVariant
  onClose: () => void
  onCreated: (merchant: Merchant) => void
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export default function CreateMerchantModal({
  open,
  categoryOptions,
  initialName = '',
  defaultCategoryValue = NO_DEFAULT_CATEGORY_VALUE,
  variant = 'primary',
  onClose,
  onCreated,
}: CreateMerchantModalProps) {
  const createMerchant = useCreateMerchant()
  const [form, setForm] = useState({
    name: initialName,
    default_category_id: defaultCategoryValue,
  })
  const [fieldErrors, setFieldErrors] = useState<CreateMerchantFieldErrors>({})
  const [touched, setTouched] = useState<Record<CreateMerchantField, boolean>>({
    name: false,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isCreating = createMerchant.isPending || createInProgress
  const isSecondary = variant === 'secondary'

  useEffect(() => {
    if (!open || isSecondary) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isSecondary, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

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
    if (isCreating) return

    const name = form.name.trim()
    if (!name) {
      setTouched({ name: true })
      setFieldErrors({ name: 'Name is required' })
      return
    }

    setCreateInProgress(true)
    const minimumLoading = delay(CREATE_MERCHANT_MIN_LOADING_MS)

    void createMerchant.mutateAsync(
      {
        name,
        default_category_id: form.default_category_id === NO_DEFAULT_CATEGORY_VALUE ? null : form.default_category_id,
        group_id: null,
      },
    ).then(async (merchant) => {
      await minimumLoading
      onCreated(merchant)
    }).catch(async (error) => {
      await minimumLoading
      setFormError(error instanceof ApiError ? error.message : 'Failed to create merchant.')
      setCreateInProgress(false)
    })
  }

  const backdropClassName = isSecondary ? 'fixed inset-0 z-[100]' : 'fixed inset-0 z-50'
  const backdropStyle = isSecondary
    ? { background: 'rgba(0, 0, 0, 0.22)', backdropFilter: 'blur(6px)' }
    : { background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }
  const panelClassName = isSecondary
    ? 'fixed inset-0 z-[100] flex items-center justify-center p-4'
    : 'fixed inset-0 z-[60] flex items-center justify-center p-4'
  const panelInitial = isSecondary ? { opacity: 0, scale: 0.94, y: 16 } : { opacity: 0, scale: 0.96, y: 12 }
  const panelTransition = isSecondary ? { duration: 0.22, ease: EASE } : { duration: 0.25, ease: EASE }
  const modalClassName = isSecondary
    ? 'app-modal-panel flex max-h-[84vh] w-full max-w-xl overflow-hidden rounded-2xl'
    : 'app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl'
  const railClassName = isSecondary
    ? 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between py-5 sm:flex'
    : 'hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex'
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
  const railLabel = isSecondary ? 'Linked' : 'Merchant'
  const headerPadding = isSecondary ? 'shrink-0 px-6 pb-5 pt-6 sm:px-7' : 'shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7'
  const bodyPadding = isSecondary ? 'min-h-0 flex-1 overflow-y-auto px-6 pb-3 pt-4 sm:px-7' : 'min-h-0 flex-1 overflow-y-auto px-6 pb-3 pt-4 sm:px-8'
  const footerPadding = isSecondary ? 'flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:justify-end sm:px-7' : 'flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:justify-end sm:px-8'
  const eyebrow = isSecondary ? 'Transaction setup' : 'Personal merchant'
  const title = isSecondary ? 'Add Merchant' : 'Create Merchant'
  const submitLabel = isSecondary ? 'Create' : 'Create Merchant'
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
              aria-labelledby="create-merchant-title"
              className={modalClassName}
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={railClassName} style={railStyle} aria-hidden>
                <Store size={isSecondary ? 18 : 20} strokeWidth={2} />
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
                      <h3 id="create-merchant-title" className="font-serif text-3xl font-light">
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
                        <div className="flex min-h-4 items-start justify-between gap-3">
                          <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Merchant Name</p>
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
                        <div>
                          <label htmlFor="merchant-name" className="sr-only">Merchant name</label>
                          <input
                            id="merchant-name"
                            className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                            value={form.name}
                            onChange={(event) => setField('name', event.target.value)}
                            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                            placeholder="Costco"
                            maxLength={256}
                            required
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
                        <div>
                          <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Default Category</p>
                          <p className="mt-2 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                            Used to prefill the category when this merchant is selected when creating a new transaction.
                          </p>
                        </div>
                        <div>
                          <label htmlFor="merchant-default-category" className="sr-only">Default category</label>
                          <Dropdown
                            id="merchant-default-category"
                            options={categoryOptions}
                            value={form.default_category_id}
                            onChange={(value) => setField('default_category_id', value)}
                            searchable
                            searchPlaceholder="Search categories..."
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
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isCreating ? 'app-primary-button-loading' : submitWidth}`}
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
