export type {
  CreateInstitutionPayload,
  Institution,
  UpdateInstitutionPayload,
  UpdateInstitutionRequest,
} from '@/api/institutions/types'

export { INSTITUTION_ADDRESS_MAX_LENGTH } from '@/api/institutions/types'

export { createInstitution, fetchInstitutions, updateInstitution } from '@/api/institutions/requests'

export { useCreateInstitution, useInstitutions, useUpdateInstitution } from '@/api/institutions/hooks'
