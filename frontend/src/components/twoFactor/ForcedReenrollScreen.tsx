import { TotpEnrollment } from '@/components/twoFactor/TotpEnrollment';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { useAuth } from '@/hooks/useAuth';

/**
 * Blocks the app after a recovery-code login until the user enrols a fresh authenticator
 *
 * Reuses the full enrolment flow, so the new authenticator and recovery codes are only stored once
 * the user acknowledges them, and an abandoned attempt leaves the existing recovery codes working.
 * Completing clears the restriction and drops back into the app
 */
export default function ForcedReenrollScreen() {
  const { user, setUser } = useAuth();

  /**
   * Clears the restriction locally once enrolment completes so the protected routes render
   */
  const handleComplete = () => {
    if (user) setUser({ ...user, totp_reenrollment_required: false });
  };

  return (
    <div
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Two-factor</h1>

        <div className="mt-5 space-y-5">
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            You signed in with a recovery code, so your previous authenticator was removed. Set up a new
            one to get back into your account.
          </p>

          <WarningCallout>
            You can't access your account until you finish. Each sign-in until then spends one of your
            remaining recovery codes, and running out locks you out permanently.
          </WarningCallout>

          <TotpEnrollment onComplete={handleComplete} />
        </div>
      </div>
    </div>
  );
}
