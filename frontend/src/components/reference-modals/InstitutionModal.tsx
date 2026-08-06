import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError } from '@/api/auth'
import { useCreateInstitution, useUpdateInstitution, type Institution } from '@/api/institutions'
import Dropdown from '@/components/dropdown/Dropdown'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { INSTITUTION_FIELD_IDS } from '@/components/reference-modals/institutionModalConstants'
import { COUNTRY_OPTIONS } from '@/constants/countries'
import { waitForMilliseconds } from '@/utils/timing'

const INSTITUTION_MIN_LOADING_MS = 800

const INITIAL_FORM = {
  name: '',
  country_code: '',
  website: '',
}

type InstitutionForm = typeof INITIAL_FORM
type InstitutionField = keyof InstitutionForm
type InstitutionFieldErrors = Partial<Record<InstitutionField, string>>

interface InstitutionModalProps {
  open: boolean
  initialName: string

  /**
   * The institution being corrected. Supplying one switches the modal from adding an
   * institution to rewriting the shared row every user on the instance sees
   */
  institution?: Institution | null
  onClose: () => void
  onSaved: (institution: Institution) => void
}

const ALL_INSTITUTION_FIELDS_TOUCHED: Record<InstitutionField, boolean> = {
  name: true,
  country_code: true,
  website: true,
}

/**
 * Validates the institution fields the backend requires on both write paths
 */
function validateInstitutionForm(form: InstitutionForm): InstitutionFieldErrors {
  const errors: InstitutionFieldErrors = {}
  if (!form.name.trim()) errors.name = 'Name is required'
  if (!form.country_code) errors.country_code = 'Select a country'
  if (!form.website.trim()) errors.website = 'Website is required'
  return errors
}

/**
 * Adds an institution, or corrects one, from nested account and import workflows
 *
 * The form holds no logo field, because a logo is derived from the website rather than
 * uploaded, and a correction leaves any stored logo URL alone
 */
export default function InstitutionModal({
  open,
  initialName,
  institution,
  onClose,
  onSaved,
}: InstitutionModalProps) {
  const createMutation = useCreateInstitution()
  const updateMutation = useUpdateInstitution()
  const isCorrection = Boolean(institution)

  // Callers remount this with a key rather than reopening it, so the initial values are
  // read once per opening and never go stale against the institution being corrected
  const [form, setForm] = useState<InstitutionForm>(() => (
    institution
      ? {
          name: institution.name,
          country_code: institution.country_code,
          website: institution.website,
        }
      : { ...INITIAL_FORM, name: initialName }
  ))
  const [fieldErrors, setFieldErrors] = useState<InstitutionFieldErrors>({})
  const [touched, setTouched] = useState<Partial<Record<InstitutionField, boolean>>>({})
  const [submitError, setSubmitError] = useState('')
  const [saveInProgress, setSaveInProgress] = useState(false)
  const isSaving = createMutation.isPending || updateMutation.isPending || saveInProgress

  const handleChange = (field: InstitutionField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (fieldErrors[field]) {
      setFieldErrors((current) => ({ ...current, [field]: undefined }))
    }
    setSubmitError('')
  }

  const handleBlur = (field: InstitutionField) => {
    setTouched((current) => ({ ...current, [field]: true }))
    const errors = validateInstitutionForm(form)
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving) return

    const errors = validateInstitutionForm(form)
    setFieldErrors(errors)
    setTouched(ALL_INSTITUTION_FIELDS_TOUCHED)
    if (Object.keys(errors).length > 0) return

    setSaveInProgress(true)
    const minimumLoading = waitForMilliseconds(INSTITUTION_MIN_LOADING_MS)
    const payload = {
      name: form.name.trim(),
      country_code: form.country_code.toUpperCase(),
      website: form.website.trim(),
    }
    const saved = institution
      ? updateMutation.mutateAsync({ institutionId: institution.id, payload })
      : createMutation.mutateAsync(payload)

    void saved.then(async (savedInstitution) => {
      await minimumLoading
      onSaved(savedInstitution)
    }).catch(async (error) => {
      await minimumLoading
      setSubmitError(error instanceof ApiError ? error.message : 'Something went wrong.')
      setSaveInProgress(false)
    })
  }

  const showError = (field: InstitutionField) => touched[field] && fieldErrors[field]

  return (
    <ModalTitledPanel
      open={open}
      level="stacked"
      titleId="institution-modal-title"
      eyebrow={isCorrection ? 'Institution details' : 'Account setup'}
      title={isCorrection ? 'Correct Institution' : 'Add Institution'}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <ModalFormFooter
          submitLabel={isCorrection ? 'Save' : 'Create'}
          submitDisabled={isSaving}
          submitWidthClassName="w-full sm:w-32"
          level="stacked"
          onCancel={onClose}
        />
      }
    >
      <div className="space-y-5">
        {isCorrection && (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Everyone on this server picks from the same list, so a correction changes this
            institution for all of them.
          </p>
        )}

        <CreateModalSectionFrame step="01">
          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

            <div>
              <CreateModalFieldLabelRow htmlFor={INSTITUTION_FIELD_IDS.name} label="Name" error={showError('name') || undefined} />
              <input
                id={INSTITUTION_FIELD_IDS.name}
                type="text"
                className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                value={form.name}
                onChange={(event) => handleChange('name', event.target.value)}
                onBlur={() => handleBlur('name')}
                maxLength={256}
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor={INSTITUTION_FIELD_IDS.country} label="Country" error={showError('country_code') || undefined} />
              <Dropdown
                id={INSTITUTION_FIELD_IDS.country}
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
              <CreateModalFieldLabelRow htmlFor={INSTITUTION_FIELD_IDS.website} label="Website" error={showError('website') || undefined} />
              <input
                id={INSTITUTION_FIELD_IDS.website}
                type="url"
                className={`app-input ${showError('website') ? 'app-input-error' : ''}`}
                placeholder="https://example.com"
                value={form.website}
                onChange={(event) => handleChange('website', event.target.value)}
                onBlur={() => handleBlur('website')}
              />
              <p className="mt-1.5 text-xs italic" style={{ color: 'var(--app-text-subtle)' }}>
                The logo is taken from this address.
              </p>
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
