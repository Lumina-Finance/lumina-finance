import { useState } from 'react';
import {
  useConfirmPasskeyRegistration,
  usePasskeyConfig,
  usePasskeys,
  useRegisterPasskey,
  useRemovePasskey,
  useRenamePasskey,
} from '@/api/passkeys';
import type { StepUpCredentials } from '@/components/twoFactor/StepUpModal';
import { assessPasskeySupport, type PasskeySupport } from '@/utils/passkeySupport';

/**
 * Owns the passkey management state: whether the manage dialog is open, the support assessment for
 * the current origin, the registered passkeys, the add, rename, and remove actions, and the recovery
 * codes shown once when a first passkey is registered
 */
export function usePasskeyManagement() {
  const config = usePasskeyConfig();
  const passkeys = usePasskeys();
  const register = useRegisterPasskey();
  const confirmRegistration = useConfirmPasskeyRegistration();
  const rename = useRenamePasskey();
  const remove = useRemovePasskey();
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[] | null>(null);
  const [reuseReminderVisible, setReuseReminderVisible] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<string | null>(null);

  // The badge and Manage button stay disabled until both the list and the relying party id are known
  const isLoading = passkeys.isLoading || config.isLoading;
  const support: PasskeySupport | null = config.data ? assessPasskeySupport(config.data.rp_id) : null;

  /**
   * Registers a passkey, revealing the recovery codes to acknowledge when a fresh batch is issued, or
   * a reminder that the existing batch already covers the new passkey when codes were reused
   */
  async function registerPasskey(name: string) {
    setReuseReminderVisible(false);
    const result = await register.mutateAsync(name);
    if (result.recovery_codes) {
      setPendingRecoveryCodes(result.recovery_codes);
    } else {
      setReuseReminderVisible(true);
    }
  }

  /**
   * Activates the staged first passkey once its recovery codes are acknowledged
   */
  async function acknowledgeRecoveryCodes() {
    await confirmRegistration.mutateAsync();
    setPendingRecoveryCodes(null);
  }

  /**
   * Removes the targeted passkey once the step-up reauthentication succeeds, then closes the prompt
   */
  async function confirmRemoval(credentials: StepUpCredentials) {
    if (!removalTarget) return;
    await remove.mutateAsync({ passkeyId: removalTarget, payload: credentials });
    setRemovalTarget(null);
  }

  return {
    // Clears the transient reminder and removal target when the multi-factor modal closes
    reset: () => {
      setReuseReminderVisible(false);
      setRemovalTarget(null);
    },
    isLoading,
    support,
    passkeys: passkeys.data ?? [],
    registerPasskey,
    isRegistering: register.isPending,
    renamePasskey: async (passkeyId: string, name: string) => {
      // Clear the just-added reminder so it does not linger past an unrelated action
      setReuseReminderVisible(false);
      await rename.mutateAsync({ passkeyId, name });
    },

    // Removal opens a step-up prompt rather than deleting directly, since the backend re-checks a factor
    beginRemovePasskey: async (passkeyId: string) => {
      setReuseReminderVisible(false);
      setRemovalTarget(passkeyId);
    },
    isRemovalOpen: removalTarget !== null,
    confirmRemoval,
    cancelRemoval: () => setRemovalTarget(null),
    isMutating: rename.isPending || remove.isPending,
    pendingRecoveryCodes,
    acknowledgeRecoveryCodes,
    reuseReminder: reuseReminderVisible,
    dismissReuseReminder: () => setReuseReminderVisible(false),

    // Dismissing without acknowledging leaves the passkey staged, a later login prunes it
    dismissRecoveryCodes: () => setPendingRecoveryCodes(null),
  };
}
