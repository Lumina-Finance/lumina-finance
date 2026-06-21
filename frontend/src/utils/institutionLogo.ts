import type { Institution } from '@/api/institutions'

// Google favicon service used as the logo source when an institution has no uploaded logo
const FAVICON_SERVICE_BASE =
  'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL'

const FAVICON_SIZE = 256

/**
 * Resolves the best logo source for an institution, preferring an uploaded logo and otherwise
 * deriving a favicon from the institution website, returning null when neither is available
 */
export function resolveInstitutionLogoUrl(institution: Institution | null | undefined): string | null {
  if (institution?.logo_url) return institution.logo_url
  if (!institution?.website) return null
  return `${FAVICON_SERVICE_BASE}&url=${encodeURIComponent(institution.website)}&size=${FAVICON_SIZE}`
}
