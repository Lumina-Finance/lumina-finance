import { useState } from 'react'
import { Globe } from 'lucide-react'
import { GoogleGMark } from '@/components/GoogleGMark'

// Google's slug is fixed by the backend preset and selects its brand-mandated mark
export const GOOGLE_PROVIDER_SLUG = 'google'

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
 * Renders a neutral globe as the generic-provider fallback
 */
function GlobeMark({ size }: { size: number }) {
  return <Globe size={size} aria-hidden style={{ color: 'var(--app-text-muted)' }} />
}

/**
 * Renders a generic provider's self-hosted app logo, falling back to the globe
 *
 * The icon is fetched from the selfh.st CDN by the provider's display name, so an operator who
 * names their provider after its app gets its logo for free. A missing match or a failed load
 * (offline, blocked, unknown app) resolves to the globe, so the button is never broken
 */
function GenericProviderMark({ name, size }: { name: string | undefined; size: number }) {
  const [failed, setFailed] = useState(false)
  const iconSlug = toIconSlug(name)

  if (!iconSlug || failed) {
    return <GlobeMark size={size} />
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
    />
  )
}

/**
 * Renders the mark for a sign-in provider: the official G for Google, and for a generic provider
 * its self-hosted app logo matched by display name with a globe fallback. Shared by the login
 * buttons and the settings list
 */
export function ProviderMark({ slug, name, size = 16 }: { slug: string; name?: string; size?: number }) {
  if (slug === GOOGLE_PROVIDER_SLUG) {
    return <GoogleGMark size={size} />
  }
  return <GenericProviderMark name={name} size={size} />
}
