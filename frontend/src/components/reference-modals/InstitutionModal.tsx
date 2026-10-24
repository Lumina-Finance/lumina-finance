import { useState, type FormEvent } from 'react'
import { Building2 } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCreateInstitution, useUpdateInstitution, type Institution } from '@/api/institutions'
import Dropdown from '@/components/dropdown/Dropdown'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { FormError } from '@/components/forms/FormError'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import {
  INSTITUTION_CONTROL_IDS,
  INSTITUTION_FIELD_IDS,
  INSTITUTION_FIELDS,
} from '@/components/reference-modals/institutionModalConstants'
import { COUNTRY_OPTIONS } from '@/constants/countries'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'

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
  const [submitError, setSubmitError] = useState('')
  const [saveInProgress, setSaveInProgress] = useState(false)
  const isSaving = createMutation.isPending || updateMutation.isPending || saveInProgress
  const refusal = useRefusedSubmit(validateInstitutionForm(form), INSTITUTION_FIELDS, INSTITUTION_CONTROL_IDS)
  const errors = refusal.errors

  const handleChange = (field: InstitutionField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setSubmitError('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving || !refusal.guard()) return

    setSaveInProgress(true)
    const minimumLoading = waitForMilliseconds(LOADING_ANIMATION_MIN_MS)
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

  return (
    <ModalTitledPanel
      open={open}
      level="stacked"
      titleId="institution-modal-title"
      eyebrow="Account setup"
      title={isCorrection ? 'Correct institution' : 'Add institution'}
      RailIcon={Building2}
      railLabel={isCorrection ? 'Details' : 'New'}
      onClose={onClose}
      onSubmit={handleSubmit}

      // A save that outlives its modal still runs its callback, which would write into
      // whatever the field is showing by then, so dismissing is locked while it is in flight
      // exactly as cancelling already is
      closeDisabled={isSaving}
      footer={
        <ModalFormFooter
          submitLabel={isCorrection ? 'Save' : 'Create'}
          submitDisabled={isSaving}
          submitBlockedReason={refusal.blockedReason}
          submitWidthClassName="w-full sm:w-32"
          level="stacked"
          onCancel={onClose}
        />
      }
    >
      <div className="space-y-5">
        {isCorrection && (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            The institution's details don't look right? You can update it here.
          </p>
        )}

        <CreateModalSectionFrame step="01">
          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

            <div>
              <CreateModalFieldLabelRow htmlFor={INSTITUTION_FIELD_IDS.name} label="Name" error={errors.name} errorId={INSTITUTION_FIELD_IDS.nameError} />
              <input
                id={INSTITUTION_FIELD_IDS.name}
                type="text"
                className={`app-input ${errors.name ? 'app-input-error' : ''}`}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? INSTITUTION_FIELD_IDS.nameError : undefined}
                value={form.name}
                onChange={(event) => handleChange('name', event.target.value)}
                onBlur={() => refusal.touch('name')}
                maxLength={256}
              />
            </div>

            <div>
              <CreateModalFieldLabelRow htmlFor={INSTITUTION_FIELD_IDS.country} label="Country" error={errors.country_code} errorId={INSTITUTION_FIELD_IDS.countryError} />
              <Dropdown
                id={INSTITUTION_FIELD_IDS.country}
                options={COUNTRY_OPTIONS}
                value={form.country_code}
                onChange={(value) => handleChange('country_code', value)}
                hasError={Boolean(errors.country_code)}
                describedBy={errors.country_code ? INSTITUTION_FIELD_IDS.countryError : undefined}
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
              <CreateModalFieldLabelRow htmlFor={INSTITUTION_FIELD_IDS.website} label="Website" error={errors.website} errorId={INSTITUTION_FIELD_IDS.websiteError} />
              <input
                id={INSTITUTION_FIELD_IDS.website}
                type="url"
                className={`app-input ${errors.website ? 'app-input-error' : ''}`}
                aria-invalid={errors.website ? true : undefined}
                aria-describedby={errors.website ? INSTITUTION_FIELD_IDS.websiteError : undefined}
                placeholder="https://example.com"
                value={form.website}
                onChange={(event) => handleChange('website', event.target.value)}
                onBlur={() => refusal.touch('website')}
              />
            </div>
          </div>
        </CreateModalSectionFrame>

        <FormError message={submitError} />
      </div>
    </ModalTitledPanel>
  )
}
