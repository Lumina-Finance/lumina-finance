import type { DropdownOption } from '@/components/dropdown/Dropdown'
import Dropdown from '@/components/dropdown/Dropdown'
import { EDIT_ACCOUNT_IDENTITY_FIELD_IDS } from '@/pages/accounts/detail/constants/accountDetail'
import type { IdentityFieldErrors, IdentityFormValues } from '@/pages/accounts/detail/utils/identityForm'
import type { SetIdentityFormField } from '@/pages/accounts/detail/components/edit-identity/types'
import { EditModalSection } from '@/pages/accounts/detail/components/edit-identity/layout/Section'
import { AccountIdentityFieldLabelRow } from '@/pages/accounts/detail/components/edit-identity/controls/FieldLabelRow'

type AccountIdentitySectionProps = {
  form: IdentityFormValues
  fieldErrors: IdentityFieldErrors
  institutionOptions: DropdownOption[]
  setField: SetIdentityFormField
  onCreateInstitution: (name: string) => void
  onCorrectInstitution: (institutionId: string) => void
}

/**
 * Renders account name, institution and notes controls for the identity section
 */
export function AccountIdentitySection({
  form,
  fieldErrors,
  institutionOptions,
  setField,
  onCreateInstitution,
  onCorrectInstitution,
}: AccountIdentitySectionProps) {
  return (
    <EditModalSection number="01" title="Identity">
      <div>
        <AccountIdentityFieldLabelRow
          htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name}
          label="Account name"
          error={fieldErrors.name}
          errorId={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.nameError}
        />
        <input
          id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name}
          className={`app-input ${fieldErrors.name ? 'app-input-error' : ''}`}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? EDIT_ACCOUNT_IDENTITY_FIELD_IDS.nameError : undefined}
          value={form.name}
          onChange={(event) => setField('name', event.target.value)}
          maxLength={256}
        />
      </div>

      <div>
        <AccountIdentityFieldLabelRow htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.institution} label="Institution" />
        <Dropdown
          id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.institution}
          options={institutionOptions}
          value={form.institution_id}
          onChange={(value) => setField('institution_id', value)}
          placeholder="Select institution..."
          searchable
          searchPlaceholder="Search institutions..."
          onCreateNew={onCreateInstitution}
          createNewLabel={(query) => (query ? `Create institution "${query}"` : 'Create institution')}
          onEditOption={onCorrectInstitution}
          editOptionLabel="Correct institution"
        />
      </div>

      <div>
        <AccountIdentityFieldLabelRow
          htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.notes}
          label="Notes"
          error={fieldErrors.notes}
          errorId={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.notesError}
        />
        <textarea
          id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.notes}
          className={`app-input h-auto resize-none py-2 ${fieldErrors.notes ? 'app-input-error' : ''}`}
          aria-invalid={fieldErrors.notes ? true : undefined}
          aria-describedby={fieldErrors.notes ? EDIT_ACCOUNT_IDENTITY_FIELD_IDS.notesError : undefined}
          placeholder="Optional"
          rows={3}
          value={form.notes}
          onChange={(event) => setField('notes', event.target.value)}
        />
      </div>
    </EditModalSection>
  )
}
