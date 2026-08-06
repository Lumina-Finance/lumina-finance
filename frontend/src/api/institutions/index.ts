export type {
  CreateInstitutionPayload,
  Institution,
  UpdateInstitutionPayload,
  UpdateInstitutionRequest,
} from '@/api/institutions/types';

export {
  createInstitution,
  fetchInstitutions,
  updateInstitution,
} from '@/api/institutions/requests';

export {
  useCreateInstitution,
  useInstitutions,
  useUpdateInstitution,
} from '@/api/institutions/hooks';
