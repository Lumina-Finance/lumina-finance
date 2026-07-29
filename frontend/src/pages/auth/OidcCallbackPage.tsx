import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError } from '@/api/auth'
import { useCurrencies } from '@/api/currency'
import {
  completeOidcCallback,
  completeOidcLinkCallback,
  completeOidcReauthCallback,
  completeOidcSignup,
  isOidcOnboardingRequired,
  OidcEmailConflictError,
  useRefreshOidcIdentities,
  type OidcOnboardingResponse,
} from '@/api/oidc'
import Dropdown from '@/components/dropdown/Dropdown'
import LoadingScreen from '@/components/loading/Screen'
import { useAuth } from '@/hooks/useAuth'
import { AuthTextField } from '@/pages/auth/components/fields/TextField'
import { AUTH_VIEW_TRANSITION } from '@/pages/auth/constants/authAnimations'
import { consumeOidcIntent, type OidcSignedInIntent } from '@/utils/oidcIntent'
import { buildCurrencyOptions, getCurrencyPlaceholder } from '@/pages/auth/utils/authForm'
import { getBrowserTimeZone } from '@/utils/date'

const DETECTED_TZ = getBrowserTimeZone()

const TIMEZONES = Intl.supportedValuesOf('timeZone').map((tz) => ({
  value: tz,
  label: tz.replace(/_/g, ' '),
}))

// The provider supplies the email, so it is shown dimmed to read as fixed rather than editable
const IMMUTABLE_FIELD_STYLE: CSSProperties = { opacity: 0.55, cursor: 'not-allowed' }

/**
 * Finishes a provider sign-in from the callback query parameters
 *
 * The completing state shows the app's boot loading screen, and its exit fade reveals
 * either the onboarding form for a first-time sign-in or the failure view, both entering
 * with the auth page's view swap. Leaving for the login page animates out first
 */
const OidcCallbackPage = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const refreshOidcIdentities = useRefreshOidcIdentities()
  const { user, loading, setSession } = useAuth()

  const [onboarding, setOnboarding] = useState<OidcOnboardingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflictEmail, setConflictEmail] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  // A completed sign-in sets the user while this page is still mounted for the route
  // transition, so the flag keeps the caption from reinterpreting the arrival as a link
  const [signInCompleted, setSignInCompleted] = useState(false)

  // What a signed-in return is for, captured once since the flag is read and cleared on mount
  const [signedInIntent] = useState<OidcSignedInIntent | null>(() => consumeOidcIntent())
  const isReauth = user !== null && signedInIntent?.flow === 'reauth'

  // The stored roundtrip is single use on the server, so the strict-mode double effect
  // must not post the callback twice
  const callbackStartedRef = useRef(false)

  // Provider-reported failures and malformed URLs are terminal states known at render
  // time, derived here so the effect never sets state synchronously. The wording follows
  // the audience, since a signed-in arrival is linking rather than signing in
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const signedInAction = isReauth ? 'Re-confirmation' : 'Linking'
  const paramError = searchParams.get('error')
    ? user
      ? `${signedInAction} was cancelled or refused by the provider.`
      : 'Sign-in was cancelled or refused by the provider.'
    : !code || !state
      ? user
        ? 'The request is incomplete. Start again from your security settings.'
        : 'The sign-in link is incomplete. Start again from the login page.'
      : null
  const displayError = error ?? paramError

  useEffect(() => {
    // The session must finish restoring first, because it decides whether this callback
    // completes a link for the signed-in account or an anonymous sign-in
    if (loading || callbackStartedRef.current || paramError) return
    if (!code || !state) return
    callbackStartedRef.current = true

    if (user && signedInIntent?.flow === 'reauth') {
      const { action } = signedInIntent
      completeOidcReauthCallback({ code, state })
        .then(() => {
          // The reauth armed the step-up proof, so settings resumes the action it was started for
          if (action.kind === 'set-password') {
            navigate('/settings', { replace: true, state: { setPassword: true } })
          } else if (action.kind === 'link') {
            navigate('/settings', { replace: true, state: { resumeLink: action.slug } })
          } else {
            navigate('/settings', { replace: true, state: { resumeUnlink: action.identityId } })
          }
        })
        .catch((reauthError: Error) => {
          const isGenericAuthFailure = reauthError instanceof ApiError && reauthError.status === 401
          setError(
            isGenericAuthFailure
              ? 'Re-confirmation could not be completed. It may have expired, so start again from your security settings.'
              : reauthError.message || 'Re-confirmation failed.',
          )
        })
      return
    }

    if (user) {
      completeOidcLinkCallback({ code, state })
        .then(async (identity) => {
          await refreshOidcIdentities()

          // The linked slug rides along so the settings page can scroll to and highlight it
          navigate('/settings', { replace: true, state: { linkedProvider: identity.provider_slug } })
        })
        .catch((linkError: Error) => {
          const isGenericAuthFailure = linkError instanceof ApiError && linkError.status === 401
          setError(
            isGenericAuthFailure
              ? 'The link could not be completed. It may have expired, so start again from your security settings.'
              : linkError.message || 'Linking failed.',
          )
        })
      return
    }

    completeOidcCallback({ code, state })
      .then((result) => {
        if (isOidcOnboardingRequired(result)) {
          setOnboarding(result)
          return
        }

        // This route lives outside the public-only wrapper, so committing the session no
        // longer triggers a redirect and the page must leave for the app itself
        setSignInCompleted(true)
        setSession(result)
        navigate('/', { replace: true })
      })
      .catch((callbackError: Error) => {
        // A conflicting account is a recoverable outcome offering a password sign-in,
        // unlike the terminal failure view every other error lands on
        if (callbackError instanceof OidcEmailConflictError) {
          setConflictEmail(callbackError.email)
          return
        }
        setError(callbackError.message || 'Single sign-on failed.')
      })
  }, [loading, user, signedInIntent, code, state, paramError, setSession, navigate, refreshOidcIdentities])

  // The loading screen also covers session restore, so the failure view never renders
  // with one audience's wording and then flips to the other's
  const completing = loading || (!displayError && !onboarding && !conflictEmail)

  const handleBackToLogin = () => {
    setLeaving(true)
  }

  return (
    <div
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      <AnimatePresence>
        {completing && (
          <LoadingScreen
            message={
              user && !signInCompleted
                ? isReauth
                  ? 'Re-confirming your identity'
                  : 'Linking sign-in provider'
                : 'Completing sign-in'
            }
          />
        )}
      </AnimatePresence>

      <div className="w-full max-w-sm">
        <AnimatePresence
          mode="wait"
          onExitComplete={() => {
            // The conflicting address rides along so the login form starts prefilled, and a
            // signed-in link failure returns to settings instead
            if (!leaving) return
            if (user) {
              navigate('/settings')
            } else {
              navigate('/login', conflictEmail ? { state: { prefillEmail: conflictEmail } } : undefined)
            }
          }}
        >
          {displayError && !leaving && (
            <motion.div key="sign-in-failed" {...AUTH_VIEW_TRANSITION}>
              <h1 className="font-serif text-4xl font-normal tracking-tight">
                {user ? (isReauth ? 'Re-confirmation failed' : 'Linking failed') : 'Sign-in failed'}
              </h1>
              <p className="mt-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {displayError}
              </p>
              <p className="mt-5 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
                <button
                  type="button"
                  onClick={handleBackToLogin}
                  className="font-medium underline underline-offset-2 transition-colors duration-200"
                  style={{ color: 'var(--app-accent)' }}
                >
                  {user ? 'Back to settings' : 'Back to login'}
                </button>
              </p>
            </motion.div>
          )}

          {conflictEmail && !leaving && (
            <motion.div key="account-exists" {...AUTH_VIEW_TRANSITION}>
              <h1 className="font-serif text-4xl font-normal tracking-tight">Account already exists</h1>
              <p className="mt-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                An account with {conflictEmail} already exists. Sign in with your password, then
                link this provider from your security settings to use it next time.
              </p>
              <div className="mt-5 flex justify-center">
                <button type="button" onClick={handleBackToLogin} className="app-primary-button w-full">
                  Sign in with password
                </button>
              </div>
            </motion.div>
          )}

          {onboarding && !leaving && (
            <motion.div key="onboarding" {...AUTH_VIEW_TRANSITION}>
              <OidcOnboardingForm onboarding={onboarding} onBackToLogin={handleBackToLogin} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

interface OidcOnboardingFormProps {
  onboarding: OidcOnboardingResponse
  onBackToLogin: () => void
}

/**
 * Collects the profile fields a brand-new account needs and completes the signup
 *
 * The provider verified who the user is, so only their name is editable alongside the
 * base currency and timezone the app cannot learn from the provider
 */
function OidcOnboardingForm({ onboarding, onBackToLogin }: OidcOnboardingFormProps) {
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const { data: currencies = [], isError: currenciesError } = useCurrencies()

  const [firstName, setFirstName] = useState(onboarding.first_name)
  const [lastName, setLastName] = useState(onboarding.last_name ?? '')
  const [baseCurrency, setBaseCurrency] = useState('')
  const [tz, setTz] = useState(DETECTED_TZ)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitDisabled = submitting || !firstName.trim() || !baseCurrency

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitDisabled) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await completeOidcSignup({
        onboarding_token: onboarding.onboarding_token,
        first_name: firstName.trim(),
        last_name: lastName.trim() || undefined,
        tz,
        base_currency: baseCurrency,
      })

      // The route sits outside the public-only wrapper, so the new session must be
      // followed by an explicit move into the app
      setSession(response)
      navigate('/', { replace: true })
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : 'Could not finish signing up.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--app-text)' }}>
        Finish setting up
      </h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
        A few details to finish your account.
      </p>

      {error && (
        <p className="mt-4 text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}

      <div className="mt-5 space-y-1.5">
        <label htmlFor="email" className="app-label block">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="app-input"
          value={onboarding.email}
          disabled
          style={IMMUTABLE_FIELD_STYLE}
        />
      </div>

      <div className="mt-5">
        <AuthTextField
          id="first_name"
          label="First name"
          autoComplete="given-name"
          value={firstName}
          onChange={setFirstName}
        />
      </div>

      <div className="mt-5">
        <AuthTextField
          id="last_name"
          label="Last name (optional)"
          autoComplete="family-name"
          value={lastName}
          onChange={setLastName}
        />
      </div>

      <div className="mt-5 space-y-1.5">
        <label htmlFor="base_currency" className="app-label block">
          Base currency
        </label>
        <Dropdown
          id="base_currency"
          options={buildCurrencyOptions(currencies)}
          value={baseCurrency}
          onChange={setBaseCurrency}
          placeholder={getCurrencyPlaceholder(currenciesError, currencies.length)}
          searchable
          searchPlaceholder="Search currencies..."
        />
      </div>

      <div className="mt-5 space-y-1.5">
        <label htmlFor="tz" className="app-label block">
          Timezone
        </label>
        <Dropdown
          id="tz"
          options={TIMEZONES}
          value={tz}
          onChange={setTz}
          searchable
          searchPlaceholder="Search timezones..."
        />
      </div>

      <div className="mt-6 flex justify-center">
        <button
          type="submit"
          disabled={submitDisabled}
          className={`app-primary-button transition-all duration-300 ${
            submitting ? 'app-primary-button-loading' : 'w-full'
          }`}
        >
          {submitting ? <div className="app-spinner" /> : 'Create account'}
        </button>
      </div>

      <p className="mt-5 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
        Wrong account?{' '}
        <button
          type="button"
          onClick={onBackToLogin}
          className="font-medium underline underline-offset-2 transition-colors duration-200"
          style={{ color: 'var(--app-accent)' }}
        >
          Back to login
        </button>
      </p>
    </form>
  )
}

export default OidcCallbackPage
