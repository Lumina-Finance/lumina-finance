import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError } from '@/api/auth'
import { useCreateInstitution, type Institution } from '@/api/institutions'
import Dropdown from '@/components/dropdown/Dropdown'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { CREATE_INSTITUTION_FIELD_IDS } from '@/components/reference-modals/createInstitutionConstants'
import { COUNTRY_OPTIONS } from '@/constants/countries'
import { waitForMilliseconds } from '@/utils/timing'

const CREATE_INSTITUTION_MIN_LOADING_MS = 800

const INITIAL_FORM = {
  name: '',
  country_code: '',
  website: '',
}

type CreateInstitutionForm = typeof INITIAL_FORM
type CreateInstitutionField = keyof CreateInstitutionForm
type CreateInstitutionFieldErrors = Partial<Record<CreateInstitutionField, string>>

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
    const minimumLoading = waitForMilliseconds(CREATE_INSTITUTION_MIN_LOADING_MS)

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
    <ModalTitledPanel
      open={open}
      level="stacked"
      titleId="create-institution-title"
      eyebrow="Account setup"
      title="Add Institution"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <ModalFormFooter
          submitLabel="Create"
          submitDisabled={isCreating}
          submitWidthClassName="w-full sm:w-32"
          level="stacked"
          onCancel={onClose}
        />
      }
    >
      <div className="space-y-5">
        <CreateModalSectionFrame step="01">
          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

            <div>
              <CreateModalFieldLabelRow htmlFor={CREATE_INSTITUTION_FIELD_IDS.name} label="Name" error={showError('name') || undefined} />
              <input
                id={CREATE_INSTITUTION_FIELD_IDS.name}
                type="text"
                className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                value={form.name}
                onChange={(event) => handleChange('name', event.target.value)}
                onBlur={() => handleBlur('name')}
                maxLength={256}
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor={CREATE_INSTITUTION_FIELD_IDS.country} label="Country" error={showError('country_code') || undefined} />
              <Dropdown
                id={CREATE_INSTITUTION_FIELD_IDS.country}
                options={COUNTRY_OPTIONS}
                value={form.country_code}
                onChange={(value) => handleChange('country_code', value)}
                hasError={Boolean(showError('country_code'))}
                placeholder="Select country..."
                searchable
                searchPlaceholder="Search countries..."
              />
            </div>
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02">
          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Reference</p>

            <div>
              <CreateModalFieldLabelRow htmlFor={CREATE_INSTITUTION_FIELD_IDS.website} label="Website" error={showError('website') || undefined} />
              <input
                id={CREATE_INSTITUTION_FIELD_IDS.website}
                type="url"
                className={`app-input ${showError('website') ? 'app-input-error' : ''}`}
                placeholder="https://example.com"
                value={form.website}
                onChange={(event) => handleChange('website', event.target.value)}
                onBlur={() => handleBlur('website')}
              />
            </div>
          </div>
        </CreateModalSectionFrame>

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
    </ModalTitledPanel>
  )
}
