import { Globe } from 'lucide-react'
import { GoogleGMark } from '@/components/GoogleGMark'

// Google's slug is fixed by the backend preset and selects its brand-mandated mark
export const GOOGLE_PROVIDER_SLUG = 'google'

/**
 * Renders the mark for a sign-in provider: the official G for Google and a neutral globe
 * for generic providers, shared by the login buttons and the settings list
 */
export function ProviderMark({ slug, size = 16 }: { slug: string; size?: number }) {
  if (slug === GOOGLE_PROVIDER_SLUG) {
    return <GoogleGMark size={size} />
  }
  return <Globe size={size} aria-hidden style={{ color: 'var(--app-text-muted)' }} />
}
