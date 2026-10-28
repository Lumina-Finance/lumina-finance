import { useEffect, useRef, useState } from 'react'
import { beginOidcSignIn, type OidcProvider } from '@/api/oidc'
import { ProviderMark } from '@/components/ProviderMark'
import { withMinDelay } from '@/utils/timing'

interface OidcProviderButtonsProps {
  providers: OidcProvider[]
  /** A provider to start at once, for a native app whose own provider button opened this page */
  autoStartSlug?: string | null
}

/**
 * Renders one sign-in button per provider and hands the browser to the provider on click
 *
 * A pending click disables every button so a slow authorize response cannot start two
 * roundtrips, and the pending state is kept after the redirect begins because the page
 * is navigating away
 */
export function OidcProviderButtons({ providers, autoStartSlug }: OidcProviderButtonsProps) {
  // The app already showed the user its own button for this provider, so the page goes straight on,
  // already showing that button's spinner. An unknown slug leaves the buttons for the user to choose
  const [autoStart] = useState(() =>
    autoStartSlug && providers.some((provider) => provider.slug === autoStartSlug) ? autoStartSlug : null,
  )
  const [pendingSlug, setPendingSlug] = useState<string | null>(autoStart)
  const [error, setError] = useState<string | null>(null)
  const autoStartedRef = useRef(false)

  const redirectToProvider = async (slug: string) => {
    try {
      const { authorization_url } = await withMinDelay(() => beginOidcSignIn(slug))
      window.location.assign(authorization_url)
    } catch {
      setError('Could not reach the sign-in provider. Try again.')
      setPendingSlug(null)
    }
  }

  const handleProviderClick = (slug: string) => {
    setPendingSlug(slug)
    setError(null)
    void redirectToProvider(slug)
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return
    autoStartedRef.current = true
    void redirectToProvider(autoStart)
  })

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <div key={provider.slug} className="flex justify-center">
          <button
            type="button"
            onClick={() => handleProviderClick(provider.slug)}
            disabled={pendingSlug !== null}
            className={`app-secondary-button ${
              pendingSlug === provider.slug
                ? 'app-primary-button-loading'
                : 'flex w-full items-center justify-center gap-2'
            }`}
          >
            {pendingSlug === provider.slug ? (
              <div className="app-spinner" />
            ) : (
              <>
                <ProviderMark name={provider.display_name} />
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
