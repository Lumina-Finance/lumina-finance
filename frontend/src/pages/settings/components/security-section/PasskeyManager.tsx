import { useState } from 'react';
import { PasskeyRow } from '@/components/passkeys/PasskeyRow';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import type { usePasskeyManagement } from '@/pages/settings/hooks/usePasskeyManagement';
import { getPasskeyRegistrationMessage } from '@/utils/passkeyErrors';

interface PasskeyManagerProps {
  management: ReturnType<typeof usePasskeyManagement>;
}

/**
 * Inline passkey list with an add control, rendered directly in the multi-factor section rather than a
 * dialog. Registration, rename, and removal hand off to the management hook the parent owns, so the
 * recovery-code and step-up modals stay in one place
 */
export function PasskeyManager({ management }: PasskeyManagerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canRegister = management.support?.supported === true;

  /**
   * Runs the ceremony for the typed label, then collapses the add form when it succeeds
   */
  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await management.registerPasskey(trimmed);
      setName('');
      setIsAdding(false);
    } catch (registrationError) {
      setError(getPasskeyRegistrationMessage(registrationError));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Passkeys</h4>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Sign in with your fingerprint, face, or device PIN instead of a password.
          </p>
        </div>
        {canRegister && !isAdding && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsAdding(true);
            }}
            disabled={management.isRegistering}
            className="app-secondary-button shrink-0"
          >
            Add passkey
          </button>
        )}
      </div>

      {management.support && !management.support.supported && <WarningCallout>{management.support.message}</WarningCallout>}

      {isAdding && canRegister && (
        <div className="flex items-center gap-2">
          <input
            className="app-input flex-1"
            placeholder="Name this passkey"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={management.isRegistering}
            autoFocus
            aria-label="New passkey name"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={management.isRegistering || !name.trim()}
            className="app-primary-button shrink-0"
          >
            {management.isRegistering ? 'Waiting…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAdding(false);
              setName('');
              setError(null);
            }}
            disabled={management.isRegistering}
            className="app-secondary-button shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}
      {management.reuseReminder && !error && (
        <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Passkey added. Your existing recovery codes also cover it, so there are no new codes to save.
        </p>
      )}

      {management.passkeys.length > 0 && (
        <div className="divide-y" style={{ borderColor: 'var(--app-border)' }}>
          {management.passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              onRename={(newName) => management.renamePasskey(passkey.id, newName)}
              onRemove={() => management.beginRemovePasskey(passkey.id)}
              disabled={management.isMutating || management.isRegistering}
            />
          ))}
        </div>
      )}
    </div>
  );
}
