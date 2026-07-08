import { useState } from 'react'
import { Globe } from 'lucide-react'
import { beginOidcSignIn, type OidcProvider } from '@/api/oidc'
import { GoogleGMark } from '@/pages/auth/components/GoogleGMark'

// Google's slug is fixed by the backend preset and selects its brand-mandated G mark
const GOOGLE_PROVIDER_SLUG = 'google'

interface OidcProviderButtonsProps {
  providers: OidcProvider[]
}

/**
 * Renders one sign-in button per provider and hands the browser to the provider on click
 *
 * A pending click disables every button so a slow authorize response cannot start two
 * roundtrips, and the pending state is kept after the redirect begins because the page
 * is navigating away
 */
export function OidcProviderButtons({ providers }: OidcProviderButtonsProps) {
  const [pendingSlug, setPendingSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleProviderClick = async (slug: string) => {
    setPendingSlug(slug)
    setError(null)
    try {
      const { authorization_url } = await beginOidcSignIn(slug)
      window.location.assign(authorization_url)
    } catch {
      setError('Could not reach the sign-in provider. Try again.')
      setPendingSlug(null)
    }
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <div key={provider.slug} className="flex justify-center">
          <button
            type="button"
            onClick={() => handleProviderClick(provider.slug)}
            disabled={pendingSlug !== null}
            className={`app-secondary-button transition-all duration-300 ${
              pendingSlug === provider.slug
                ? 'app-primary-button-loading'
                : 'flex w-full items-center justify-center gap-2'
            }`}
          >
            {pendingSlug === provider.slug ? (
              <div className="app-spinner" />
            ) : (
              <>
                {provider.slug === GOOGLE_PROVIDER_SLUG ? <GoogleGMark /> : <Globe size={16} aria-hidden />}
                Continue with {provider.display_name}
              </>
            )}
          </button>
        </div>
      ))}

      {error && (
        <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
