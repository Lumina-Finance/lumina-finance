import type { DropdownOption } from '@/components/Dropdown'
import Dropdown from '@/components/Dropdown'
import type {
  IdentityFieldErrors,
  IdentityFormValues,
} from '@/accounts/detail/utils/identityForm'
import type { SetIdentityFormField } from './types'
import { EditModalSection } from './EditModalSection'
import { FieldLabelRow } from './FieldLabelRow'

type IdentitySectionProps = {
  form: IdentityFormValues
  fieldErrors: IdentityFieldErrors
  institutionOptions: DropdownOption[]
  setField: SetIdentityFormField
  onCreateInstitution: (name: string) => void
}

/**
 * Renders account name and institution controls for the identity section
 */
export function IdentitySection({
  form,
  fieldErrors,
  institutionOptions,
  setField,
  onCreateInstitution,
}: IdentitySectionProps) {
  return (
    <EditModalSection number="01" title="Identity">
      <div>
        <FieldLabelRow htmlFor="edit-account-name" label="Account Name" error={fieldErrors.name} />
        <input
          id="edit-account-name"
          className={`app-input ${fieldErrors.name ? 'app-input-error' : ''}`}
          value={form.name}
          onChange={(event) => setField('name', event.target.value)}
          maxLength={256}
        />
      </div>

      <div>
        <FieldLabelRow label="Institution" />
        <Dropdown
          options={institutionOptions}
          value={form.institution_id}
          onChange={(value) => setField('institution_id', value)}
          placeholder="Select institution..."
          searchable
          searchPlaceholder="Search institutions..."
          onCreateNew={onCreateInstitution}
          createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
        />
      </div>
    </EditModalSection>
  )
}
