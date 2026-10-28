export const INSTITUTION_FIELD_IDS = {
  name: 'inst-name',
  nameError: 'inst-name-error',
  country: 'inst-country',
  countryError: 'inst-country-error',
  website: 'inst-website',
  websiteError: 'inst-website-error',
} as const

// The fields in the order the modal draws them
export const INSTITUTION_FIELDS = ['name', 'country_code', 'website'] as const

// The control that takes focus for each field, which for the country is the dropdown's trigger
export const INSTITUTION_CONTROL_IDS = {
  name: INSTITUTION_FIELD_IDS.name,
  country_code: INSTITUTION_FIELD_IDS.country,
  website: INSTITUTION_FIELD_IDS.website,
} as const
