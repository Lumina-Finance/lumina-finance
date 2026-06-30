import { useState } from 'react';
import type { Passkey } from '@/api/passkeys';
import { PasskeyRow } from '@/components/passkeys/PasskeyRow';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { getPasskeyRegistrationMessage } from '@/utils/passkeyErrors';
import type { PasskeySupport } from '@/utils/passkeySupport';

interface ManagePasskeysDialogProps {
  open: boolean;
  onClose: () => void;
  /** Null while the relying party id is still loading */
  support: PasskeySupport | null;
  passkeys: Passkey[];
  onRegister: (name: string) => Promise<void>;
  isRegistering: boolean;
  /** True after a passkey reused the account's existing recovery codes, so no new batch was issued */
  reuseReminder: boolean;
  onRename: (passkeyId: string, name: string) => Promise<void>;
  onRemove: (passkeyId: string) => Promise<void>;
  isMutating: boolean;
}

/**
 * Manage dialog for passkeys, listing the registered ones with add, rename, and remove
 *
 * When the current origin cannot register passkeys, the add form is replaced by guidance on how to
 * reach a supported address, while any existing passkeys stay listed so they can still be removed
 */
export function ManagePasskeysDialog({
  open,
  onClose,
  support,
  passkeys,
  onRegister,
  isRegistering,
  reuseReminder,
  onRename,
  onRemove,
  isMutating,
}: ManagePasskeysDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canRegister = support?.supported === true;

  /**
   * Runs the ceremony for the typed label, clearing the field when it succeeds
   */
  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await onRegister(trimmed);
      setName('');
    } catch (registrationError) {
      setError(getPasskeyRegistrationMessage(registrationError));
    }
  }

  return (
    <TwoFactorModalShell open={open} onClose={onClose} closeDisabled={isRegistering}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Passkeys</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Sign in with your fingerprint, face, or device PIN instead of a password.
        </p>
      </div>

      {support && !support.supported ? (
        <WarningCallout>{support.message}</WarningCallout>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="app-input flex-1"
              placeholder="Name this passkey"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canRegister || isRegistering}
              aria-label="New passkey name"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!canRegister || isRegistering || !name.trim()}
              className="app-primary-button shrink-0"
            >
              {isRegistering ? 'Waiting…' : 'Add passkey'}
            </button>
          </div>
          {error && (
            <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
              {error}
            </p>
          )}
          {reuseReminder && !error && (
            <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Passkey added. Your existing recovery codes also cover it, so there are no new codes to save.
            </p>
          )}
        </div>
      )}

      {passkeys.length > 0 && (
        <div className="divide-y" style={{ borderColor: 'var(--app-border)' }}>
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              onRename={(newName) => onRename(passkey.id, newName)}
              onRemove={() => onRemove(passkey.id)}
              disabled={isMutating || isRegistering}
            />
          ))}
        </div>
      )}
    </TwoFactorModalShell>
  );
}
