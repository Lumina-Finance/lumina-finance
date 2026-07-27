import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Store } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCreateMerchant, type Merchant } from '@/api/merchants'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import CreateReferenceModalShell, {
  type CreateReferenceModalVariant,
} from '@/components/create-modal/ReferenceModalShell'
import { CREATE_MERCHANT_FIELD_IDS, NO_DEFAULT_CATEGORY_VALUE } from '@/components/reference-modals/createMerchantConstants'
import { waitForMilliseconds } from '@/utils/timing'

const CREATE_MERCHANT_MIN_LOADING_MS = 800

type CreateMerchantField = 'name'
type CreateMerchantFieldErrors = Partial<Record<CreateMerchantField, string>>
type CreateMerchantModalVariant = CreateReferenceModalVariant

interface CreateMerchantModalProps {
  open: boolean
  categoryOptions: DropdownOption[]
  initialName?: string
  defaultCategoryValue?: string
  variant?: CreateMerchantModalVariant
  onClose: () => void
  onCreated: (merchant: Merchant) => void
}

/**
 * Modal for creating a new merchant, collecting its name and an optional default category before
 * handing the created merchant back through `onCreated`
 *
 * The secondary variant renders as the compact inline form used when creating a merchant from inside
 * another reference picker, while the primary variant is the standalone modal. Submission enforces a
 * minimum loading duration so the success state does not flash by unnoticed on fast responses
 */
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
    const minimumLoading = waitForMilliseconds(CREATE_MERCHANT_MIN_LOADING_MS)

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

  const railLabel = isSecondary ? 'Linked' : 'Merchant'
  const eyebrow = isSecondary ? 'Transaction setup' : 'Personal merchant'
  const title = isSecondary ? 'Add Merchant' : 'Create Merchant'
  const submitLabel = isSecondary ? 'Create' : 'Create Merchant'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-40'

  return (
    <CreateReferenceModalShell
      open={open}
      variant={variant}
      modalTitleId="create-merchant-title"
      eyebrow={eyebrow}
      title={title}
      railLabel={railLabel}
      RailIcon={Store}
      submitDisabled={isCreating}
      submitLabel={submitLabel}
      submitWidthClassName={submitWidth}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        <CreateModalSectionFrame step="01">
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
              <label htmlFor={CREATE_MERCHANT_FIELD_IDS.name} className="sr-only">Merchant name</label>
              <input
                id={CREATE_MERCHANT_FIELD_IDS.name}
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
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Default Category</p>
              <p className="mt-2 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                Used to prefill the category when this merchant is selected when creating a new transaction.
              </p>
            </div>
            <div>
              <label htmlFor={CREATE_MERCHANT_FIELD_IDS.defaultCategory} className="sr-only">Default category</label>
              <Dropdown
                id={CREATE_MERCHANT_FIELD_IDS.defaultCategory}
                options={categoryOptions}
                value={form.default_category_id}
                onChange={(value) => setField('default_category_id', value)}
                searchable
                searchPlaceholder="Search categories..."
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
