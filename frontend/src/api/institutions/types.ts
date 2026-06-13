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
