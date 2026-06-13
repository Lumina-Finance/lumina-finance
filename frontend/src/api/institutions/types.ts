export type { Institution } from '@/api/accounts';

export interface CreateInstitutionPayload {
  name: string;
  country_code: string;
  website: string;
}
