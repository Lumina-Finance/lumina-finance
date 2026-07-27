import { useState } from 'react';
import { motion } from 'motion/react';
import type { StepUpPayload } from '@/api/two-factor';
import { PasskeyEnrollment } from '@/components/passkeys/PasskeyEnrollment';
import { TotpEnrollment } from '@/components/two-factor/TotpEnrollment';
import { TwoFactorModalShell } from '@/components/two-factor/TwoFactorModalShell';
import { AUTH_VIEW_TRANSITION } from '@/pages/auth/constants/authAnimations';

interface SignupFactorSetupProps {
  /** Whether this origin can run a passkey ceremony, deciding whether passkey setup is offered first */
  passkeysSupported: boolean;
  /** Password-only reauthorization carried into whichever enrolment the user picks */
  setupStepUp: StepUpPayload;
  /** Called when a factor is set up or the user confirms skipping */
  onFinish: () => void;
}

/**
 * The post-signup second-factor step. A passkey is the stronger and simpler factor, so it leads when
 * the origin supports one, with the authenticator app as the alternative. Skipping asks once more
 * before letting the user into the app unprotected
 */
export function SignupFactorSetup({ passkeysSupported, setupStepUp, onFinish }: SignupFactorSetupProps) {
  const [method, setMethod] = useState<'passkey' | 'totp'>(passkeysSupported ? 'passkey' : 'totp');
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);

  /**
   * Confirms the skip and leaves the setup step for the app
   */
  const confirmSkip = () => {
    setSkipConfirmOpen(false);
    onFinish();
  };

  return (
    <>
      {/* A keyed remount with an entrance fade swaps methods without an exit animation, since a nested
          wait-mode AnimatePresence inside the auth page's own can wedge and never finish the swap */}
      <motion.div
        key={method}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={AUTH_VIEW_TRANSITION.transition}
      >
        {method === 'passkey' ? (
          <PasskeyEnrollment
            onComplete={onFinish}
            onSkip={() => setSkipConfirmOpen(true)}
            onSwitchToTotp={() => setMethod('totp')}
            setupStepUp={setupStepUp}
          />
        ) : (
          <TotpEnrollment
            onComplete={onFinish}
            onSkip={() => setSkipConfirmOpen(true)}
            onSwitchToPasskey={passkeysSupported ? () => setMethod('passkey') : undefined}
            setupStepUp={setupStepUp}
          />
        )}
      </motion.div>

      <TwoFactorModalShell open={skipConfirmOpen} onClose={() => setSkipConfirmOpen(false)}>
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Skip two-factor setup?</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Your password would be the only thing standing between your financial data and anyone who
            gets hold of it. A passkey or authenticator app keeps your account safe even if your
            password is compromised, and setup only takes a minute.
          </p>
        </div>

        <div className="space-y-3">
          <button type="button" onClick={() => setSkipConfirmOpen(false)} className="app-primary-button w-full">
            Go back
          </button>

          <button
            type="button"
            onClick={confirmSkip}
            className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
            style={{ color: 'var(--app-text-muted)' }}
          >
            I still want to skip
          </button>
        </div>
      </TwoFactorModalShell>
    </>
  );
}
