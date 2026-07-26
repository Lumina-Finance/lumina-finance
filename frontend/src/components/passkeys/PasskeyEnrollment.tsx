import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useConfirmPasskeyRegistration, useRegisterPasskey } from '@/api/passkeys';
import type { StepUpPayload } from '@/api/two-factor/types';
import { RecoveryCodesPanel } from '@/components/two-factor/RecoveryCodesPanel';
import { StepTransition } from '@/components/two-factor/StepTransition';
import { getPasskeyRegistrationMessage, isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors';

interface PasskeyEnrollmentProps {
  /** Called once the passkey is active and, for a first passkey, its recovery codes are acknowledged */
  onComplete: () => void;
  /** Optional skip affordance, shown during signup but not in settings */
  onSkip?: () => void;
  /** Optional switch to authenticator-app enrolment, shown when both methods are on offer */
  onSwitchToTotp?: () => void;
  /**
   * Password-only reauthorization for minting the registration challenge, used at signup where the
   * just-set password gates the account's first factor
   */
  setupStepUp: StepUpPayload;
}

/**
 * Drives passkey enrolment at signup: the naming and browser ceremony, then the one-time recovery codes
 */
export function PasskeyEnrollment({ onComplete, onSkip, onSwitchToTotp, setupStepUp }: PasskeyEnrollmentProps) {
  const register = useRegisterPasskey();
  const confirmRegistration = useConfirmPasskeyRegistration();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [savedAcknowledged, setSavedAcknowledged] = useState(false);
  const [lockoutAcknowledged, setLockoutAcknowledged] = useState(false);

  /**
   * Runs the registration ceremony, staging the recovery codes to acknowledge when a batch is issued
   *
   * A cancelled browser prompt is a deliberate choice, so it stays silent and leaves the user free to
   * retry, switch method, or skip
   */
  const handleRegister = async () => {
    const trimmed = name.trim();
    if (!trimmed || register.isPending) return;

    setError('');
    try {
      const result = await register.mutateAsync({ name: trimmed, step_up: setupStepUp });
      if (result.recovery_codes) {
        setRecoveryCodes(result.recovery_codes);
      } else {
        onComplete();
      }
    } catch (registrationError) {
      if (isPasskeyCeremonyCancelled(registrationError)) return;
      setError(getPasskeyRegistrationMessage(registrationError));
    }
  };

  /**
   * Activates the staged passkey once the recovery codes are acknowledged, then hands back to the caller
   */
  const handleActivate = async () => {
    if (!savedAcknowledged || !lockoutAcknowledged || confirmRegistration.isPending) return;

    setError('');
    try {
      await confirmRegistration.mutateAsync();
      onComplete();
    } catch {
      setError('Could not finish setup. Try again.');
    }
  };

  return (
    <StepTransition stepKey={recoveryCodes ? 'recovery-codes' : 'passkey-register'}>
      {recoveryCodes ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Save your recovery codes</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Each code works once if you lose your passkey. Store them somewhere safe, you won't see them again.
            </p>
          </div>

          <RecoveryCodesPanel codes={recoveryCodes} />

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <input
                type="checkbox"
                checked={savedAcknowledged}
                onChange={(event) => setSavedAcknowledged(event.target.checked)}
              />
              I've saved my recovery codes
            </label>

            <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={lockoutAcknowledged}
                onChange={(event) => setLockoutAcknowledged(event.target.checked)}
              />
              I understand I may be permanently locked out if I lose both my passkey and these codes
            </label>
          </div>

          {error && (
            <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleActivate}
              disabled={!savedAcknowledged || !lockoutAcknowledged || confirmRegistration.isPending}
              className={`app-primary-button transition-all duration-300 ${confirmRegistration.isPending ? 'app-primary-button-loading' : 'w-full'}`}
            >
              {confirmRegistration.isPending ? <div className="app-spinner" /> : 'Done'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Protect your account with a passkey</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Verify with your fingerprint, face, or device PIN when you sign in. Name it so you can tell
              your passkeys apart later.
            </p>
          </div>

          <input
            className="app-input w-full"
            placeholder="Name this passkey"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={register.isPending}
            aria-label="New passkey name"
          />

          {error && (
            <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleRegister}
              disabled={register.isPending || !name.trim()}
              className={`app-primary-button transition-all duration-300 ${register.isPending ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
            >
              {register.isPending ? (
                <div className="app-spinner" />
              ) : (
                <>
                  <KeyRound size={16} aria-hidden />
                  Set up a passkey
                </>
              )}
            </button>
          </div>

          {onSwitchToTotp && (
            <button
              type="button"
              onClick={onSwitchToTotp}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
              style={{ color: 'var(--app-accent)' }}
            >
              Use an authenticator app instead
            </button>
          )}

          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
              style={{ color: 'var(--app-accent)' }}
            >
              Skip for now
            </button>
          )}
        </div>
      )}
    </StepTransition>
  );
}
