export type {
  CreateInstitutionPayload,
  Institution,
} from '@/api/institutions/types';

export {
  createInstitution,
  fetchInstitutions,
} from '@/api/institutions/requests';

export {
  useCreateInstitution,
  useInstitutions,
} from '@/api/institutions/hooks';
