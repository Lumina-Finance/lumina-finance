import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useCurrencies } from '@/api/currency'
import {
  completeOidcCallback,
  completeOidcSignup,
  isOidcOnboardingRequired,
  OidcEmailConflictError,
  type OidcOnboardingResponse,
} from '@/api/oidc'
import Dropdown from '@/components/dropdown/Dropdown'
import LoadingScreen from '@/components/loading/Screen'
import { useAuth } from '@/hooks/useAuth'
import { AuthTextField } from '@/pages/auth/components/fields/TextField'
import { AUTH_VIEW_TRANSITION } from '@/pages/auth/constants/authAnimations'
import { buildCurrencyOptions, getCurrencyPlaceholder } from '@/pages/auth/utils/authForm'

const DETECTED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

const TIMEZONES = Intl.supportedValuesOf('timeZone').map((tz) => ({
  value: tz,
  label: tz.replace(/_/g, ' '),
}))

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
  const { setSession } = useAuth()

  const [onboarding, setOnboarding] = useState<OidcOnboardingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflictEmail, setConflictEmail] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  // The stored roundtrip is single use on the server, so the strict-mode double effect
  // must not post the callback twice
  const callbackStartedRef = useRef(false)

  useEffect(() => {
    if (callbackStartedRef.current) return
    callbackStartedRef.current = true

    // Providers report a denied or failed sign-in through the error parameter instead of a code
    if (searchParams.get('error')) {
      setError('Sign-in was cancelled or refused by the provider.')
      return
    }

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (!code || !state) {
      setError('The sign-in link is incomplete. Start again from the login page.')
      return
    }

    completeOidcCallback({ code, state })
      .then((result) => {
        if (isOidcOnboardingRequired(result)) {
          setOnboarding(result)
          return
        }

        // Committing the session flips the auth state, and the public route wrapper
        // then redirects home on its own
        setSession(result)
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
  }, [searchParams, setSession])

  const completing = !error && !onboarding && !conflictEmail

  const handleBackToLogin = () => {
    setLeaving(true)
  }

  return (
    <div
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      <AnimatePresence>
        {completing && <LoadingScreen message="Completing sign-in" />}
      </AnimatePresence>

      <div className="w-full max-w-sm">
        <AnimatePresence
          mode="wait"
          onExitComplete={() => {
            // The conflicting address rides along so the login form starts prefilled
            if (leaving) navigate('/login', conflictEmail ? { state: { prefillEmail: conflictEmail } } : undefined)
          }}
        >
          {error && !leaving && (
            <motion.div key="sign-in-failed" {...AUTH_VIEW_TRANSITION}>
              <h1 className="font-serif text-4xl font-normal tracking-tight">Sign-in failed</h1>
              <p className="mt-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {error}
              </p>
              <p className="mt-5 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
                <button
                  type="button"
                  onClick={handleBackToLogin}
                  className="font-medium underline underline-offset-2 transition-colors duration-200"
                  style={{ color: 'var(--app-accent)' }}
                >
                  Back to login
                </button>
              </p>
            </motion.div>
          )}

          {conflictEmail && !leaving && (
            <motion.div key="account-exists" {...AUTH_VIEW_TRANSITION}>
              <h1 className="font-serif text-4xl font-normal tracking-tight">Account already exists</h1>
              <p className="mt-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                An account with {conflictEmail} already exists, and the sign-in provider has not
                verified this email, so the two cannot be linked automatically. Sign in with your
                password to use your account.
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
      setSession(response)
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
        You're signing in as {onboarding.email}. A few details finish your account.
      </p>

      {error && (
        <p className="mt-4 text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}

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
