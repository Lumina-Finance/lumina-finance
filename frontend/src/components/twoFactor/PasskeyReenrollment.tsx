import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { usePasskeyConfig, useConfirmPasskeyRegistration, useRegisterPasskey } from '@/api/passkeys';
import { RecoveryCodesModal } from '@/components/twoFactor/RecoveryCodesModal';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { getPasskeyRegistrationMessage } from '@/utils/passkeyErrors';
import { assessPasskeySupport } from '@/utils/passkeySupport';

const RECOVERY_CODES_DESCRIPTION =
  "Save these recovery codes. They're the only way back into your account if you lose your passkey. You won't see them again.";

interface PasskeyReenrollmentProps {
  /** Called once a passkey is active, which also lifts the re-enrolment restriction */
  onComplete: () => void;
}

/**
 * Re-establishes two-factor with a passkey from the restricted post-recovery screen
 *
 * When the recovery batch was exhausted to sign in, the passkey is staged and a fresh batch is issued
 * to acknowledge before it activates. Otherwise the passkey is active at once and the screen completes
 */
export function PasskeyReenrollment({ onComplete }: PasskeyReenrollmentProps) {
  const config = usePasskeyConfig();
  const register = useRegisterPasskey();
  const confirmRegistration = useConfirmPasskeyRegistration();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[] | null>(null);

  const support = config.data ? assessPasskeySupport(config.data.rp_id) : null;

  /**
   * Runs the ceremony, staging the recovery codes to acknowledge when a fresh batch is issued
   */
  async function handleRegister() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setError('');
    try {
      const result = await register.mutateAsync(trimmed);
      if (result.recovery_codes) {
        setPendingRecoveryCodes(result.recovery_codes);
      } else {
        onComplete();
      }
    } catch (registrationError) {
      setError(getPasskeyRegistrationMessage(registrationError));
    }
  }

  /**
   * Activates the staged passkey once its recovery codes are acknowledged, then completes
   */
  async function acknowledgeRecoveryCodes() {
    await confirmRegistration.mutateAsync();
    setPendingRecoveryCodes(null);
    onComplete();
  }

  if (support && !support.supported) {
    return <WarningCallout>{support.message}</WarningCallout>;
  }

  return (
    <div className="space-y-4">
      <input
        className="app-input w-full"
        placeholder="Name this passkey"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={register.isPending}
        aria-label="New passkey name"
      />

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

      {error && (
        <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}

      <RecoveryCodesModal
        open={pendingRecoveryCodes !== null}
        codes={pendingRecoveryCodes}
        description={RECOVERY_CODES_DESCRIPTION}
        onConfirm={acknowledgeRecoveryCodes}
        onClose={() => setPendingRecoveryCodes(null)}
      />
    </div>
  );
}
