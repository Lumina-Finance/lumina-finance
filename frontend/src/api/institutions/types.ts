export interface Institution {
  id: string;
  status: string;
  name: string;
  country_code: string;
  website: string;
  logo_url: string | null;
}

export interface CreateInstitutionPayload {
  name: string;
  country_code: string;
  website: string;
}

/**
 * Fields a correction changes. Anything left out keeps its stored value, while an explicit
 * null on logo_url clears the stored logo
 */
export interface UpdateInstitutionPayload {
  name?: string;
  country_code?: string;
  website?: string;
  logo_url?: string | null;
}

export interface UpdateInstitutionRequest {
  institutionId: string;
  payload: UpdateInstitutionPayload;
}
