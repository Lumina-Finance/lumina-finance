import { INSTITUTION_ADDRESS_MAX_LENGTH } from '@/api/institutions'

export type InstitutionForm = {
  name: string
  country_code: string
  website: string
}

export type InstitutionField = keyof InstitutionForm
export type InstitutionFieldErrors = Partial<Record<InstitutionField, string>>

export const INSTITUTION_WEBSITE_NOT_HTTPS_MESSAGE = 'Website address must start with https://'
export const INSTITUTION_WEBSITE_TOO_LONG_MESSAGE = 'Website address is too long'

const HTTPS_PREFIX = /^https:\/\//i

/**
 * Validates the institution fields the backend requires on both write paths, so the website a
 * correction shares with every user is one the backend accepts
 */
export function validateInstitutionForm(form: InstitutionForm): InstitutionFieldErrors {
  const errors: InstitutionFieldErrors = {}
  const website = form.website.trim()
  if (!form.name.trim()) errors.name = 'Name is required'
  if (!form.country_code) errors.country_code = 'Select a country'
  if (!website) errors.website = 'Website is required'
  // Counted in code points, as the backend counts them
  else if ([...website].length > INSTITUTION_ADDRESS_MAX_LENGTH) errors.website = INSTITUTION_WEBSITE_TOO_LONG_MESSAGE
  else if (!HTTPS_PREFIX.test(website)) errors.website = INSTITUTION_WEBSITE_NOT_HTTPS_MESSAGE
  return errors
}
