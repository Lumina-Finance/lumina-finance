export interface Institution {
  id: string
  status: string
  name: string
  country_code: string
  website: string
  logo_url: string | null
}

/**
 * Characters an institution's website and logo address may hold, matching the backend
 */
export const INSTITUTION_ADDRESS_MAX_LENGTH = 2048

/**
 * Institutions a list request returns at most, and how many it returns when the request names no
 * size, matching the backend. The table is shared by every user, so it is only ever read a page at
 * a time
 */
export const INSTITUTION_PAGE_SIZE = 50

export interface InstitutionFilters {
  /** Text the institution's name must contain, ignoring case */
  q?: string
}

export interface CreateInstitutionPayload {
  name: string
  country_code: string
  website: string
}

/**
 * Fields a correction changes. Anything left out keeps its stored value, while an explicit
 * null on logo_url clears the stored logo
 */
export interface UpdateInstitutionPayload {
  name?: string
  country_code?: string
  website?: string
  logo_url?: string | null
}

export interface UpdateInstitutionRequest {
  institutionId: string
  payload: UpdateInstitutionPayload
}
