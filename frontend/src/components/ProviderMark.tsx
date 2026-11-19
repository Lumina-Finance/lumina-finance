import { Globe } from 'lucide-react'
import { useUsableLogo } from '@/hooks/useUsableLogo'
import { getProviderLogoUrl } from '@/utils/providerLogo'

/**
 * Renders the mark for a sign-in provider: the logo the app ships for its display name, with a neutral
 * globe fallback. Shared by the login buttons and the settings list
 *
 * Only self-hosted identity providers have a shipped logo, matched by name, so an operator who names
 * their provider after its app gets its logo. Any other name, or a logo that fails to load, resolves
 * to the globe, so the button is never broken. The logo comes from the app's own server, so showing
 * it contacts no one else
 */
export function ProviderMark({ name, size = 16 }: { name?: string; size?: number }) {
  const logo = useUsableLogo(getProviderLogoUrl(name))

  if (!logo.src) {
    return <Globe size={size} aria-hidden style={{ color: 'var(--app-text-muted)' }} />
  }

  return (
    <img
      src={logo.src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
      {...logo.imageProps}
      aria-hidden
    />
  )
}
