import type { DropdownOption } from '@/components/dropdown/Dropdown'
import Dropdown from '@/components/dropdown/Dropdown'
import { EDIT_ACCOUNT_IDENTITY_FIELD_IDS } from '@/pages/accounts/detail/constants/accountDetail'
import type {
  IdentityFieldErrors,
  IdentityFormValues,
} from '@/pages/accounts/detail/utils/identityForm'
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
 * Renders account name and institution controls for the identity section
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
        <AccountIdentityFieldLabelRow htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name} label="Account Name" error={fieldErrors.name} />
        <input
          id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.name}
          className={`app-input ${fieldErrors.name ? 'app-input-error' : ''}`}
          value={form.name}
          onChange={(event) => setField('name', event.target.value)}
          maxLength={256}
        />
      </div>

      <div>
        <AccountIdentityFieldLabelRow label="Institution" />
        <Dropdown
          id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.institution}
          options={institutionOptions}
          value={form.institution_id}
          onChange={(value) => setField('institution_id', value)}
          placeholder="Select institution..."
          searchable
          searchPlaceholder="Search institutions..."
          onCreateNew={onCreateInstitution}
          createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
          onEditOption={onCorrectInstitution}
          editOptionLabel="Correct institution"
        />
      </div>
    </EditModalSection>
  )
}
