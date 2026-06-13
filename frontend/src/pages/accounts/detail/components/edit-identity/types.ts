import type { IdentityFormValues } from '@/pages/accounts/detail/utils/identityForm'

export type DeleteStage = 'idle' | 'confirm' | 'type-name'

export type SetIdentityFormField = <K extends keyof IdentityFormValues>(
  field: K,
  value: IdentityFormValues[K],
) => void
