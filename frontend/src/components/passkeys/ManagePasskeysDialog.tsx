import { useState } from 'react';
import { PasskeyRow } from '@/components/passkeys/PasskeyRow';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import type { usePasskeyManagement } from '@/pages/settings/hooks/usePasskeyManagement';
import { getPasskeyRegistrationMessage } from '@/utils/passkeyErrors';

interface ManagePasskeysDialogProps {
  open: boolean;
  onClose: () => void;
  management: ReturnType<typeof usePasskeyManagement>;
}

/**
 * Modal for adding a passkey and removing existing ones, styled like the other two-factor modals
 *
 * When the current origin cannot register passkeys, the add form is replaced by guidance on how to
 * reach a supported address, while any existing passkeys stay listed so they can still be removed
 */
export function ManagePasskeysDialog({ open, onClose, management }: ManagePasskeysDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canRegister = management.support?.supported === true;

  /**
   * Runs the ceremony for the typed label, clearing the field when it succeeds
   */
  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await management.registerPasskey(trimmed);
      setName('');
    } catch (registrationError) {
      setError(getPasskeyRegistrationMessage(registrationError));
    }
  }

  return (
    <TwoFactorModalShell open={open} onClose={onClose} closeDisabled={management.isRegistering || management.isMutating}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Manage passkeys</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Add a passkey to sign in with your fingerprint, face, or device PIN, or remove one you no longer use.
        </p>
      </div>

      {management.support && !management.support.supported ? (
        <WarningCallout>{management.support.message}</WarningCallout>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="app-input flex-1"
              placeholder="Name this passkey"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canRegister || management.isRegistering}
              aria-label="New passkey name"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!canRegister || management.isRegistering || !name.trim()}
              className="app-primary-button shrink-0"
            >
              {management.isRegistering ? 'Waiting…' : 'Add passkey'}
            </button>
          </div>
          {error && (
            <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
              {error}
            </p>
          )}
          {management.reuseReminder && !error && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Passkey added</p>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Your existing recovery codes also cover it, so there are no new codes to save.
              </p>
            </div>
          )}
        </div>
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
    </TwoFactorModalShell>
  );
}
