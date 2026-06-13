import type { IdentityFormValues } from '@/accounts/detail/utils/identityForm'

export type DeleteStage = 'idle' | 'confirm' | 'type-name'

export type SetIdentityFormField = <K extends keyof IdentityFormValues>(
  field: K,
  value: IdentityFormValues[K],
) => void
