import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { usePasskeyConfig } from '@/api/passkeys';
import { PasskeyReenrollment } from '@/components/twoFactor/PasskeyReenrollment';
import { TotpEnrollment } from '@/components/twoFactor/TotpEnrollment';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { useAuth } from '@/hooks/useAuth';
import { assessPasskeySupport } from '@/utils/passkeySupport';

type ReenrollMethod = 'choose' | 'totp' | 'passkey';

const BACK_LINK_CLASS =
  'block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200';

/**
 * Blocks the app after a recovery-code login until the user re-establishes a second factor
 *
 * The user can set up an authenticator app or a passkey, whichever they prefer. Each flow only stores
 * the new factor once it is acknowledged, and completing either clears the restriction and drops back
 * into the app. Where passkeys cannot run, the authenticator flow is shown straight away
 */
export default function ForcedReenrollScreen() {
  const { user, setUser } = useAuth();
  const config = usePasskeyConfig();
  const [method, setMethod] = useState<ReenrollMethod>('choose');

  const passkeysSupported = config.data ? assessPasskeySupport(config.data.rp_id).supported : false;

  /**
   * Clears the restriction locally once a factor is re-established so the protected routes render
   */
  const handleComplete = () => {
    if (user) setUser({ ...user, second_factor_reenrollment_required: false });
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
            You signed in with a recovery code, so your previous two-factor method was removed. Set up a
            new one to get back into your account.
          </p>

          <WarningCallout>
            You can't access your account until you finish. Each sign-in until then spends one of your
            remaining recovery codes, and running out locks you out permanently.
          </WarningCallout>

          {!config.isLoading && (!passkeysSupported || method === 'totp') && (
            <div className="space-y-4">
              <TotpEnrollment onComplete={handleComplete} />
              {passkeysSupported && (
                <button
                  type="button"
                  onClick={() => setMethod('choose')}
                  className={BACK_LINK_CLASS}
                  style={{ color: 'var(--app-text-muted)' }}
                >
                  Choose a different method
                </button>
              )}
            </div>
          )}

          {!config.isLoading && passkeysSupported && method === 'choose' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setMethod('passkey')}
                className="app-primary-button flex w-full items-center justify-center gap-2"
              >
                <KeyRound size={16} aria-hidden />
                Set up a passkey
              </button>
              <button type="button" onClick={() => setMethod('totp')} className="app-secondary-button w-full">
                Set up an authenticator app
              </button>
            </div>
          )}

          {!config.isLoading && passkeysSupported && method === 'passkey' && (
            <div className="space-y-4">
              <PasskeyReenrollment onComplete={handleComplete} />
              <button
                type="button"
                onClick={() => setMethod('choose')}
                className={BACK_LINK_CLASS}
                style={{ color: 'var(--app-text-muted)' }}
              >
                Choose a different method
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
