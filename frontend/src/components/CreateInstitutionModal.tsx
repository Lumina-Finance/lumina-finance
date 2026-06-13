import { useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError } from '@/api/auth'
import { useCreateInstitution, type Institution } from '@/api/institutions'
import Dropdown from '@/components/Dropdown'
import CreateReferenceModalShell from '@/components/create-modal/CreateReferenceModalShell'
import { COUNTRY_OPTIONS } from '@/constants/countries'

const CREATE_INSTITUTION_MIN_LOADING_MS = 800

const INITIAL_FORM = {
  name: '',
  country_code: '',
  website: '',
}

type CreateInstitutionForm = typeof INITIAL_FORM
type CreateInstitutionField = keyof CreateInstitutionForm
type CreateInstitutionFieldErrors = Partial<Record<CreateInstitutionField, string>>

interface FieldLabelRowProps {
  label: ReactNode
  htmlFor?: string
  error?: string
}

interface CreateInstitutionModalProps {
  open: boolean
  initialName: string
  onClose: () => void
  onCreated: (institution: Institution) => void
}

const ALL_INSTITUTION_FIELDS_TOUCHED: Record<CreateInstitutionField, boolean> = {
  name: true,
  country_code: true,
  website: true,
}

/**
 * Displays a modal field label with the matching animated validation message
 */
function FieldLabelRow({ label, htmlFor, error }: FieldLabelRowProps) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">
        {label}
      </label>
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

/**
 * Validates the institution fields required by the backend create endpoint
 */
function validateCreateInstitutionForm(form: CreateInstitutionForm): CreateInstitutionFieldErrors {
  const errors: CreateInstitutionFieldErrors = {}
  if (!form.name.trim()) errors.name = 'Name is required'
  if (!form.country_code) errors.country_code = 'Select a country'
  if (!form.website.trim()) errors.website = 'Website is required'
  return errors
}

/**
 * Keeps the create button loading state visible long enough to avoid a flicker
 */
function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * Creates an institution from nested account and import workflows
 */
export default function CreateInstitutionModal({
  open,
  initialName,
  onClose,
  onCreated,
}: CreateInstitutionModalProps) {
  const mutation = useCreateInstitution()

  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    name: initialName,
  }))
  const [fieldErrors, setFieldErrors] = useState<CreateInstitutionFieldErrors>({})
  const [touched, setTouched] = useState<Partial<Record<CreateInstitutionField, boolean>>>({})
  const [submitError, setSubmitError] = useState('')
  const [createInProgress, setCreateInProgress] = useState(false)
  const isCreating = mutation.isPending || createInProgress

  const handleChange = (field: CreateInstitutionField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (fieldErrors[field]) {
      setFieldErrors((current) => ({ ...current, [field]: undefined }))
    }
    setSubmitError('')
  }

  const handleBlur = (field: CreateInstitutionField) => {
    setTouched((current) => ({ ...current, [field]: true }))
    const errors = validateCreateInstitutionForm(form)
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating) return

    const errors = validateCreateInstitutionForm(form)
    setFieldErrors(errors)
    setTouched(ALL_INSTITUTION_FIELDS_TOUCHED)
    if (Object.keys(errors).length > 0) return

    setCreateInProgress(true)
    const minimumLoading = delay(CREATE_INSTITUTION_MIN_LOADING_MS)

    void mutation.mutateAsync(
      {
        name: form.name.trim(),
        country_code: form.country_code.toUpperCase(),
        website: form.website.trim(),
      },
    ).then(async (institution) => {
      await minimumLoading
      onCreated(institution)
    }).catch(async (error) => {
      await minimumLoading
      setSubmitError(error instanceof ApiError ? error.message : 'Something went wrong.')
      setCreateInProgress(false)
    })
  }

  const showError = (field: CreateInstitutionField) => touched[field] && fieldErrors[field]

  return (
    <CreateReferenceModalShell
      open={open}
      variant="secondary"
      modalTitleId="create-institution-title"
      eyebrow="Account setup"
      title="Add Institution"
      submitDisabled={isCreating}
      submitLabel="Create"
      submitWidthClassName="w-full sm:w-32"
      onClose={onClose}
      onSubmit={handleSubmit}
    >
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

            <div>
              <FieldLabelRow htmlFor="inst-name" label="Name" error={showError('name') || undefined} />
              <input
                id="inst-name"
                type="text"
                className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                value={form.name}
                onChange={(event) => handleChange('name', event.target.value)}
                onBlur={() => handleBlur('name')}
                maxLength={256}
              />
            </div>

            <div>
              <FieldLabelRow label="Country" error={showError('country_code') || undefined} />
              <Dropdown
                options={COUNTRY_OPTIONS}
                value={form.country_code}
                onChange={(value) => handleChange('country_code', value)}
                className={`app-input ${showError('country_code') ? 'app-input-error' : ''}`}
                placeholder="Select country..."
                searchable
                searchPlaceholder="Search countries..."
              />
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
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Reference</p>

            <div>
              <FieldLabelRow htmlFor="inst-website" label="Website" error={showError('website') || undefined} />
              <input
                id="inst-website"
                type="url"
                className={`app-input ${showError('website') ? 'app-input-error' : ''}`}
                placeholder="https://example.com"
                value={form.website}
                onChange={(event) => handleChange('website', event.target.value)}
                onBlur={() => handleBlur('website')}
              />
            </div>
          </div>
        </section>

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
    </CreateReferenceModalShell>
  )
}
