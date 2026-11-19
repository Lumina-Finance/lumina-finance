// The logos of the self-hosted sign-in providers the app ships, keyed by the lowercase-hyphen slug of
// the provider's name. Kept as separate files, never inlined into the page as data, so a page that
// shows no provider downloads none of them
const LOGO_URLS_BY_PATH = import.meta.glob<string>('@/assets/provider-logos/*.webp', {
  eager: true,
  query: '?no-inline',
  import: 'default',
})

const LOGO_URLS_BY_SLUG = new Map(
  Object.entries(LOGO_URLS_BY_PATH).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1).replace(/\.webp$/, ''),
    url,
  ]),
)

/**
 * Returns the slug a provider's display name is matched to a logo by, or empty when there is nothing to match
 */
function toProviderSlug(name: string | undefined): string {
  if (!name) return ''
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Returns the address, on the app's own server, of the logo shipped for a provider's display name, or
 * null when none matches, so the caller draws the globe
 */
export function getProviderLogoUrl(name: string | undefined): string | null {
  return LOGO_URLS_BY_SLUG.get(toProviderSlug(name)) ?? null
}
