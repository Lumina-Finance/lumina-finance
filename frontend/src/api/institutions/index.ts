export type {
  CreateInstitutionPayload,
  Institution,
  InstitutionFilters,
  UpdateInstitutionPayload,
  UpdateInstitutionRequest,
} from '@/api/institutions/types'

export { INSTITUTION_ADDRESS_MAX_LENGTH, INSTITUTION_PAGE_SIZE } from '@/api/institutions/types'

export {
  createInstitution,
  fetchInstitution,
  fetchInstitutionsPage,
  updateInstitution,
} from '@/api/institutions/requests'

export {
  useCreateInstitution,
  useInfiniteInstitutions,
  useInstitution,
  useInstitutionsById,
  useUpdateInstitution,
} from '@/api/institutions/hooks'
