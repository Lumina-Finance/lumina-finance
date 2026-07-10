import { useState } from 'react'
import { Globe } from 'lucide-react'

// selfh.st hosts a large catalogue of self-hosted app icons keyed by a lowercase-hyphen slug, so a
// generic provider named after its app (Authentik, Authelia, ...) can borrow its real logo
const SELFHST_ICON_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons/png'

/**
 * Returns the selfh.st icon slug for a provider display name, or empty when there is nothing to match
 */
function toIconSlug(name: string | undefined): string {
  if (!name) return ''
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Renders the mark for a sign-in provider: its self-hosted app logo matched from the display name,
 * with a neutral globe fallback. Shared by the login buttons and the settings list
 *
 * The icon is fetched from the selfh.st CDN by the provider's display name, so an operator who names
 * their provider after its app gets its logo for free. A missing match or a failed load (offline,
 * blocked, unknown app) resolves to the globe, so the button is never broken
 */
export function ProviderMark({ name, size = 16 }: { name?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const iconSlug = toIconSlug(name)

  if (!iconSlug || failed) {
    return <Globe size={size} aria-hidden style={{ color: 'var(--app-text-muted)' }} />
  }

  return (
    <img
      src={`${SELFHST_ICON_BASE}/${iconSlug}.png`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
      onError={() => setFailed(true)}
      aria-hidden
      // The CDN is third party, so no-referrer keeps the self-hosted instance origin out of its logs
      referrerPolicy="no-referrer"
    />
  )
}
